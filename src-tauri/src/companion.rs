//! 普段見せる小窓 (companion)。読み上げた「ひとこと」を直近分だけメモリに持ち、小窓へ届ける。
//! 本文は保存しない (アプリを終了すれば消える)。背景画像だけをアプリのデータフォルダに置く。

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// 小窓のウィンドウ名 (tauri.conf.json と同じ)
pub(crate) const WINDOW: &str = "companion";
/// 小窓でさかのぼれる件数 (メモリだけに持つ)
const FEED_LIMIT: usize = 100;
/// 背景にできる画像 (WebView がどのOSでも表示できる形式)
const IMAGE_TYPES: [(&str, &str); 5] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
];
const IMAGE_MAX_BYTES: u64 = 20 * 1024 * 1024;
const IMAGE_STEM: &str = "background";
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

fn saved_image(dir: &Path) -> Option<PathBuf> {
    IMAGE_TYPES
        .iter()
        .map(|(ext, _)| dir.join(format!("{IMAGE_STEM}.{ext}")))
        .find(|p| p.is_file())
}

fn data_url(path: &Path) -> Result<String, String> {
    let (_, mime) = mime_for(path).ok_or("unsupported")?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// 保存済みの背景画像 (無ければ None)。
#[tauri::command(async)]
pub(crate) fn companion_image(app: AppHandle) -> Option<String> {
    let path = saved_image(&image_dir(&app).ok()?)?;
    data_url(&path).ok()
}

/// 選んだ画像を背景として取り込む (元のファイルは動かさない)。
#[tauri::command(async)]
pub(crate) fn set_companion_image(app: AppHandle, path: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    let (ext, _) = mime_for(&source).ok_or("unsupported")?;
    let size = std::fs::metadata(&source).map_err(|e| e.to_string())?.len();
    if size == 0 || size > IMAGE_MAX_BYTES {
        return Err("too_large".to_string());
    }
    let dir = image_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("{IMAGE_STEM}.{ext}"));
    // 一時名へ書いてから差し替え、途中で失敗しても前の背景を残す
    let partial = dir.join(format!("{IMAGE_STEM}.partial"));
    std::fs::copy(&source, &partial).map_err(|e| e.to_string())?;
    while let Some(old) = saved_image(&dir) {
        std::fs::remove_file(old).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    let url = data_url(&target)?;
    emit("companion-image-changed", ());
    Ok(url)
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
    fn replacing_background_keeps_one_file() {
        let dir = std::env::temp_dir().join(format!("readapp-companion-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("background.png"), b"a").unwrap();
        assert_eq!(saved_image(&dir), Some(dir.join("background.png")));
        std::fs::remove_file(dir.join("background.png")).unwrap();
        std::fs::write(dir.join("background.webp"), b"b").unwrap();
        assert_eq!(saved_image(&dir), Some(dir.join("background.webp")));
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
}
