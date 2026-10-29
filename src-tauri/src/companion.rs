//! 普段見せる小窓 (companion)。読み上げた「ひとこと」を直近分だけメモリに持ち、小窓へ届ける。
//! 本文と、吹き出しから鳴らし直すための音声は保存しない (メモリだけに持ち、アプリを終了すれば消える)。
//! キャラに取り込んだ画像だけをアプリのデータフォルダに置く。

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// 小窓のウィンドウ名 (tauri.conf.json と同じ)
pub(crate) const WINDOW: &str = "companion";
/// 小窓でさかのぼれる件数 (メモリだけに持つ)
const FEED_LIMIT: usize = 100;
/// 鳴らし直すために持っておく音声の合計の上限。超えたら古い吹き出しから鳴らし直せなくする
const AUDIO_BUDGET: usize = 32 * 1024 * 1024;
/// 背景にできる画像 (WebView がどのOSでも表示できる形式)
const IMAGE_TYPES: [(&str, &str); 5] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
];
const IMAGE_MAX_BYTES: u64 = 20 * 1024 * 1024;
/// 旧版の小窓の背景 (キャラごとの画像になる前の1枚)
const IMAGE_STEM: &str = "background";
/// キャラに取り込んだ画像の置き場 (companion/characters/<キャラID>.<拡張子>)
const CHARACTER_DIR: &str = "characters";
/// 小窓を開いたまま終了したかの印。あれば次の起動でも開く
const OPEN_MARKER: &str = "open";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LineState {
    /// 声を作っている・順番待ち
    Queued,
    Speaking,
    Done,
    /// 読み上げ停止・消音中に届いた (声は出さず、吹き出しだけ出す)
    Silent,
}

/// 吹き出しから鳴らし直すための音声
#[derive(Clone, Debug)]
pub(crate) enum Replay {
    /// 作った音声 (Geminiの声・試用接続のWAV)。鳴らし直してもお金はかからない
    Audio(Arc<Vec<u8>>),
    /// システム音声。同じ文章をこの声で読み直す (同じ音になる)
    Say(String),
}

impl Replay {
    fn bytes(&self) -> usize {
        match self {
            Replay::Audio(audio) => audio.len(),
            Replay::Say(_) => 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Line {
    id: u64,
    app_id: String,
    app_name: Option<String>,
    text: String,
    /// 受け付けた時刻 (UNIXミリ秒)
    at: u64,
    state: LineState,
    /// 吹き出しを押すと、通知か送ってきたアプリを開ける
    openable: bool,
    /// 読み上げた音声を鳴らし直せる
    replayable: bool,
    #[serde(skip)]
    replay: Option<Replay>,
    /// 直接監視で拾った通知バナーのID。画面へは送らない
    #[serde(skip)]
    #[cfg_attr(not(direct_capture), allow(dead_code))]
    banner: Option<String>,
}

/// 吹き出しの送り元
pub(crate) struct Source<'a> {
    pub app_id: &'a str,
    pub app_name: Option<&'a str>,
    pub banner: Option<&'a str>,
    pub openable: bool,
}

static HANDLE: OnceLock<AppHandle> = OnceLock::new();
static FEED: Mutex<VecDeque<Line>> = Mutex::new(VecDeque::new());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn set_app_handle(handle: AppHandle) {
    HANDLE.set(handle).ok();
}

fn emit<S: Serialize + Clone>(event: &str, payload: S) {
    if let Some(handle) = HANDLE.get() {
        handle.emit(event, payload).ok();
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 読み上げを順番待ちへ入れる前に記録する (再生側の「話し始めた」より必ず先に行がある)。
/// speaking=false は読み上げ停止・消音中で、声を出さない吹き出しにする。
pub(crate) fn record(source: &Source, text: &str, speaking: bool) -> u64 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let line = Line {
        id,
        app_id: source.app_id.to_string(),
        app_name: source.app_name.map(str::to_string),
        text: text.to_string(),
        at: now_ms(),
        state: if speaking { LineState::Queued } else { LineState::Silent },
        openable: source.openable,
        replayable: false,
        replay: None,
        banner: source.banner.map(str::to_string),
    };
    if let Ok(mut feed) = FEED.lock() {
        feed.push_back(line.clone());
        while feed.len() > FEED_LIMIT {
            feed.pop_front();
        }
    }
    emit("companion-line", line);
    id
}

/// 話し始め・話し終わりを小窓へ伝える。読み上げなしの吹き出しはそのまま。
pub(crate) fn mark(id: u64, state: LineState) {
    let updated = FEED.lock().ok().and_then(|mut feed| {
        let line = feed.iter_mut().find(|l| l.id == id)?;
        if line.state == LineState::Silent {
            return None;
        }
        line.state = state;
        Some(line.clone())
    });
    if let Some(line) = updated {
        emit("companion-line", line);
    }
}

/// 読み上げた音声を吹き出しに紐づける (話し始める直前に呼ぶ。小窓へは次の mark で伝わる)。
/// 音声の合計が上限を超えたら、古い吹き出しから鳴らし直せなくする。
pub(crate) fn keep_replay(id: u64, replay: Replay) {
    let dropped = FEED.lock().map(|mut feed| keep_in(&mut feed, id, replay)).unwrap_or_default();
    for line in dropped {
        emit("companion-line", line);
    }
}

/// keep_replay の中身。鳴らし直せなくなった行を返す
fn keep_in(feed: &mut VecDeque<Line>, id: u64, replay: Replay) -> Vec<Line> {
    let Some(line) = feed.iter_mut().find(|l| l.id == id) else {
        return Vec::new();
    };
    line.replay = Some(replay);
    line.replayable = true;
    let mut total = 0;
    let mut dropped = Vec::new();
    for line in feed.iter_mut().rev() {
        total += line.replay.as_ref().map_or(0, Replay::bytes);
        // 登録した行も数える (古い行へ後から登録されても上限を超えて残らないように)
        if total > AUDIO_BUDGET && line.replay.as_ref().is_some_and(|r| r.bytes() > 0) {
            line.replay = None;
            line.replayable = false;
            dropped.push(line.clone());
        }
    }
    dropped
}

/// 吹き出しから、読み上げた音声を鳴らし直す。読み上げを止めている間は "off"、音声がもう無ければ "gone"。
#[tauri::command]
pub(crate) fn companion_replay(id: u64) -> Result<(), String> {
    let (text, replay) = FEED
        .lock()
        .ok()
        .and_then(|feed| feed.iter().find(|l| l.id == id).and_then(|l| Some((l.text.clone(), l.replay.clone()?))))
        .ok_or("gone")?;
    let request = crate::speech::system::request().ok_or("off")?;
    // 順番待ちの間は準備中に戻す (鳴り始めたら話している、になる)
    mark(id, LineState::Queued);
    if !crate::speech::system::replay(&text, replay, request, id) {
        mark(id, LineState::Done);
        return Err("off".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn companion_feed() -> Vec<Line> {
    FEED.lock().map(|f| f.iter().cloned().collect()).unwrap_or_default()
}

/// 吹き出しを押した時: まだ画面に出ている通知ならそれを押し (通常版のみ)、
/// 消えていれば送ってきたアプリを開く。開いたものを "notification" / "app" で返す。
#[tauri::command(async)]
pub(crate) fn companion_open(id: u64) -> Result<&'static str, String> {
    let line = FEED
        .lock()
        .ok()
        .and_then(|feed| feed.iter().find(|l| l.id == id).cloned())
        .ok_or("not_found")?;
    if !line.openable {
        return Err("not_openable".to_string());
    }
    #[cfg(direct_capture)]
    if line.banner.as_deref().is_some_and(crate::notifications::ax::press_banner) {
        return Ok("notification");
    }
    if crate::open_source_app(&line.app_id, line.app_name.as_deref()) {
        Ok("app")
    } else {
        Err("cannot_open".to_string())
    }
}

fn image_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("companion")).map_err(|e| e.to_string())
}

fn mime_for(path: &Path) -> Option<(&'static str, &'static str)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    IMAGE_TYPES.iter().find(|(e, _)| *e == ext).copied()
}

fn saved_image(dir: &Path, stem: &str) -> Option<PathBuf> {
    IMAGE_TYPES
        .iter()
        .map(|(ext, _)| dir.join(format!("{stem}.{ext}")))
        .find(|p| p.is_file())
}

fn data_url(path: &Path) -> Result<String, String> {
    let (_, mime) = mime_for(path).ok_or("unsupported")?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn character_dir(app: &AppHandle) -> Result<PathBuf, String> {
    image_dir(app).map(|d| d.join(CHARACTER_DIR))
}

/// キャラIDはファイル名に使うので、作ったキャラのIDだけを受ける。
fn known_character(app: &AppHandle, id: &str) -> bool {
    app.state::<crate::AppSettings>().character(id).is_some()
}

/// キャラに取り込んだ画像 (無ければ None)。
#[tauri::command(async)]
pub(crate) fn character_image(app: AppHandle, id: String) -> Option<String> {
    if !known_character(&app, &id) {
        return None;
    }
    let path = saved_image(&character_dir(&app).ok()?, &id)?;
    data_url(&path).ok()
}

/// 選んだ画像をキャラの画像として取り込む (元のファイルは動かさない)。
#[tauri::command(async)]
pub(crate) fn set_character_image(app: AppHandle, id: String, path: String) -> Result<String, String> {
    if !known_character(&app, &id) {
        return Err("not_found".to_string());
    }
    let source = PathBuf::from(&path);
    let (ext, _) = mime_for(&source).ok_or("unsupported")?;
    let size = std::fs::metadata(&source).map_err(|e| e.to_string())?.len();
    if size == 0 || size > IMAGE_MAX_BYTES {
        return Err("too_large".to_string());
    }
    let dir = character_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 一時名へ書いてから差し替え、途中で失敗しても前の画像を残す
    let partial = dir.join(format!("{id}.partial"));
    std::fs::copy(&source, &partial).map_err(|e| e.to_string())?;
    let target = replace_image(&dir, &id, ext, &partial)?;
    let url = data_url(&target)?;
    let settings = app.state::<crate::AppSettings>();
    if let Some(mut c) = settings.character(&id) {
        c.image = crate::characters::IMAGE_CUSTOM.to_string();
        settings.replace_character(c);
    }
    emit("character-image-changed", id);
    Ok(url)
}

/// 同じキャラの古い画像 (拡張子違いも) を消してから置く。1キャラ1枚。
fn replace_image(dir: &Path, stem: &str, ext: &str, from: &Path) -> Result<PathBuf, String> {
    while let Some(old) = saved_image(dir, stem) {
        std::fs::remove_file(old).map_err(|e| e.to_string())?;
    }
    let target = dir.join(format!("{stem}.{ext}"));
    std::fs::rename(from, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// キャラを消した時に、そのキャラの画像も消す。
pub(crate) fn remove_character_image(app: &AppHandle, id: &str) {
    let Ok(dir) = character_dir(app) else { return };
    while let Some(old) = saved_image(&dir, id) {
        if std::fs::remove_file(old).is_err() {
            break;
        }
    }
}

/// 旧版の小窓に取り込んでいた背景を、いまのキャラの画像へ移す (1度だけ。移したら旧ファイルは無くなる)。
pub(crate) fn migrate_legacy_background(app: &AppHandle, settings: &crate::AppSettings) {
    let (Ok(old_dir), Ok(dir)) = (image_dir(app), character_dir(app)) else { return };
    let Some(old) = saved_image(&old_dir, IMAGE_STEM) else { return };
    let Some((ext, _)) = mime_for(&old) else { return };
    let mut active = settings.active();
    if std::fs::create_dir_all(&dir).is_err() || replace_image(&dir, &active.id, ext, &old).is_err() {
        return;
    }
    active.image = crate::characters::IMAGE_CUSTOM.to_string();
    settings.replace_character(active);
}

/// ウィンドウを開いて前に出す。macOSでは開くまで作らない (作るだけでアプリが前面に出るため)。
pub(crate) fn show_window(app: &AppHandle, label: &str) {
    let result = (|| -> tauri::Result<()> {
        let window = match app.get_webview_window(label) {
            Some(window) => window,
            None => {
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|w| w.label == label)
                    .ok_or(tauri::Error::WindowNotFound)?;
                tauri::WebviewWindowBuilder::from_config(app, config)?.build()?
            }
        };
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
        if label == WINDOW {
            remember_open(app, true);
        }
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("{label} を開けませんでした: {error}");
    }
}

/// 小窓を開いている・閉じたことを覚える (次の起動で開くかどうか)。
pub(crate) fn remember_open(app: &AppHandle, open: bool) {
    let Ok(dir) = image_dir(app) else { return };
    let marker = dir.join(OPEN_MARKER);
    if open {
        std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&marker, b"")).ok();
    } else {
        std::fs::remove_file(&marker).ok();
    }
}

/// 前回、小窓を開いたまま終了していれば開く。
pub(crate) fn restore(app: &AppHandle) {
    if image_dir(app).map(|d| d.join(OPEN_MARKER).is_file()).unwrap_or(false) {
        show_window(app, WINDOW);
    }
}

#[tauri::command]
pub(crate) fn show_companion(app: AppHandle) {
    show_window(&app, WINDOW);
}

#[tauri::command]
pub(crate) fn show_settings(app: AppHandle) {
    show_window(&app, "main");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_webview_images_are_accepted() {
        assert_eq!(mime_for(Path::new("/tmp/cat.PNG")).map(|m| m.1), Some("image/png"));
        assert_eq!(mime_for(Path::new("/tmp/cat.jpeg")).map(|m| m.1), Some("image/jpeg"));
        assert!(mime_for(Path::new("/tmp/cat.heic")).is_none());
        assert!(mime_for(Path::new("/tmp/cat")).is_none());
    }

    #[test]
    fn replacing_image_keeps_one_file_per_character() {
        let dir = std::env::temp_dir().join(format!("readapp-companion-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("mio.png"), b"a").unwrap();
        std::fs::write(dir.join("aoi.png"), b"c").unwrap();
        assert_eq!(saved_image(&dir, "mio"), Some(dir.join("mio.png")));
        std::fs::write(dir.join("next.partial"), b"b").unwrap();
        let placed = replace_image(&dir, "mio", "webp", &dir.join("next.partial")).unwrap();
        assert_eq!(placed, dir.join("mio.webp"));
        assert_eq!(saved_image(&dir, "mio"), Some(dir.join("mio.webp")));
        assert!(!dir.join("mio.png").exists());
        // ほかのキャラの画像は残す
        assert_eq!(saved_image(&dir, "aoi"), Some(dir.join("aoi.png")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn feed_keeps_latest_lines_and_tracks_state() {
        let source = |app_id: &'static str| Source { app_id, app_name: None, banner: None, openable: false };
        let first = record(&source("slack"), "鈴木さんから。", true);
        for i in 0..FEED_LIMIT {
            record(&source("claude"), &format!("{i}"), true);
        }
        let feed = companion_feed();
        assert!(feed.len() <= FEED_LIMIT);
        assert!(feed.iter().all(|l| l.id != first));
        let last = feed.last().unwrap().id;
        mark(last, LineState::Speaking);
        assert_eq!(companion_feed().last().unwrap().state, LineState::Speaking);
        // 読み上げ停止中の吹き出しは、再生側の知らせで状態が変わらない
        let silent = record(&source("slack"), "止めている間の通知", false);
        mark(silent, LineState::Done);
        let line = companion_feed().into_iter().find(|l| l.id == silent).unwrap();
        assert_eq!(line.state, LineState::Silent);
        assert_eq!(companion_open(silent), Err("not_openable".to_string()));
    }

    #[test]
    fn kept_audio_stays_within_budget_and_drops_oldest_first() {
        let line = |id: u64| Line {
            id,
            app_id: "claude".into(),
            app_name: None,
            text: String::new(),
            at: 0,
            state: LineState::Done,
            openable: false,
            replayable: false,
            replay: None,
            banner: None,
        };
        let mut feed: VecDeque<Line> = (1..=4).map(line).collect();
        let audio = || Replay::Audio(Arc::new(vec![0; AUDIO_BUDGET / 2]));
        assert!(keep_in(&mut feed, 1, audio()).is_empty());
        assert!(keep_in(&mut feed, 2, Replay::Say("system".into())).is_empty());
        assert!(keep_in(&mut feed, 3, audio()).is_empty());
        // 3つ目の音声で上限を超える: いちばん古い音声 (1) だけを外し、読み直す声 (2) と新しい音声は残す
        let dropped = keep_in(&mut feed, 4, audio());
        assert_eq!(dropped.iter().map(|l| l.id).collect::<Vec<_>>(), vec![1]);
        assert!(!feed[0].replayable && feed[0].replay.is_none());
        assert!(feed[1].replayable && feed[2].replayable && feed[3].replayable);
        // 知らない行には何もしない
        assert!(keep_in(&mut feed, 99, audio()).is_empty());
        // 古い行へ後から登録されても、合計は上限を超えない (その行も外す)
        let dropped = keep_in(&mut feed, 1, audio());
        assert_eq!(dropped.iter().map(|l| l.id).collect::<Vec<_>>(), vec![1]);
        let total: usize = feed.iter().filter_map(|l| l.replay.as_ref()).map(Replay::bytes).sum();
        assert!(total <= AUDIO_BUDGET);
    }
}
