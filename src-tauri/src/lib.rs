// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(target_os = "macos")]
mod menubar;
mod characters;
mod companion;
pub mod notifications;
pub mod speech;
pub mod subscription;
pub mod transform;
mod telemetry;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

use crate::transform::Mode;
use crate::characters::Character;

/// アプリ別の読み上げ設定。JSONで永続化する (M5)。
/// 考え方は「キャラを作って選ぶ→対象アプリを決める」。
/// 名前・画像・声・話し方はキャラの持ち物 (characters)。アプリ側はON/OFFと、担当キャラ (任意)。
pub struct AppSettings {
    enabled: Mutex<HashMap<String, bool>>,
    /// すべて読み上げモード。ONなら個別設定に関わらず読む。
    speak_all: Mutex<bool>,
    /// 全体の読み上げ。OFFで再生中・待機中の音声も停止する。
    speech_enabled: Mutex<bool>,
    /// 表示名の上書き (ファイル選択で追加したアプリ用)。
    names: Mutex<HashMap<String, String>>,
    /// 作ったキャラ (1人以上)
    characters: Mutex<Vec<Character>>,
    /// いま話すキャラのID
    active_character: Mutex<String>,
    /// 旧設定 (キャラが1つの形式) から引き継いだ直後 (小窓の背景の引き継ぎ用。実行時のみ)
    migrated_from_legacy: Mutex<bool>,
    /// アプリごとの担当キャラ (app_id → キャラID)。無いアプリは、いま話すキャラが読む。
    app_characters: Mutex<HashMap<String, String>>,
    /// 読み上げの音量 (0〜100 %)。
    volume: Mutex<u8>,
    onboarded: Mutex<bool>,
    /// Dockにアイコンを出す (既定は出さず、メニューバーだけに常駐する)。macOSのみ。
    show_in_dock: Mutex<bool>,
    data_file: Mutex<Option<PathBuf>>,
    /// macOS変換ヘルパーのパス。無ければ素文フォールバック (実行時のみ)。
    helper_path: Mutex<Option<PathBuf>>,
    /// 最後にパイプラインへ入った通知 (疎通確認用。実行時のみ)。
    last_received: Mutex<Option<ReceivedNotification>>,
    /// 見かけた通知元 (追加候補用。実行時のみ)。
    observed: Mutex<HashSet<String>>,
    /// イベント送信用 (setup時に設定)。
    app_handle: Mutex<Option<tauri::AppHandle>>,
    /// 最近読んだ通知 (重複防止用。実行時のみ)。
    recent_spoken: Mutex<Vec<RecentSpoken>>,
    /// 通知元ごとの (最終受信時刻 UNIX秒, 受信回数)。設定の確認表示用。実行時のみ。
    /// 回数は同じ秒に複数届いても今回の受信を見分けるため。
    received_at: Mutex<HashMap<String, (u64, u64)>>,
}

#[derive(Debug, Clone, Serialize)]
struct ReceivedNotification {
    app_id: String,
    text: String,
    /// UNIX時刻 (秒)
    at: u64,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct SavedSettings {
    #[serde(default)]
    enabled: HashMap<String, bool>,
    #[serde(default)]
    speak_all: bool,
    #[serde(default = "speech_enabled_default")]
    speech_enabled: bool,
    #[serde(default)]
    names: HashMap<String, String>,
    /// 旧形式の項目。読み込みでは引き継ぎに使い、書き出しでは今のキャラの値を入れる (古い版へ戻した時用)
    #[serde(default = "persona_mode_default")]
    mode: String,
    #[serde(default = "default_persona_id")]
    persona: String,
    #[serde(default = "default_voice_id")]
    voice: String,
    #[serde(default)]
    characters: Vec<Character>,
    #[serde(default)]
    active_character: String,
    #[serde(default)]
    app_characters: HashMap<String, String>,
    /// 旧形式 (アプリごとの声)。読み込み時に担当キャラへ移し、書き出さない
    #[serde(default, skip_serializing)]
    app_voices: HashMap<String, String>,
    #[serde(default = "default_volume")]
    volume: u8,
    #[serde(default)]
    onboarded: bool,
    #[serde(default)]
    show_in_dock: bool,
}

fn speech_enabled_default() -> bool {
    true
}

fn default_volume() -> u8 {
    speech::system::MAX_VOLUME
}

fn default_persona_id() -> String {
    "mio".to_string()
}

fn default_voice_id() -> String {
    "system".to_string()
}

fn persona_mode_default() -> String {
    "persona".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            enabled: Mutex::new(HashMap::new()),
            speak_all: Mutex::new(false),
            speech_enabled: Mutex::new(true),
            names: Mutex::new(HashMap::new()),
            characters: Mutex::new(characters::defaults(&default_voice_id())),
            active_character: Mutex::new(default_persona_id()),
            migrated_from_legacy: Mutex::new(false),
            app_characters: Mutex::new(HashMap::new()),
            volume: Mutex::new(default_volume()),
            onboarded: Mutex::new(false),
            show_in_dock: Mutex::new(false),
            data_file: Mutex::new(None),
            helper_path: Mutex::new(None),
            last_received: Mutex::new(None),
            observed: Mutex::new(HashSet::new()),
            app_handle: Mutex::new(None),
            recent_spoken: Mutex::new(Vec::new()),
            received_at: Mutex::new(HashMap::new()),
        }
    }
}

impl AppSettings {
    fn change_speech_enabled(&self, enabled: bool) {
        if let Ok(mut b) = self.speech_enabled.lock() {
            *b = enabled;
            speech::system::set_enabled(enabled);
        }
        self.save();
        self.notify_speech_controls();
    }

    fn notify_speech_controls(&self) {
        let handle = self.app_handle.lock().ok().and_then(|h| h.clone());
        if let Some(handle) = handle {
            let controls = SpeechControls { speech_enabled: self.speech_enabled(), volume: self.volume() };
            #[cfg(target_os = "macos")]
            menubar::sync(&handle, controls.speech_enabled, controls.volume);
            handle.emit("speech-controls-changed", controls).ok();
        }
    }

    pub fn speech_enabled(&self) -> bool {
        self.speech_enabled.lock().map(|b| *b).unwrap_or(false)
    }

    pub fn show_in_dock(&self) -> bool {
        self.show_in_dock.lock().map(|b| *b).unwrap_or(false)
    }

    pub fn characters(&self) -> Vec<Character> {
        self.characters.lock().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn character(&self, id: &str) -> Option<Character> {
        self.characters.lock().ok()?.iter().find(|c| c.id == id).cloned()
    }

    /// いま話すキャラ。見つからなければ先頭 (キャラは必ず1人以上いる)。
    pub fn active(&self) -> Character {
        let id = self.active_character.lock().map(|a| a.clone()).unwrap_or_default();
        let list = self.characters();
        list.iter()
            .find(|c| c.id == id)
            .or_else(|| list.first())
            .cloned()
            .unwrap_or_else(|| characters::defaults(&default_voice_id()).remove(0))
    }

    pub fn active_id(&self) -> String {
        self.active().id
    }

    pub fn mode(&self) -> Mode {
        Mode::from_str(&self.active().style)
    }

    /// いまのキャラの話し方 (口調のid / raw / custom)
    pub fn persona(&self) -> String {
        self.active().style
    }

    /// キャラを書き換えて保存し、各ウィンドウへ知らせる。
    fn edit_characters(&self, f: impl FnOnce(&mut Vec<Character>, &mut String) -> bool) -> bool {
        let changed = match (self.characters.lock(), self.active_character.lock()) {
            (Ok(mut list), Ok(mut active)) => f(&mut list, &mut active),
            _ => false,
        };
        if changed {
            self.save();
            self.notify_characters();
        }
        changed
    }

    fn notify_characters(&self) {
        if let Some(h) = self.app_handle.lock().ok().and_then(|h| h.clone()) {
            h.emit("characters-changed", CharactersState { characters: self.characters(), active_character: self.active_id() }).ok();
        }
    }

    /// 同じIDのキャラを置き換える (画像の取り込みなど、検証済みの値だけ渡す)。
    pub(crate) fn replace_character(&self, next: Character) {
        self.edit_characters(|list, _| match list.iter_mut().find(|c| c.id == next.id) {
            Some(c) if *c != next => {
                *c = next;
                true
            }
            _ => false,
        });
    }

    /// 読み上げの音量 (0〜100 %)。
    pub fn volume(&self) -> u8 {
        self.volume.lock().map(|v| *v).unwrap_or_else(|_| default_volume())
    }

    /// そのアプリの通知を読むキャラ。担当キャラがいればそのキャラ、いなければいま話すキャラ。
    pub fn character_for(&self, app_id: &str) -> Character {
        self.app_characters
            .lock()
            .ok()
            .and_then(|m| m.get(app_id).cloned())
            .and_then(|id| self.character(&id))
            .unwrap_or_else(|| self.active())
    }

    /// そのアプリで使う声 (読むキャラの声)。
    pub fn voice_for(&self, app_id: &str) -> String {
        self.character_for(app_id).voice
    }

    pub fn voice(&self) -> String {
        self.active().voice
    }

    pub fn display_name(&self, app_id: &str) -> Option<String> {
        self.names
            .lock()
            .map(|m| m.get(app_id).cloned())
            .unwrap_or(None)
    }

    pub fn helper_path(&self) -> Option<PathBuf> {
        self.helper_path.lock().map(|p| p.clone()).unwrap_or(None)
    }

    pub fn set_helper_path(&self, path: Option<PathBuf>) {
        if let Ok(mut p) = self.helper_path.lock() {
            *p = path;
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        if let Ok(mut h) = self.app_handle.lock() {
            *h = Some(handle);
        }
    }

    /// 通知元を見かけたら記録する (追加候補用)。新規ならイベントで知らせる。
    pub(crate) fn observe(&self, app_id: &str) {
        let id = app_id.trim();
        if id.is_empty() {
            return;
        }
        let is_new = self
            .observed
            .lock()
            .map(|mut s| s.insert(id.to_string()))
            .unwrap_or(false);
        if is_new {
            if let Some(h) = self.app_handle.lock().map(|h| h.clone()).unwrap_or(None) {
                h.emit("observed-changed", ()).ok();
            }
        }
    }

    /// observeに加え、表示名が未登録なら覚える (googlechrome → Google Chrome)。
    pub(crate) fn observe_named(&self, app_id: &str, display_name: &str) {
        let name = display_name.trim();
        if !name.is_empty() && name != app_id {
            if let Ok(mut m) = self.names.lock() {
                m.entry(app_id.to_string()).or_insert_with(|| name.to_string());
            }
        }
        self.observe(app_id);
    }

    pub(crate) fn observed_apps(&self) -> Vec<String> {
        self.observed
            .lock()
            .map(|s| {
                let mut v: Vec<String> = s.iter().cloned().collect();
                v.sort();
                v
            })
            .unwrap_or_default()
    }

    fn snapshot(&self) -> SavedSettings {
        let active = self.active();
        SavedSettings {
            enabled: self.enabled.lock().map(|m| m.clone()).unwrap_or_default(),
            speak_all: self.speak_all.lock().map(|b| *b).unwrap_or(false),
            speech_enabled: self.speech_enabled(),
            names: self.names.lock().map(|m| m.clone()).unwrap_or_default(),
            mode: Mode::from_str(&active.style).as_str().to_string(),
            persona: characters::legacy_persona(&active.style).to_string(),
            voice: active.voice.clone(),
            characters: self.characters(),
            active_character: active.id,
            app_characters: self.app_characters.lock().map(|m| m.clone()).unwrap_or_default(),
            app_voices: HashMap::new(),
            volume: self.volume(),
            onboarded: self.onboarded.lock().map(|b| *b).unwrap_or(false),
            show_in_dock: self.show_in_dock(),
        }
    }

    fn save(&self) {
        let path = self.data_file.lock().map(|p| p.clone()).unwrap_or(None);
        if let Some(path) = path {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).ok();
            }
            if let Ok(json) = serde_json::to_string_pretty(&self.snapshot()) {
                std::fs::write(&path, json).ok();
            }
        }
    }

    fn load(&self, path: &PathBuf) {
        if let Ok(json) = std::fs::read_to_string(path) {
            // 旧形式 (アプリ別map) からの移行を吸収するためValue経由で読む。
            // personaは旧default_personaを引き継ぎ、mode/voiceは既定に戻す。
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                if let Ok(saved) = serde_json::from_value::<SavedSettings>(v.clone()) {
                    // 新形式そのまま
                    if let Ok(mut m) = self.enabled.lock() {
                        *m = saved.enabled;
                    }
                    if let Ok(mut b) = self.speak_all.lock() {
                        *b = saved.speak_all;
                    }
                    if let Ok(mut b) = self.speech_enabled.lock() {
                        *b = saved.speech_enabled;
                        speech::system::set_enabled(*b);
                    }
                    if let Ok(mut m) = self.names.lock() {
                        *m = saved.names.clone();
                    }
                    // キャラが1つだった旧形式は、選んでいたキャラへ声と話し方を引き継ぐ
                    let (list, active) = if saved.characters.is_empty() {
                        if let Ok(mut m) = self.migrated_from_legacy.lock() {
                            *m = true;
                        }
                        characters::migrate(&saved.persona, &saved.voice, &saved.mode)
                    } else {
                        let mut list = saved.characters;
                        characters::upgrade_defaults(&mut list);
                        (list, saved.active_character)
                    };
                    let mut list = list;
                    let mut assigned = saved.app_characters;
                    // 旧版の「アプリごとの声」は、その声のキャラを担当にする
                    if assigned.is_empty() && !saved.app_voices.is_empty() {
                        let names = saved.names.clone();
                        assigned = characters::assign_legacy_voices(&mut list, &active, &saved.app_voices, |id| {
                            names.get(id).cloned()
                                .or_else(|| catalog().iter().find(|a| a.id == id).map(|a| a.name.clone()))
                                .unwrap_or_else(|| id.to_string())
                        });
                    }
                    if let Ok(mut c) = self.characters.lock() {
                        *c = list;
                    }
                    if let Ok(mut a) = self.active_character.lock() {
                        *a = active;
                    }
                    if let Ok(mut m) = self.app_characters.lock() {
                        *m = assigned;
                    }
                    if let Ok(mut v) = self.volume.lock() {
                        *v = saved.volume.min(speech::system::MAX_VOLUME);
                        speech::system::set_volume(*v);
                    }
                    if let Ok(mut b) = self.onboarded.lock() {
                        *b = saved.onboarded;
                    }
                    if let Ok(mut b) = self.show_in_dock.lock() {
                        *b = saved.show_in_dock;
                    }
                } else {
                    // 旧形式: enabled・onboarded・default_personaだけ拾う
                    if let Some(enabled) = v.get("enabled").and_then(|e| {
                        serde_json::from_value::<HashMap<String, bool>>(e.clone()).ok()
                    }) {
                        if let Ok(mut m) = self.enabled.lock() {
                            *m = enabled;
                        }
                    }
                    if let Some(p) = v.get("default_persona").and_then(|p| p.as_str()) {
                        if !p.is_empty() {
                            let (list, active) = characters::migrate(p, &default_voice_id(), &persona_mode_default());
                            if let Ok(mut c) = self.characters.lock() {
                                *c = list;
                            }
                            if let Ok(mut cur) = self.active_character.lock() {
                                *cur = active;
                            }
                        }
                    }
                    if let Some(b) = v.get("onboarded").and_then(|b| b.as_bool()) {
                        if let Ok(mut cur) = self.onboarded.lock() {
                            *cur = b;
                        }
                    }
                }
            }
        }
        if let Ok(mut d) = self.data_file.lock() {
            *d = Some(path.clone());
        }
    }
}

#[derive(Deserialize)]
struct CatalogApp {
    id: String,
    name: String,
    /// macOSでの識別 (アプリ別の通知オートメーション用)。同じアプリでも版でバンドルIDが違うことがある
    #[serde(default)]
    mac: Vec<MacApp>,
}

#[derive(Deserialize)]
struct MacApp {
    #[serde(rename = "bundleId")]
    bundle_id: String,
}

#[derive(Deserialize)]
struct Catalog {
    apps: Vec<CatalogApp>,
}

/// アプリカタログ (UIと共有する catalog.json が正本)。
fn catalog() -> &'static [CatalogApp] {
    static CATALOG: std::sync::OnceLock<Vec<CatalogApp>> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str::<Catalog>(include_str!("../../src/lib/catalog.json"))
            .map(|c| c.apps)
            .unwrap_or_default()
    })
}

/// notification → shouldSpeak() → transform() → speak() の shouldSpeak 部分。
/// 読み上げ対象のアプリかだけを決める。全体の停止・消音は声を出す段階 (speak_now) で見て、
/// 止めている間も小窓には吹き出しを出す。
/// すべて読み上げモードなら全部読む。そうでなければ個別の設定に従う。
/// 未設定の既定:
/// - 直接届いた通知: カタログのアプリならON、それ以外 (見つけたアプリ) はOFF (UIの「追加すると読み上げます」と一致)
/// - ショートカット経由: ON (ユーザーがショートカット側で対象アプリに選んだもの。MAS版はアプリ別ON/OFFを出さない)
fn should_speak(settings: &AppSettings, app_id: &str, route: Route) -> bool {
    // readapp自身の通知は設定確認用なので、アプリ別設定に関わらず読む
    if app_id == SELF_APP_ID || settings.speak_all.lock().map(|b| *b).unwrap_or(false) {
        return true;
    }
    let explicit = settings
        .enabled
        .lock()
        .map(|m| m.get(app_id).copied())
        .unwrap_or(None);
    explicit.unwrap_or_else(|| route == Route::Shortcut || catalog().iter().any(|a| a.id == app_id))
}

/// 読み上げで使うアプリ名。登録名→カタログ名の順。分からなければNone。
fn app_label(settings: &AppSettings, app_id: &str) -> Option<String> {
    settings
        .display_name(app_id)
        .or_else(|| catalog().iter().find(|a| a.id == app_id).map(|a| a.name.clone()))
}

#[tauri::command]
fn get_settings(state: State<'_, AppSettings>) -> HashMap<String, bool> {
    state.enabled.lock().map(|m| m.clone()).unwrap_or_default()
}

#[tauri::command]
fn set_app_enabled(
    state: State<'_, AppSettings>,
    app_id: String,
    enabled: bool,
    display_name: Option<String>,
) {
    if let Ok(mut m) = state.enabled.lock() {
        m.insert(app_id.clone(), enabled);
    }
    if let Some(name) = display_name {
        let name = name.trim().to_string();
        if !name.is_empty() {
            if let Ok(mut m) = state.names.lock() {
                m.insert(app_id, name);
            }
        }
    }
    state.save();
}

#[tauri::command]
fn set_speak_all(state: State<'_, AppSettings>, enabled: bool) {
    if let Ok(mut b) = state.speak_all.lock() {
        *b = enabled;
    }
    state.save();
}

/// 全体をOFFにした時は、保存を待たずに音声を止める。
#[tauri::command]
fn set_speech_enabled(state: State<'_, AppSettings>, enabled: bool) {
    state.change_speech_enabled(enabled);
}

/// 話し方の一覧 (キャラを作る時に選ぶ口調)。
#[tauri::command]
fn get_personas() -> Vec<transform::Persona> {
    transform::personas()
}

/// キャラに選べる声か (OS既定・プレミアム枠・Gemini・このMacにある声)。
fn known_voice(voice_id: &str) -> bool {
    const PREMIUM: [&str; 2] = ["clear", "warm"];
    voice_id == "system"
        || speech::premium::is_voice(voice_id)
        || speech::gemini::is_voice(voice_id)
        || PREMIUM.contains(&voice_id)
        || speech::system::list_voices()
            .iter()
            .any(|v| v.id == voice_id)
}

#[derive(Clone, Serialize)]
struct CharactersState {
    characters: Vec<Character>,
    active_character: String,
}

/// いま話すキャラを選ぶ。
#[tauri::command]
fn set_active_character(state: State<'_, AppSettings>, id: String) -> Result<(), String> {
    let ok = state.edit_characters(|list, active| {
        if !list.iter().any(|c| c.id == id) || *active == id {
            return false;
        }
        *active = id.clone();
        true
    });
    if ok || state.active_id() == id { Ok(()) } else { Err("not_found".to_string()) }
}

/// 新しいキャラを作って返す (まだ選ばない)。
#[tauri::command]
fn create_character(state: State<'_, AppSettings>) -> Result<Character, String> {
    let voice = state.voice();
    let mut created = None;
    state.edit_characters(|list, _| {
        if list.len() >= characters::CHARACTERS_MAX {
            return false;
        }
        let c = characters::blank(list, &voice);
        created = Some(c.clone());
        list.push(c);
        true
    });
    created.ok_or_else(|| "too_many".to_string())
}

/// キャラの名前・画像・声・話し方を書き換える。知らない値は受け付けない。
#[tauri::command]
fn update_character(state: State<'_, AppSettings>, character: Character) -> Result<Character, String> {
    let name = characters::clean_name(&character.name).ok_or("empty_name")?;
    if !characters::valid_image(&character.image) || !characters::valid_style(&character.style) || !known_voice(&character.voice) {
        return Err("invalid".to_string());
    }
    let next = Character { name, style_note: characters::clean_note(&character.style_note), ..character };
    let mut found = false;
    state.edit_characters(|list, _| {
        let Some(c) = list.iter_mut().find(|c| c.id == next.id) else { return false };
        found = true;
        if *c == next {
            return false;
        }
        *c = next.clone();
        true
    });
    if found { Ok(next) } else { Err("not_found".to_string()) }
}

/// キャラを消す。最後の1人は消せない。いま話すキャラなら先頭のキャラに切り替える。
#[tauri::command]
fn delete_character(app: tauri::AppHandle, state: State<'_, AppSettings>, id: String) -> Result<(), String> {
    let mut removed = false;
    state.edit_characters(|list, active| {
        if list.len() <= 1 || !list.iter().any(|c| c.id == id) {
            return false;
        }
        list.retain(|c| c.id != id);
        if *active == id {
            *active = list[0].id.clone();
        }
        removed = true;
        true
    });
    if !removed {
        return Err("cannot_delete".to_string());
    }
    // そのキャラが担当していたアプリは、いま話すキャラが読む
    if let Ok(mut m) = state.app_characters.lock() {
        m.retain(|_, c| *c != id);
    }
    state.save();
    companion::remove_character_image(&app, &id);
    Ok(())
}

/// 読み上げの音量を設定する (0〜100 %。超える値は100に丸める)。
#[tauri::command]
fn set_volume(state: State<'_, AppSettings>, volume: u8) {
    if let Ok(mut v) = state.volume.lock() {
        *v = volume.min(speech::system::MAX_VOLUME);
        speech::system::set_volume(*v);
    }
    state.save();
    state.notify_speech_controls();
}

#[tauri::command]
fn cloud_tts_configured() -> bool {
    speech::premium::configured()
}

#[tauri::command]
fn get_speech_issue() -> Option<speech::status::SpeechIssue> {
    speech::status::get()
}

#[derive(Serialize)]
struct GeminiByokStatus { supported: bool, configured: bool }

#[tauri::command]
async fn gemini_byok_status() -> Result<GeminiByokStatus, String> {
    tauri::async_runtime::spawn_blocking(|| GeminiByokStatus {
        supported: speech::gemini_key::supported(), configured: speech::gemini_key::configured(),
    }).await.map_err(|_| "APIキーの登録状態を確認できませんでした".to_owned())
}

#[tauri::command]
async fn save_gemini_key(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || speech::gemini_key::save(&key).map_err(str::to_owned))
        .await.map_err(|_| "APIキーを保存できませんでした".to_owned())?
}

#[tauri::command]
async fn delete_gemini_key() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| speech::gemini_key::delete().map_err(str::to_owned))
        .await.map_err(|_| "APIキーを削除できませんでした".to_owned())?
}

/// アプリの担当キャラを決める。None で解除 (いま話すキャラが読む)。作ったキャラだけを受け付ける。
#[tauri::command]
fn set_app_character(state: State<'_, AppSettings>, app_id: String, character_id: Option<String>) -> Result<(), String> {
    let app_id = app_id.trim().to_string();
    if app_id.is_empty() {
        return Err("invalid".to_string());
    }
    if character_id.as_deref().is_some_and(|id| state.character(id).is_none()) {
        return Err("not_found".to_string());
    }
    if let Ok(mut m) = state.app_characters.lock() {
        match character_id {
            None => m.remove(&app_id),
            Some(id) => m.insert(app_id, id),
        };
    }
    state.save();
    Ok(())
}

#[derive(Clone, Serialize)]
struct SpeechControls {
    speech_enabled: bool,
    volume: u8,
}

#[derive(Serialize)]
struct FullState {
    enabled: HashMap<String, bool>,
    speak_all: bool,
    speech_enabled: bool,
    names: HashMap<String, String>,
    /// いまのキャラの話し方 (persona / raw)・口調・声。表示用 (変えるのはキャラ側)
    mode: String,
    persona: String,
    voice: String,
    characters: Vec<Character>,
    active_character: String,
    /// 旧設定から引き継いだ直後 (小窓の背景の選択を、いまのキャラへ移す)
    migrated_from_legacy: bool,
    app_characters: HashMap<String, String>,
    volume: u8,
    onboarded: bool,
    show_in_dock: bool,
}

#[tauri::command]
fn get_state(state: State<'_, AppSettings>) -> FullState {
    let s = state.snapshot();
    let active = state.active();
    FullState {
        enabled: s.enabled,
        speak_all: s.speak_all,
        speech_enabled: s.speech_enabled,
        names: s.names,
        mode: s.mode,
        persona: active.style,
        voice: s.voice,
        characters: s.characters,
        active_character: s.active_character,
        migrated_from_legacy: state.migrated_from_legacy.lock().map(|b| *b).unwrap_or(false),
        app_characters: s.app_characters,
        volume: s.volume,
        onboarded: s.onboarded,
        show_in_dock: s.show_in_dock,
    }
}

#[tauri::command]
fn display_name(state: State<'_, AppSettings>, app_id: String) -> Option<String> {
    state.display_name(&app_id)
}

#[tauri::command]
fn set_onboarded(state: State<'_, AppSettings>, done: bool) {
    if let Ok(mut b) = state.onboarded.lock() {
        *b = done;
    }
    state.save();
}

/// Dockにアイコンを出すか。出さない時はメニューバーだけに常駐する。
#[tauri::command]
fn set_show_in_dock(app: tauri::AppHandle, state: State<'_, AppSettings>, show: bool) {
    if let Ok(mut b) = state.show_in_dock.lock() {
        *b = show;
    }
    state.save();
    #[cfg(target_os = "macos")]
    menubar::apply_dock_policy(&app, show);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
extern "C" {
    fn readapp_login_item_status() -> i32;
    fn readapp_login_item_set(enabled: bool) -> i32;
    fn readapp_open_login_items_settings();
}

/// ログイン時に起動するか (macOSの「ログイン項目」の状態。readapp側には保存しない)。
/// "enabled" / "disabled" / "requires_approval" (システム設定で許可待ち) / "unsupported"
fn login_item_label(code: i32) -> &'static str {
    match code {
        1 => "enabled",
        2 => "requires_approval",
        0 | 3 => "disabled",
        _ => "unsupported",
    }
}

#[tauri::command]
fn login_item_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        login_item_label(unsafe { readapp_login_item_status() })
    }
    #[cfg(not(target_os = "macos"))]
    {
        "unsupported"
    }
}

#[tauri::command]
fn set_login_item(enabled: bool) -> Result<&'static str, String> {
    #[cfg(target_os = "macos")]
    {
        let code = unsafe { readapp_login_item_set(enabled) };
        if code < 0 {
            return Err("login_item_failed".to_string());
        }
        Ok(login_item_label(code))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Err("unsupported".to_string())
    }
}

/// システム設定の「ログイン項目」を開く (許可待ちの時の案内)。
#[tauri::command]
fn open_login_items_settings() {
    #[cfg(target_os = "macos")]
    unsafe {
        readapp_open_login_items_settings();
    }
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// 配布版。"mas" はサンドボックス版で、通知はショートカット経由のみ (直接監視なし)。
#[tauri::command]
fn get_edition() -> String {
    if cfg!(feature = "mas") { "mas" } else { "direct" }.to_string()
}

/// アクセシビリティ許可の状態 (macOS直接監視用)。
#[tauri::command]
fn ax_trusted() -> bool {
    #[cfg(direct_capture)]
    {
        notifications::ax::trusted()
    }
    #[cfg(not(direct_capture))]
    {
        false
    }
}

/// プロンプト付きで許可を要求する。初回はシステムダイアログが出る。
#[tauri::command]
fn ax_request_access() -> bool {
    #[cfg(direct_capture)]
    {
        notifications::ax::request_prompt()
    }
    #[cfg(not(direct_capture))]
    {
        false
    }
}

/// 直接監視が動作中か。
#[tauri::command]
fn ax_watching() -> bool {
    #[cfg(direct_capture)]
    {
        notifications::ax::watching()
    }
    #[cfg(not(direct_capture))]
    {
        false
    }
}

#[tauri::command]
fn ax_open_settings() {
    #[cfg(direct_capture)]
    notifications::ax::open_settings();
}

#[tauri::command]
fn get_system_voices() -> Vec<speech::system::SystemVoice> {
    speech::system::list_voices()
}

#[tauri::command]
fn get_last_received(state: State<'_, AppSettings>) -> Option<ReceivedNotification> {
    state.last_received.lock().map(|l| l.clone()).unwrap_or(None)
}

#[derive(Serialize)]
struct AppEntry {
    id: String,
    name: String,
}

#[derive(Serialize)]
struct ObservedApp {
    id: String,
    name: String,
    /// 最終受信時刻 (UNIX秒)。この起動中に受信していなければ None
    at: Option<u64>,
    /// この起動中の受信回数
    count: u64,
}

/// 見かけた通知元の一覧 (追加候補・設定の確認表示用)。表示名と最終受信時刻付き。
#[tauri::command]
fn get_observed_apps(state: State<'_, AppSettings>) -> Vec<ObservedApp> {
    let received = state.received_at.lock().map(|m| m.clone()).unwrap_or_default();
    state
        .observed_apps()
        .into_iter()
        .map(|id| {
            let (at, count) = received.get(&id).map(|(a, c)| (Some(*a), *c)).unwrap_or((None, 0));
            ObservedApp {
                name: app_label(&state, &id).unwrap_or_else(|| id.clone()),
                at,
                count,
                id,
            }
        })
        .collect()
}

/// ファイル選択した .app を設定キーと表示名に変換する。
/// 表示名はFinderと同じローカライズ名 (Notes.app → メモ) を使い、バナーのアプリ名と揃える。
#[tauri::command]
fn resolve_app(path: String) -> Option<AppEntry> {
    let p = std::path::Path::new(&path);
    let stem = p.file_stem()?.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    let name = std::process::Command::new("mdls")
        .args(["-raw", "-name", "kMDItemDisplayName"])
        .arg(p)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().trim_end_matches(".app").to_string())
        .filter(|n| !n.is_empty() && n != "(null)")
        .unwrap_or(stem);
    #[cfg(not(target_os = "macos"))]
    let name = stem;
    let name = notifications::nfc(&name);
    let id = notifications::app_id_for(&name);
    Some(AppEntry { id, name })
}

fn shortcut_name(app_id: &str) -> Option<String> {
    if app_id.is_empty()
        || !app_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    Some(format!("readapp-{app_id}"))
}

/// ショートカットが登録済みか (`shortcuts list` と突き合わせる。macOSのみ)。
#[tauri::command]
fn shortcut_installed(app_id: String) -> bool {
    let Some(name) = shortcut_name(&app_id) else {
        return false;
    };
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("shortcuts")
            .arg("list")
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .any(|l| l.trim() == name)
            })
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = name;
        false
    }
}

/// 登録済みショートカットをその場で実行し、受け口の疎通を確認する。
/// 実行後に get_last_received が更新されれば疎通OK (判定は呼び出し元)。
#[tauri::command]
fn run_shortcut(app_id: String) -> Result<(), String> {
    let Some(name) = shortcut_name(&app_id) else {
        return Err("invalid app id".to_string());
    };
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("shortcuts")
            .args(["run", &name])
            .output()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = name;
        Err("macOS only".to_string())
    }
}

/// 配布ショートカットのダウンロード (macOS)。
/// 同梱の readapp-<id>.shortcut をダウンロードフォルダへ保存してパスを返す。
/// ダブルクリックでショートカットに登録し、通知オートメーションから実行する。
#[tauri::command]
fn download_shortcut(app: tauri::AppHandle, app_id: String) -> Result<String, String> {
    let Some(name) = shortcut_name(&app_id) else {
        return Err("invalid app id".to_string());
    };
    let filename = format!("{name}.shortcut");
    // バンドル内は Resources/resources/shortcuts/ に配置される
    let from_bundle = app
        .path()
        .resource_dir()
        .map(|d| d.join("resources/shortcuts").join(&filename))
        .ok();
    let from_source = std::env::current_exe().ok().and_then(|e| {
        // 開発時: target/debug/readapp → src-tauri/resources/...
        e.ancestors()
            .nth(3)
            .map(|d| d.join("resources/shortcuts").join(&filename))
    });
    let src = [from_bundle, from_source]
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
        .ok_or_else(|| "shortcut not found. run `npm run build:shortcuts`".to_string())?;
    let dst = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?
        .join(&filename);
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.to_string_lossy().to_string())
}

/// 通知オートメーションのひな形の名前 (= 同梱ファイル名)。濁点を含めない (build-shortcuts.mjs参照)。
const AUTOMATION_NAME: &str = "readapp通知";

/// 同梱の通知オートメーションのひな形を開く (ショートカットの「追加」画面が出る)。
#[tauri::command]
fn add_notify_automation(app: tauri::AppHandle) -> Result<(), String> {
    let file = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join(format!("resources/automation/{AUTOMATION_NAME}.shortcut"));
    if !file.is_file() {
        return Err("automation template not found. run `npm run build:shortcuts`".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let ok = std::process::Command::new("open")
            .arg(&file)
            .status()
            .map_err(|e| e.to_string())?
            .success();
        if ok { Ok(()) } else { Err("failed to open template".to_string()) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("macOS only".to_string())
    }
}

/// ひな形がショートカットに追加済みか (`shortcuts list` と突き合わせる)。
#[tauri::command]
fn notify_automation_installed() -> bool {
    installed_shortcut_names().iter().any(|n| n == AUTOMATION_NAME)
}

/// 追加済みのひな形を編集画面で開く (対象アプリを選んでもらう)。
#[tauri::command]
fn open_notify_automation() -> Result<(), String> {
    let name: String = url::form_urlencoded::byte_serialize(AUTOMATION_NAME.as_bytes()).collect();
    open_url(&format!("shortcuts://open-shortcut?name={name}"))
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> Result<(), String> {
    let ok = std::process::Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| e.to_string())?
        .success();
    if ok { Ok(()) } else { Err(format!("failed to open {url}")) }
}

#[cfg(not(target_os = "macos"))]
fn open_url(_url: &str) -> Result<(), String> {
    Err("macOS only".to_string())
}

/// 試し用の通知の既定の本文 (設定確認用)。
const TEST_NOTIFICATION_TEXT: &str = "テスト通知です。読み上げの設定ができました。";

/// 試し用の通知を出す (intents/Intents.swift)。本文を省くと設定確認用の文。
/// 汎用ひな形の通知元に readapp 自身が入っているので、オートメーションがオンなら読み上げまで一巡する
/// (dmg版は直接監視でも拾う。同じ通知は重複判定で1回になる)。
/// 初回は許可の確認に答えるまで待つので、async指定でメインスレッド (画面) の外で動かす。
/// 失敗時のErrは "denied" (通知が許可されていない) か "failed"。
#[tauri::command(async)]
fn send_test_notification(text: Option<String>) -> Result<(), String> {
    let text = text
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| TEST_NOTIFICATION_TEXT.to_string());
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn readapp_post_test_notification(body: *const std::os::raw::c_char) -> i32;
        }
        let body = std::ffi::CString::new(text).map_err(|_| "invalid text".to_string())?;
        // SAFETY: NUL終端の文字列を渡し、呼び出し中は有効。メインスレッド外から呼ぶ (Swift側が完了を待つため)。
        match unsafe { readapp_post_test_notification(body.as_ptr()) } {
            0 => Ok(()),
            1 => Err("denied".to_string()),
            _ => Err("failed".to_string()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("macOS only".to_string())
    }
}

/// アプリ別の通知オートメーションの名前 (= 同梱ファイル名)。
/// 同じアプリに複数の版 (バンドルID) がある時は2つ目以降に番号を付けて区別する
/// (版を差し替えた時に、古い版用のショートカットを追加済みと誤認しないように)。
/// build-shortcuts.mjs の命名と同じ規則。
fn app_automation_name(app_id: &str, variant: usize) -> String {
    if variant == 0 {
        format!("{AUTOMATION_NAME}-{app_id}")
    } else {
        format!("{AUTOMATION_NAME}-{app_id}-{}", variant + 1)
    }
}

/// 追加済みのショートカット名 (NFCに揃える)。
fn installed_shortcut_names() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("shortcuts")
            .arg("list")
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .map(|l| notifications::nfc(l.trim()))
                    .collect()
            })
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

/// カタログのアプリのうち、このMacに入っている版 (何番目の版か, バンドルID)。
fn installed_bundle(app: &CatalogApp) -> Option<(usize, &str)> {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn readapp_app_installed(bundle_id: *const std::os::raw::c_char) -> bool;
        }
        app.mac.iter().map(|m| m.bundle_id.as_str()).enumerate().find(|(_, b)| {
            std::ffi::CString::new(*b)
                // SAFETY: NUL終端の文字列を渡し、呼び出し中は有効。
                .map(|c| unsafe { readapp_app_installed(c.as_ptr()) })
                .unwrap_or(false)
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}

#[derive(Serialize)]
struct MasApp {
    id: String,
    name: String,
    /// アプリ別の通知オートメーションが追加済みか
    added: bool,
}

/// MAS版「読み上げるアプリ」: このMacに入っているカタログのアプリと、追加済みか。
#[tauri::command(async)]
fn mas_app_list() -> Vec<MasApp> {
    let names = installed_shortcut_names();
    catalog()
        .iter()
        .filter_map(|a| {
            let (variant, _) = installed_bundle(a)?;
            Some(MasApp {
                id: a.id.clone(),
                name: a.name.clone(),
                added: names.iter().any(|n| *n == app_automation_name(&a.id, variant)),
            })
        })
        .collect()
}

/// アプリ別の通知オートメーション (そのアプリだけが通知元) を開く (ショートカットの「追加」画面が出る)。
#[tauri::command]
fn add_app_automation(app: tauri::AppHandle, app_id: String) -> Result<(), String> {
    let entry = catalog().iter().find(|a| a.id == app_id).ok_or("unknown app")?;
    let (variant, bundle) = installed_bundle(entry).ok_or("app not installed")?;
    let file = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/automation/apps")
        .join(bundle)
        .join(format!("{}.shortcut", app_automation_name(&app_id, variant)));
    if !file.is_file() {
        return Err("automation not found. run `npm run build:shortcuts`".to_string());
    }
    open_url(&file.to_string_lossy())
}

/// ショートカットアプリを開く (MAS版の設定案内用)。
#[tauri::command]
fn open_shortcuts_app() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ok = std::process::Command::new("open")
            .args(["-b", "com.apple.shortcuts"])
            .status()
            .map_err(|e| e.to_string())?
            .success();
        if ok { Ok(()) } else { Err("failed to open Shortcuts".to_string()) }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("macOS only".to_string())
    }
}

#[tauri::command]
fn windows_ensure_access(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    notifications::windows::begin_start(app);
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

/// パイプライン本体: shouldSpeak → transform → speak。
/// OFFのアプリは None を返して喋らない。変換失敗時は素文に落ちる。
pub(crate) fn speak_notification(
    settings: &AppSettings,
    app_id: &str,
    title: &str,
    body: &str,
    route: Route,
) -> Option<String> {
    if !accept_notification(settings, app_id, title, body, route) {
        return None;
    }
    speak_now(settings, app_id, title, body, match route {
        Route::Direct => telemetry::Trigger::Direct,
        Route::Shortcut => telemetry::Trigger::Shortcut,
    }, None)
}

/// AI変換の待ち行列へ入れる前に、受信時点で読み上げ対象を確定する。
pub(crate) fn accept_notification(
    settings: &AppSettings,
    app_id: &str,
    title: &str,
    body: &str,
    route: Route,
) -> bool {
    if !should_speak(settings, app_id, route) {
        return false;
    }
    fresh_notification(settings, app_id, &format!("{title}\n{body}"), route)
}

/// 最近読んだ通知 (重複防止用)。
struct RecentSpoken {
    key: String,
    app_id: String,
    route: Route,
    at: std::time::Instant,
}

/// 通知の届き方。同じ通知が別の経路から重ねて届く時だけ1回にまとめる。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Route {
    /// OSから直接 (macOSの直接監視・WindowsのUserNotificationListener)
    Direct,
    /// ショートカット経由 (URLスキーム・部品「readappで読み上げる」)
    Shortcut,
}

/// 直接監視とショートカットの両方で同じ通知を受けた時に1回だけ読むための窓。
const DUPLICATE_WINDOW: std::time::Duration = std::time::Duration::from_secs(20);
/// 同じ経路でも、この間隔より短い同文は同じ通知とみなす
/// (汎用とアプリ別のオートメーションが両方そのアプリを対象にしていると、ほぼ同時に2回届く)。
const SAME_ROUTE_WINDOW: std::time::Duration = std::time::Duration::from_secs(2);

/// 経路ごとの区切りの差 (直接監視は「タイトル。本文」、部品は「タイトル\n本文」) だけを無視する。
/// ショートカットからは分解形 (か+濁点) で届くことがあるので合成済みに揃える。
/// 本文中の記号 (小数点など) は意味が変わるので残す。
fn notification_key(text: &str) -> String {
    notifications::nfc(text).chars().filter(|c| !c.is_whitespace() && *c != '。').collect()
}

/// 未読なら true (かつ既読化する)。窓内に「別の経路で」同じ通知を読んでいれば false。
/// 同じ経路で同じ文が続くのは別の通知なので読む。ただし同じアプリから2秒以内の同文は、
/// ほぼ同時に届いた重複 (汎用とアプリ別の両オートメーション) とみなす。
fn fresh_notification(settings: &AppSettings, app_id: &str, text: &str, route: Route) -> bool {
    let key = notification_key(text);
    if key.is_empty() {
        return true;
    }
    let now = std::time::Instant::now();
    let Ok(mut recent) = settings.recent_spoken.lock() else {
        return true;
    };
    recent.retain(|r| now.duration_since(r.at) < DUPLICATE_WINDOW);
    // 通知元が分からない受信 (汎用オートメーションで通知の「アプリ」が空) は、どのアプリとも同じとみなす
    let same_app = |other: &str| other == app_id || other == INTENT_APP_ID || app_id == INTENT_APP_ID;
    if recent.iter().any(|r| {
        r.key == key
            && same_app(&r.app_id)
            && (r.route != route || now.duration_since(r.at) < SAME_ROUTE_WINDOW)
    }) {
        // 記録は窓が切れるまで残す。直接監視・汎用・アプリ別の3経路以上でも1回にする。
        return false;
    }
    recent.push(RecentSpoken { key, app_id: app_id.to_string(), route, at: now });
    true
}

/// transform → speak (アプリ別ON/OFF判定なし)。キャラ口調ではアプリ名も渡し
/// 「Claudeの作業、終わったみたいだよ」のように言えるようにする。
/// 読み上げ停止・消音中は声を出さず、小窓に「読み上げなし」の吹き出しだけ出す。
/// banner は直接監視で拾った通知バナーのID (吹き出しから通知を押すため)。
pub(crate) fn speak_now(
    settings: &AppSettings,
    app_id: &str,
    title: &str,
    body: &str,
    trigger: telemetry::Trigger,
    banner: Option<&str>,
) -> Option<String> {
    speak_now_as(settings, &settings.character_for(app_id), app_id, title, body, trigger, banner)
}

/// speak_now を、キャラを指定して使えるようにしたもの (キャラの編集中の試し読み)。
fn speak_now_as(
    settings: &AppSettings,
    character: &Character,
    app_id: &str,
    title: &str,
    body: &str,
    trigger: telemetry::Trigger,
    banner: Option<&str>,
) -> Option<String> {
    // 停止後に変換が終わっても古い音声を鳴らさないよう、変換の前に取る
    let request = if settings.speech_enabled() { speech::system::request() } else { None };
    let raw = if title.is_empty() {
        body.to_string()
    } else if body.is_empty() {
        title.to_string()
    } else {
        format!("{}。{}", title, body)
    };
    let raw = clean_for_speech(&raw);
    if raw.is_empty() {
        return None;
    }
    let label = app_label(settings, app_id);
    let text = transform::transform_text_as(settings, character, &raw, label.as_deref());
    // 小窓へ先に記録する (再生側の「話し始めた」より必ず先に行があるように)。
    let source = companion::Source {
        app_id,
        app_name: label.as_deref(),
        banner,
        openable: banner.is_some() || can_open_source_app(app_id, label.as_deref()),
    };
    let line = companion::record(&source, &text, request.is_some());
    let Some(request) = request else {
        return None;
    };
    let queued = speech::system::speak(&text, &character.voice, request, telemetry::Context::new(app_id, trigger), line);
    if !queued {
        // 受け付けた直後に止められた: 吹き出しは残し、読み上げなしにする
        companion::mark(line, companion::LineState::Silent);
    }
    queued.then_some(text)
}

/// 吹き出しから開ける送り元か (readapp自身・試し読み・通知元不明は開かない)。
fn can_open_source_app(app_id: &str, name: Option<&str>) -> bool {
    cfg!(target_os = "macos")
        && ![SELF_APP_ID, INTENT_APP_ID, "preview"].contains(&app_id)
        && (catalog().iter().any(|a| a.id == app_id) || name.is_some_and(|n| !n.trim().is_empty()))
}

/// 通知を送ってきたアプリを開く。カタログのアプリは入っている版のバンドルIDで、それ以外は名前で開く。
pub(crate) fn open_source_app(app_id: &str, name: Option<&str>) -> bool {
    if !can_open_source_app(app_id, name) {
        return false;
    }
    let open = |args: &[&str]| {
        std::process::Command::new("open")
            .args(args)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };
    if let Some((_, bundle)) = catalog().iter().find(|a| a.id == app_id).and_then(installed_bundle) {
        if open(&["-b", bundle]) {
            return true;
        }
    }
    name.is_some_and(|n| open(&["-a", n.trim()]))
}

/// 読み上げ前の整形: 不可視文字 (メールのプレビュー埋め草等) を消し、空白を詰め、
/// 長文は先頭だけにする (通知1件を延々と読み続けないため)。
const SPEECH_MAX_CHARS: usize = 140;

fn clean_for_speech(text: &str) -> String {
    let visible: String = text
        .chars()
        .filter(|c| {
            !matches!(c, '\u{00AD}' | '\u{034F}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{FEFF}')
        })
        .collect();
    let squeezed = visible.split_whitespace().collect::<Vec<_>>().join(" ");
    if squeezed.chars().count() <= SPEECH_MAX_CHARS {
        return squeezed;
    }
    let mut cut: String = squeezed.chars().take(SPEECH_MAX_CHARS).collect();
    cut.push('…');
    cut
}

/// ショートカットの部品から呼ばれた時に使う、起動後のハンドル。
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// readapp自身の通知元ID (通知のアプリ名「readapp」から app_id_for で作られる)。
const SELF_APP_ID: &str = "readapp";

/// アプリ名なしで部品が呼ばれた時の通知元ID (ON/OFFに関わらず読む)。
const INTENT_APP_ID: &str = "shortcut";

/// 部品の呼び出し先。アプリ名があればアプリ別のON/OFFに従い、空なら必ず読む。
#[derive(Debug, PartialEq, Eq)]
enum IntentTarget {
    Always,
    App { id: String, name: String },
}

fn intent_target(app_name: &str) -> IntentTarget {
    let name = notifications::nfc(app_name.trim());
    if name.is_empty() {
        IntentTarget::Always
    } else {
        IntentTarget::App { id: notifications::app_id_for(&name), name }
    }
}

/// ショートカットの部品「readappで読み上げる」(intents/Intents.swift) の受け口。
/// Swift側 (部品の実行) を待たせないよう、変換・発声は別スレッドで行ってすぐ返す。
#[no_mangle]
pub extern "C" fn readapp_intent_speak(app: *const std::os::raw::c_char, text: *const std::os::raw::c_char) {
    if app.is_null() || text.is_null() {
        return;
    }
    // SAFETY: Swift側がNUL終端のUTF-8文字列を渡し、呼び出し中は有効。ここで所有文字列に写す。
    let app = unsafe { std::ffi::CStr::from_ptr(app) }.to_string_lossy().into_owned();
    let text = unsafe { std::ffi::CStr::from_ptr(text) }.to_string_lossy().into_owned();
    // ショートカットの変数は分解形 (か+濁点) で届くことがある。変換・重複判定の前に揃える
    let text = notifications::nfc(&text);
    std::thread::spawn(move || {
        // 部品から起動された直後はsetupの完了を待つ (最大5秒)
        let handle = (0..50).find_map(|_| {
            let h = APP_HANDLE.get().cloned();
            if h.is_none() {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            h
        });
        let Some(handle) = handle else {
            eprintln!("[readapp] intent: app not ready, dropped");
            return;
        };
        let settings = handle.state::<AppSettings>();
        match intent_target(&app) {
            IntentTarget::Always => {
                record_received(&settings, INTENT_APP_ID, "", &text);
                if fresh_notification(&settings, INTENT_APP_ID, &text, Route::Shortcut) {
                    speak_now(&settings, INTENT_APP_ID, "", &text, telemetry::Trigger::Shortcut, None);
                }
            }
            IntentTarget::App { id, name } => {
                settings.observe_named(&id, &name);
                record_received(&settings, &id, "", &text);
                speak_notification(&settings, &id, "", &text, Route::Shortcut);
            }
        }
    });
}

/// URLスキーム受信 (M3): readapp://notify?... をパイプラインに流す。
fn handle_notify_url(settings: &AppSettings, url: &url::Url) {
    if let Some(n) = notifications::macos::parse_notify_url(url) {
        settings.observe(&n.app_id);
        record_received(settings, &n.app_id, &n.title, &n.body);
        speak_notification(settings, &n.app_id, &n.title, &n.body, Route::Shortcut);
    }
}

pub(crate) fn record_received(settings: &AppSettings, app_id: &str, title: &str, body: &str) {
    let text = if title.is_empty() {
        body.to_string()
    } else if body.is_empty() {
        title.to_string()
    } else {
        format!("{}。{}", title, body)
    };
    let at = now_secs();
    if let Ok(mut l) = settings.last_received.lock() {
        *l = Some(ReceivedNotification {
            app_id: app_id.to_string(),
            text,
            at,
        });
    }
    if let Ok(mut m) = settings.received_at.lock() {
        let entry = m.entry(app_id.to_string()).or_insert((at, 0));
        *entry = (at, entry.1 + 1);
    }
}

/// 「試しに喋る」: 実通知なしで変換→発声まで通す (M1)。
/// アプリ別ON/OFFは無視するが、全体OFF・消音には従う。
/// character_id を渡すと、そのキャラで話す (編集中のキャラの試し読み)。無ければそのアプリを読むキャラ。
/// 変換に数秒かかるのでasync指定でメインスレッド (画面) を塞がない。
#[tauri::command(async)]
fn test_speak(
    state: State<'_, AppSettings>,
    app_id: String,
    title: String,
    body: String,
    character_id: Option<String>,
) -> Result<String, String> {
    let character = character_id.and_then(|id| state.character(&id)).unwrap_or_else(|| state.character_for(&app_id));
    Ok(speak_now_as(&state, &character, &app_id, &title, &body, telemetry::Trigger::Preview, None).unwrap_or_default())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    let context = {
        let mut context = context;
        // 非表示でもWKWebView生成はアプリをactivateする。設定・小窓は開くまで生成しない。
        for window in &mut context.config_mut().app.windows {
            if window.label == "main" || window.label == companion::WINDOW {
                window.create = false;
            }
        }
        context
    };
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.activate_ignoring_other_apps(false);
    builder
        // 二重起動を既存インスタンスへ転送 (deep-link機能でURLも転送される)。
        // AppIntentによる起動もURLなしで届くため、ここでは設定画面を表示しない。
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            // 小窓は閉じても隠すだけにし、次の起動では開かない。
            if window.label() == companion::WINDOW {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window.hide().ok();
                    companion::remember_open(window.app_handle(), false);
                }
                return;
            }
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window.hide().ok();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .manage(AppSettings::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_platform,
            get_edition,
            open_shortcuts_app,
            add_notify_automation,
            notify_automation_installed,
            open_notify_automation,
            send_test_notification,
            mas_app_list,
            add_app_automation,
            ax_trusted,
            ax_request_access,
            ax_watching,
            ax_open_settings,
            get_system_voices,
            download_shortcut,
            shortcut_installed,
            run_shortcut,
            get_last_received,
            get_observed_apps,
            resolve_app,
            get_state,
            display_name,
            get_settings,
            set_app_enabled,
            set_speak_all,
            set_speech_enabled,
            get_personas,
            set_active_character,
            create_character,
            update_character,
            delete_character,
            cloud_tts_configured,
            get_speech_issue,
            gemini_byok_status,
            save_gemini_key,
            delete_gemini_key,
            set_app_character,
            set_volume,
            set_onboarded,
            windows_ensure_access,
            test_speak,
            companion::companion_feed,
            companion::character_image,
            companion::set_character_image,
            companion::show_companion,
            companion::show_settings,
            companion::companion_open,
            set_show_in_dock,
            login_item_status,
            set_login_item,
            open_login_items_settings
        ])
        .setup(|app| {
            speech::system::set_app_handle(app.handle().clone());
            companion::set_app_handle(app.handle().clone());
            // 音量を下げた時の書き出しファイルが前回の異常終了で残っていれば消す (通知本文の音声のため)
            // 通知を受け付ける前に済ませる (今回の書き出しを消さないため)
            speech::system::remove_leftover_files();
            use tauri_plugin_deep_link::DeepLinkExt;
            let handle = app.handle().clone();
            // イベント送信用ハンドルを保持 (observed-changed等)
            handle
                .state::<AppSettings>()
                .set_app_handle(handle.clone());
            // 保存済み設定の読み込み (M5)。無ければ既定値のまま。
            {
                let settings = handle.state::<AppSettings>();
                if let Ok(dir) = app.path().app_data_dir() {
                    settings.load(&dir.join("settings.json"));
                    telemetry::init(&dir);
                }
                // 旧版で小窓に取り込んでいた背景は、いまのキャラの画像にする
                companion::migrate_legacy_background(&handle, &settings);
            }
            // トレイを先に作り、窓を隠しても設定・終了の入口を失わないようにする。
            #[cfg(target_os = "macos")]
            {
                menubar::install(&handle)?;
                if !handle.state::<AppSettings>().onboarded.lock().map(|b| *b).unwrap_or(false) {
                    menubar::show_settings(&handle);
                } else {
                    companion::restore(&handle);
                }
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = handle.get_webview_window("main") {
                window.show()?;
            }
            // macOS変換ヘルパーの解決 (M4)。無ければ素文フォールバック。
            {
                let settings = handle.state::<AppSettings>();
                let from_bundle = app
                    .path()
                    .resource_dir()
                    .ok()
                    .map(|d| d.join("binaries/fm-helper-aarch64-apple-darwin"));
                let from_exedir = std::env::current_exe()
                    .ok()
                    .and_then(|e| e.parent().map(|d| d.join("fm-helper-aarch64-apple-darwin")));
                if let Some(p) = [from_bundle, from_exedir]
                    .into_iter()
                    .flatten()
                    .find(|p| p.is_file())
                {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        if let Ok(md) = std::fs::metadata(&p) {
                            let mut perm = md.permissions();
                            perm.set_mode(perm.mode() | 0o111);
                            std::fs::set_permissions(&p, perm).ok();
                        }
                    }
                    settings.set_helper_path(Some(p));
                }
            }
            // ショートカットの部品からの呼び出しを受け付け始める。
            // 保存設定とヘルパーの準備が済んでから公開する (起動直後の呼び出しが既定値で読まないように)。
            let _ = APP_HANDLE.set(handle.clone());
            // 起動時URL (cold start: アプリ停止中にURLで開かれた場合)
            if let Ok(Some(urls)) = handle.deep_link().get_current() {
                let settings = handle.state::<AppSettings>();
                for url in &urls {
                    handle_notify_url(&settings, url);
                }
            }
            // 起動中URL (macOSは起動中イベントで届く)
            let moved = handle.clone();
            // 変換待ちでメインスレッド (画面) を塞がないよう別スレッドで流す。
            // ponytail: イベントごとにスレッドを立てる。同時に届くと変換の完了順で読む。
            handle.deep_link().on_open_url(move |event| {
                let h = moved.clone();
                let urls = event.urls();
                std::thread::spawn(move || {
                    let settings = h.state::<AppSettings>();
                    for url in &urls {
                        handle_notify_url(&settings, url);
                    }
                });
            });
            // macOS直接監視を開始 (dmg版。許可済みの場合のみ)。
            #[cfg(direct_capture)]
            {
                notifications::ax::start_if_trusted(handle.clone());
            }
            // Windows: UserNotificationListener を開始 (M2)。
            // 権限ダイアログは初回のみ。要求開始はUIスレッド、完了待ちは別スレッド。
            #[cfg(target_os = "windows")]
            {
                notifications::windows::begin_start(handle.clone());
            }
            Ok(())
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOSのReopenには通知・AppIntentの起動も含まれる。
            // 設定を前面に出すのはメニューバーからの明示操作と初回案内だけ。
            // Dockに出している時だけ、Dockのクリックで小窓を開く (通知の受け取り直後のReopenは除く)。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event {
                if app.state::<AppSettings>().show_in_dock() {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        // 部品・URLからの起動なら、この間に受信の記録が入る
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        if received_within(&app.state::<AppSettings>(), 3) {
                            return;
                        }
                        let handle = app.clone();
                        app.run_on_main_thread(move || companion::show_window(&handle, companion::WINDOW)).ok();
                    });
                }
                return;
            }
            if let tauri::RunEvent::Exit = event {
                speech::system::set_enabled(false);
            }
        });
}

/// 直近 secs 秒以内に通知を受け取ったか (Dockのクリックと、通知によるReopenを見分ける)。
#[cfg(target_os = "macos")]
fn received_within(settings: &AppSettings, secs: u64) -> bool {
    settings
        .last_received
        .lock()
        .ok()
        .and_then(|last| last.as_ref().map(|n| now_secs().saturating_sub(n.at) <= secs))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_text_drops_invisible_chars_and_squeezes_spaces() {
        assert_eq!(
            clean_for_speech("招待です。 \u{200c} \u{200d}\u{200e}\u{200f} \u{200c}\n次へ"),
            "招待です。 次へ"
        );
    }

    #[test]
    fn speech_text_is_capped() {
        let long = "あ".repeat(SPEECH_MAX_CHARS + 10);
        let out = clean_for_speech(&long);
        assert_eq!(out.chars().count(), SPEECH_MAX_CHARS + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn invisible_only_notification_is_silent() {
        let settings = AppSettings::default();
        assert!(speak_notification(&settings, "x", "\u{200b}", "", Route::Direct).is_none());
    }

    #[test]
    fn unlisted_app_is_silent_by_default() {
        let settings = AppSettings::default();
        assert!(!should_speak(&settings, "dev.test", Route::Direct));
    }

    #[test]
    fn catalog_automation_names_are_safe() {
        assert!(catalog().iter().any(|a| !a.mac.is_empty()));
        for app in catalog() {
            // 名前検索がずれないよう、濁点・半濁点 (分解形になるもの) を含めない
            for variant in 0..app.mac.len().max(1) {
                let name = app_automation_name(&app.id, variant);
                assert_eq!(notifications::nfc(&name), name);
                assert!(!name.chars().any(|c| "がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポヴ".contains(c)));
            }
            assert_eq!(app_automation_name("chatgpt", 1), "readapp通知-chatgpt-2");
        }
    }

    #[test]
    fn app_character_reads_its_app_and_others_use_the_active_one() {
        let settings = AppSettings::default();
        settings.characters.lock().unwrap()[0].voice = "system:Kyoko".to_string();
        settings.characters.lock().unwrap()[2].voice = "system:Otoya".to_string();
        settings
            .app_characters
            .lock()
            .unwrap()
            .insert("slack".to_string(), "ren".to_string());
        assert_eq!(settings.character_for("slack").id, "ren");
        assert_eq!(settings.voice_for("slack"), "system:Otoya");
        assert_eq!(settings.character_for("discord").id, "mio");
        assert_eq!(settings.voice_for("discord"), "system:Kyoko");
        // 担当キャラが消えていたら、いま話すキャラが読む
        settings.characters.lock().unwrap().retain(|c| c.id != "ren");
        assert_eq!(settings.character_for("slack").id, "mio");
    }

    #[test]
    fn global_off_never_speaks_but_keeps_targets_for_the_companion() {
        let settings = AppSettings::default();
        *settings.speech_enabled.lock().unwrap() = false;
        *settings.speak_all.lock().unwrap() = true;
        for route in [Route::Direct, Route::Shortcut] {
            for app in [SELF_APP_ID, INTENT_APP_ID, "slack", "dev.test"] {
                // 対象のまま (小窓に吹き出しを出す) だが、声は出さない
                assert!(should_speak(&settings, app, route));
                assert!(speak_notification(&settings, app, "会議中", "", route).is_none());
            }
        }
        assert!(speak_now(&settings, "preview", "試聴", "", telemetry::Trigger::Preview, None).is_none());
    }

    #[test]
    fn companion_bubbles_open_only_real_source_apps() {
        // readapp自身・試し読み・通知元不明の吹き出しは開かない
        for app in [SELF_APP_ID, INTENT_APP_ID, "preview"] {
            assert!(!can_open_source_app(app, Some("readapp")));
        }
        // カタログのアプリはバンドルIDで、見つけたアプリは名前で開く
        assert!(can_open_source_app("slack", None));
        assert!(can_open_source_app("notion", Some("Notion")));
        assert!(!can_open_source_app("notion", None));
        assert!(!can_open_source_app("notion", Some("  ")));
    }

    #[test]
    fn global_off_is_persisted_and_old_settings_still_enable_speech() {
        let settings = AppSettings::default();
        assert!(settings.speech_enabled());
        *settings.speech_enabled.lock().unwrap() = false;
        let json = serde_json::to_string(&settings.snapshot()).unwrap();
        let saved: SavedSettings = serde_json::from_str(&json).unwrap();
        assert!(!saved.speech_enabled);
        let old: SavedSettings = serde_json::from_str(r#"{"voice":"system"}"#).unwrap();
        assert!(old.speech_enabled);
    }

    #[test]
    fn dock_icon_stays_hidden_by_default_and_round_trips() {
        let settings = AppSettings::default();
        assert!(!settings.show_in_dock());
        *settings.show_in_dock.lock().unwrap() = true;
        let json = serde_json::to_string(&settings.snapshot()).unwrap();
        assert!(serde_json::from_str::<SavedSettings>(&json).unwrap().show_in_dock);
        // 旧形式 (項目なし) は今までどおりDockに出さない
        let old: SavedSettings = serde_json::from_str(r#"{"voice":"system"}"#).unwrap();
        assert!(!old.show_in_dock);
    }

    #[test]
    fn login_item_status_maps_to_plain_states() {
        assert_eq!(login_item_label(1), "enabled");
        assert_eq!(login_item_label(2), "requires_approval");
        assert_eq!(login_item_label(0), "disabled");
        assert_eq!(login_item_label(3), "disabled");
        assert_eq!(login_item_label(-1), "unsupported");
    }

    #[test]
    fn volume_defaults_to_full_and_round_trips() {
        let settings = AppSettings::default();
        assert_eq!(settings.volume(), 100);
        *settings.volume.lock().unwrap() = 40;
        let json = serde_json::to_string(&settings.snapshot()).unwrap();
        let back: SavedSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.volume, 40);
        // 旧形式 (volumeなし) は100
        let old: SavedSettings = serde_json::from_str(r#"{"voice":"system"}"#).unwrap();
        assert_eq!(old.volume, 100);
    }

    #[test]
    fn app_characters_round_trip_and_old_app_voices_are_moved() {
        let settings = AppSettings::default();
        settings
            .app_characters
            .lock()
            .unwrap()
            .insert("slack".to_string(), "aoi".to_string());
        let json = serde_json::to_string(&settings.snapshot()).unwrap();
        assert!(!json.contains("app_voices"));
        let back: SavedSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.app_characters.get("slack").map(String::as_str), Some("aoi"));
        // 旧形式の「アプリごとの声」は、その声のキャラを担当にする
        let old = AppSettings::default();
        let path = std::env::temp_dir().join(format!("readapp-app-voices-{}.json", std::process::id()));
        std::fs::write(&path, r#"{"persona":"mio","voice":"system","app_voices":{"slack":"system:Otoya"},"onboarded":true}"#).unwrap();
        old.load(&path);
        std::fs::remove_file(&path).ok();
        assert_eq!(old.voice_for("slack"), "system:Otoya");
        assert_eq!(old.character_for("slack").name, "Slack用");
        assert_eq!(old.voice_for("discord"), "system");
    }

    #[test]
    fn readapp_self_notification_always_speaks() {
        let settings = AppSettings::default();
        assert_eq!(notifications::app_id_for("readapp"), SELF_APP_ID);
        settings.enabled.lock().unwrap().insert(SELF_APP_ID.to_string(), false);
        assert!(should_speak(&settings, SELF_APP_ID, Route::Direct));
    }

    #[test]
    fn shortcut_route_speaks_unlisted_app_unless_turned_off() {
        let settings = AppSettings::default();
        // ショートカット側で対象に選ばれたアプリ (例: LINE) は既定で読む
        assert!(should_speak(&settings, "line", Route::Shortcut));
        settings.enabled.lock().unwrap().insert("line".to_string(), false);
        assert!(!should_speak(&settings, "line", Route::Shortcut));
    }

    #[test]
    fn catalog_app_speaks_by_default() {
        let settings = AppSettings::default();
        assert!(should_speak(&settings, "slack", Route::Direct));
        assert!(should_speak(&settings, "calendar", Route::Direct));
    }

    #[test]
    fn added_app_speaks_and_speak_all_covers_unlisted() {
        let settings = AppSettings::default();
        settings.enabled.lock().unwrap().insert("dev.test".to_string(), true);
        assert!(should_speak(&settings, "dev.test", Route::Direct));
        *settings.speak_all.lock().unwrap() = true;
        assert!(should_speak(&settings, "other", Route::Direct));
    }

    #[test]
    fn app_label_prefers_saved_name_then_catalog() {
        let settings = AppSettings::default();
        assert_eq!(app_label(&settings, "calendar").as_deref(), Some("カレンダー"));
        assert_eq!(app_label(&settings, "preview"), None);
        settings.names.lock().unwrap().insert("googlechrome".into(), "Google Chrome".into());
        assert_eq!(app_label(&settings, "googlechrome").as_deref(), Some("Google Chrome"));
    }

    #[test]
    fn disabled_app_is_skipped() {
        let settings = AppSettings::default();
        settings
            .enabled
            .lock()
            .unwrap()
            .insert("dev.test".to_string(), false);
        assert!(!should_speak(&settings, "dev.test", Route::Direct));
    }

    #[test]
    fn raw_passthrough_keeps_text() {
        assert_eq!(transform::raw::transform("作業が完了しました。"), "作業が完了しました。");
    }

    #[test]
    fn raw_mode_skips_persona_transform() {
        let settings = AppSettings::default();
        settings.characters.lock().unwrap()[0].style = characters::STYLE_RAW.to_string();
        assert_eq!(
            transform::transform_text(&settings, "作業が完了しました。", None),
            "作業が完了しました。"
        );
    }

    #[test]
    fn characters_round_trip_and_active_falls_back_to_first() {
        let settings = AppSettings::default();
        let mut list = settings.characters();
        list[1].voice = "system:Otoya".to_string();
        *settings.characters.lock().unwrap() = list;
        *settings.active_character.lock().unwrap() = list_id(&settings, 1);
        let json = serde_json::to_string(&settings.snapshot()).unwrap();
        let back: SavedSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.active_character, "aoi");
        assert_eq!(back.characters[1].voice, "system:Otoya");
        // 古い版へ戻しても、いまのキャラの声と口調が残る
        assert_eq!(back.voice, "system:Otoya");
        assert_eq!(back.persona, "aoi");
        // 消えたキャラを指していたら先頭のキャラで話す
        *settings.active_character.lock().unwrap() = "gone".to_string();
        assert_eq!(settings.active().id, "mio");
    }

    fn list_id(settings: &AppSettings, i: usize) -> String {
        settings.characters()[i].id.clone()
    }

    #[test]
    fn legacy_settings_become_the_chosen_character() {
        let settings = AppSettings::default();
        let path = std::env::temp_dir().join(format!("readapp-legacy-characters-{}.json", std::process::id()));
        std::fs::write(&path, r#"{"persona":"ren","voice":"system:Kyoko","mode":"raw","onboarded":true}"#).unwrap();
        settings.load(&path);
        std::fs::remove_file(&path).ok();
        assert_eq!(settings.active().id, "ren");
        assert_eq!(settings.voice(), "system:Kyoko");
        assert_eq!(settings.mode(), Mode::Raw);
        assert!(*settings.migrated_from_legacy.lock().unwrap());
    }

    #[test]
    fn persona_mode_without_helper_falls_back_to_raw() {
        let settings = AppSettings::default();
        assert!(settings.helper_path().is_none());
        assert_eq!(
            transform::transform_text(&settings, "作業が完了しました。", None),
            "作業が完了しました。"
        );
    }

    #[test]
    fn persona_mode_with_broken_helper_falls_back_to_raw() {
        let settings = AppSettings::default();
        settings.set_helper_path(Some(std::path::PathBuf::from("/nonexistent/fm-helper")));
        assert_eq!(
            transform::transform_text(&settings, "作業が完了しました。", None),
            "作業が完了しました。"
        );
    }

    #[test]
    fn same_notification_from_two_routes_is_fresh_once() {
        let settings = AppSettings::default();
        // 直接監視は「タイトル。本文」、部品は「タイトル\n本文」で届く
        assert!(fresh_notification(&settings, "slack", "会議。15時から", Route::Direct));
        assert!(!fresh_notification(&settings, "slack", "会議\n15時から", Route::Shortcut));
        assert!(fresh_notification(&settings, "slack", "会議。16時から", Route::Direct));
    }

    #[test]
    fn three_or_more_receipts_do_not_reopen_duplicate_notification() {
        for first in [Route::Direct, Route::Shortcut] {
            let settings = AppSettings::default();
            assert!(fresh_notification(&settings, "slack", "会議。15時から", first));
            for route in [Route::Shortcut, Route::Direct, Route::Shortcut, Route::Direct] {
                assert!(!fresh_notification(&settings, "slack", "会議\n15時から", route));
            }
            assert_eq!(settings.recent_spoken.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn simultaneous_receipts_accept_only_one_transform() {
        let settings = AppSettings::default();
        std::thread::scope(|scope| {
            let accepted: Vec<_> = (0..12).map(|i| {
                let settings = &settings;
                scope.spawn(move || accept_notification(settings, "slack", "会議", "15時から", if i % 2 == 0 { Route::Direct } else { Route::Shortcut }))
            }).collect();
            assert_eq!(accepted.into_iter().map(|h| h.join().unwrap()).filter(|accepted| *accepted).count(), 1);
        });
    }

    #[test]
    fn duplicate_is_read_again_after_window_expires() {
        let settings = AppSettings::default();
        assert!(fresh_notification(&settings, "slack", "了解。", Route::Direct));
        settings.recent_spoken.lock().unwrap()[0].at = std::time::Instant::now() - DUPLICATE_WINDOW;
        assert!(fresh_notification(&settings, "slack", "了解。", Route::Shortcut));
    }

    /// 試し読み上げの1通知が、ショートカット (分解形の本文) と直接監視 (合成済み) の両方から届く場合
    #[cfg(target_os = "macos")]
    #[test]
    fn decomposed_shortcut_text_matches_direct_capture() {
        let settings = AppSettings::default();
        assert!(fresh_notification(&settings, "readapp", "Claudeの作業か\u{3099}終わりました。", Route::Shortcut));
        assert!(!accept_notification(&settings, "readapp", "", "Claudeの作業が終わりました。", Route::Direct));
    }

    #[test]
    fn same_text_on_same_route_at_once_is_one_notification() {
        // 汎用とアプリ別のオートメーションが同じ通知で同時に動いた場合
        let settings = AppSettings::default();
        assert!(fresh_notification(&settings, "slack", "了解。", Route::Shortcut));
        assert!(!fresh_notification(&settings, "slack", "了解。", Route::Shortcut));
    }

    #[test]
    fn unknown_source_and_app_at_once_is_one_notification() {
        // 汎用 (アプリ名が空 → shortcut) とアプリ別 (slack) が同じ通知で同時に動いた場合
        let settings = AppSettings::default();
        assert!(fresh_notification(&settings, INTENT_APP_ID, "了解。", Route::Shortcut));
        assert!(!fresh_notification(&settings, "slack", "了解。", Route::Shortcut));
    }

    #[test]
    fn same_text_from_another_app_at_once_is_read() {
        let settings = AppSettings::default();
        assert!(fresh_notification(&settings, "slack", "了解。", Route::Shortcut));
        assert!(fresh_notification(&settings, "discord", "了解。", Route::Shortcut));
        assert!(fresh_notification(&settings, "mail", "了解。", Route::Direct));
    }

    #[test]
    fn same_text_on_same_route_later_is_another_notification() {
        let settings = AppSettings::default();
        let old = std::time::Instant::now() - SAME_ROUTE_WINDOW - std::time::Duration::from_millis(10);
        settings.recent_spoken.lock().unwrap().push(RecentSpoken {
            key: notification_key("了解。"),
            app_id: "slack".into(),
            route: Route::Direct,
            at: old,
        });
        assert!(fresh_notification(&settings, "slack", "了解。", Route::Direct));
    }

    #[test]
    fn duplicate_key_keeps_meaningful_symbols() {
        let settings = AppSettings::default();
        assert!(fresh_notification(&settings, "slack", "予算1.5万円", Route::Direct));
        assert!(fresh_notification(&settings, "slack", "予算15万円", Route::Shortcut));
    }

    #[test]
    fn intent_without_app_always_speaks() {
        assert_eq!(intent_target("  "), IntentTarget::Always);
    }

    #[test]
    fn intent_app_name_maps_to_settings_key() {
        assert_eq!(
            intent_target("Slack"),
            IntentTarget::App { id: "slack".into(), name: "Slack".into() }
        );
        // ショートカットの変数は分解形で届くことがある (正規化はmacOSのみ)
        #[cfg(target_os = "macos")]
        assert_eq!(
            intent_target("カレンタ\u{3099}ー"),
            IntentTarget::App { id: "calendar".into(), name: "カレンダー".into() }
        );
    }

    #[test]
    fn fallback_does_not_speak_source_line() {
        let settings = AppSettings::default();
        settings.set_helper_path(Some(std::path::PathBuf::from("/nonexistent/fm-helper")));
        assert_eq!(
            transform::transform_text(&settings, "資料できました", Some("Slack")),
            "資料できました"
        );
    }

    #[test]
    fn default_persona_is_mio() {
        let settings = AppSettings::default();
        assert_eq!(settings.persona(), "mio");
        assert!(transform::personas().iter().any(|p| p.id == "mio"));
    }

    #[test]
    fn settings_round_trip_through_json() {
        let settings = AppSettings::default();
        settings
            .enabled
            .lock()
            .unwrap()
            .insert("slack".to_string(), true);
        let json = serde_json::to_string(&settings.snapshot()).unwrap();
        let back: SavedSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.enabled.get("slack"), Some(&true));
        assert_eq!(back.persona, "mio");
        assert!(!back.onboarded);
        assert!(!back.speak_all);
    }

    #[test]
    fn speak_all_overrides_explicit_off() {
        let settings = AppSettings::default();
        settings
            .enabled
            .lock()
            .unwrap()
            .insert("slack".to_string(), false);
        assert!(!should_speak(&settings, "slack", Route::Direct));
        *settings.speak_all.lock().unwrap() = true;
        assert!(should_speak(&settings, "slack", Route::Direct));
    }

    #[test]
    fn old_settings_migrate_enabled_and_persona() {
        let settings = AppSettings::default();
        let old = serde_json::json!({
            "enabled": {"slack": true},
            "mode": {"slack": "raw"},
            "persona": {"slack": "aoi"},
            "voice": {"slack": "system:Kyoko"},
            "default_persona": "aoi",
            "onboarded": true
        });
        let dir = std::env::temp_dir().join("readapp-migrate-test.json");
        std::fs::write(&dir, serde_json::to_string(&old).unwrap()).unwrap();
        settings.load(&dir);
        std::fs::remove_file(&dir).ok();
        assert!(should_speak(&settings, "slack", Route::Direct));
        assert_eq!(settings.persona(), "aoi");
        assert!(settings.onboarded.lock().map(|b| *b).unwrap_or(false));
    }
}
