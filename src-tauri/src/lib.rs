// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(target_os = "macos")]
mod menubar;
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

/// アプリ別の読み上げ設定。JSONで永続化する (M5)。
/// 考え方は「キャラを決める→対象アプリを決める」。
/// persona/voice/mode はキャラ側の持ち物で全体共有。アプリ側はON/OFFと、声の上書き (任意)。
pub struct AppSettings {
    enabled: Mutex<HashMap<String, bool>>,
    /// すべて読み上げモード。ONなら個別設定に関わらず読む。
    speak_all: Mutex<bool>,
    /// 全体の読み上げ。OFFで再生中・待機中の音声も停止する。
    speech_enabled: Mutex<bool>,
    /// 表示名の上書き (ファイル選択で追加したアプリ用)。
    names: Mutex<HashMap<String, String>>,
    mode: Mutex<String>,
    persona: Mutex<String>,
    voice: Mutex<String>,
    /// アプリごとの声 (app_id → 声ID)。無いアプリは全体の声を使う。
    app_voices: Mutex<HashMap<String, String>>,
    /// 読み上げの音量 (0〜100 %)。
    volume: Mutex<u8>,
    onboarded: Mutex<bool>,
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
    #[serde(default = "persona_mode_default")]
    mode: String,
    #[serde(default = "default_persona_id")]
    persona: String,
    #[serde(default = "default_voice_id")]
    voice: String,
    #[serde(default)]
    app_voices: HashMap<String, String>,
    #[serde(default = "default_volume")]
    volume: u8,
    #[serde(default)]
    onboarded: bool,
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
            mode: Mutex::new(persona_mode_default()),
            persona: Mutex::new(default_persona_id()),
            voice: Mutex::new(default_voice_id()),
            app_voices: Mutex::new(HashMap::new()),
            volume: Mutex::new(default_volume()),
            onboarded: Mutex::new(false),
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

    pub fn mode(&self) -> Mode {
        self.mode
            .lock()
            .map(|m| Mode::from_str(m.as_str()))
            .unwrap_or(Mode::Persona)
    }

    pub fn persona(&self) -> String {
        self.persona
            .lock()
            .map(|p| p.clone())
            .unwrap_or_else(|_| default_persona_id())
    }

    /// 読み上げの音量 (0〜100 %)。
    pub fn volume(&self) -> u8 {
        self.volume.lock().map(|v| *v).unwrap_or_else(|_| default_volume())
    }

    /// そのアプリで使う声。アプリごとの声があればそれ、無ければ全体の声。
    pub fn voice_for(&self, app_id: &str) -> String {
        self.app_voices
            .lock()
            .ok()
            .and_then(|m| m.get(app_id).cloned())
            .unwrap_or_else(|| self.voice())
    }

    pub fn voice(&self) -> String {
        self.voice
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| default_voice_id())
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
        SavedSettings {
            enabled: self.enabled.lock().map(|m| m.clone()).unwrap_or_default(),
            speak_all: self.speak_all.lock().map(|b| *b).unwrap_or(false),
            speech_enabled: self.speech_enabled(),
            names: self.names.lock().map(|m| m.clone()).unwrap_or_default(),
            mode: self.mode.lock().map(|m| m.clone()).unwrap_or_else(|_| persona_mode_default()),
            persona: self.persona.lock().map(|p| p.clone()).unwrap_or_else(|_| default_persona_id()),
            voice: self.voice.lock().map(|v| v.clone()).unwrap_or_else(|_| default_voice_id()),
            app_voices: self.app_voices.lock().map(|m| m.clone()).unwrap_or_default(),
            volume: self.volume(),
            onboarded: self.onboarded.lock().map(|b| *b).unwrap_or(false),
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
                        *m = saved.names;
                    }
                    if let Ok(mut m) = self.mode.lock() {
                        *m = saved.mode;
                    }
                    if let Ok(mut p) = self.persona.lock() {
                        *p = saved.persona;
                    }
                    if let Ok(mut vv) = self.voice.lock() {
                        *vv = saved.voice;
                    }
                    if let Ok(mut m) = self.app_voices.lock() {
                        *m = saved.app_voices;
                    }
                    if let Ok(mut v) = self.volume.lock() {
                        *v = saved.volume.min(speech::system::MAX_VOLUME);
                        speech::system::set_volume(*v);
                    }
                    if let Ok(mut b) = self.onboarded.lock() {
                        *b = saved.onboarded;
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
                            if let Ok(mut cur) = self.persona.lock() {
                                *cur = p.to_string();
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
/// すべて読み上げモードなら全部読む。そうでなければ個別の設定に従う。
/// 未設定の既定:
/// - 直接届いた通知: カタログのアプリならON、それ以外 (見つけたアプリ) はOFF (UIの「追加すると読み上げます」と一致)
/// - ショートカット経由: ON (ユーザーがショートカット側で対象アプリに選んだもの。MAS版はアプリ別ON/OFFを出さない)
fn should_speak(settings: &AppSettings, app_id: &str, route: Route) -> bool {
    if !settings.speech_enabled() {
        return false;
    }
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
fn set_mode(state: State<'_, AppSettings>, mode: String) {
    let mode = Mode::from_str(&mode).as_str().to_string();
    if let Ok(mut m) = state.mode.lock() {
        *m = mode;
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

#[tauri::command]
fn get_personas() -> Vec<transform::Persona> {
    transform::personas()
}

#[tauri::command]
fn set_persona(state: State<'_, AppSettings>, persona_id: String) {
    if transform::personas().iter().any(|p| p.id == persona_id) {
        if let Ok(mut p) = state.persona.lock() {
            *p = persona_id;
        }
        state.save();
    }
}

#[tauri::command]
fn set_voice(state: State<'_, AppSettings>, voice_id: String) {
    // 存在しない声の指定は捨てる (OS既定・プレミアム枠・搭載声のみ受ける)
    const PREMIUM: [&str; 2] = ["clear", "warm"];
    let known = voice_id == "system"
        || speech::premium::is_voice(&voice_id)
        || speech::gemini::is_voice(&voice_id)
        || PREMIUM.contains(&voice_id.as_str())
        || speech::system::list_voices()
            .iter()
            .any(|v| v.id == voice_id);
    if !known {
        return;
    }
    if let Ok(mut v) = state.voice.lock() {
        *v = voice_id;
    }
    state.save();
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

/// アプリごとの声を設定する。None で解除 (全体の声に戻す)。
/// OS既定、このMacにある声、Gemini BYOKの声を受け付ける。
#[tauri::command]
fn set_app_voice(state: State<'_, AppSettings>, app_id: String, voice_id: Option<String>) {
    let app_id = app_id.trim().to_string();
    if app_id.is_empty() {
        return;
    }
    match voice_id {
        None => {
            if let Ok(mut m) = state.app_voices.lock() {
                m.remove(&app_id);
            }
        }
        Some(v) => {
            let known = v == "system" || speech::gemini::is_voice(&v) || speech::system::list_voices().iter().any(|sv| sv.id == v);
            if !known {
                return;
            }
            if let Ok(mut m) = state.app_voices.lock() {
                m.insert(app_id, v);
            }
        }
    }
    state.save();
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
    mode: String,
    persona: String,
    voice: String,
    app_voices: HashMap<String, String>,
    volume: u8,
    onboarded: bool,
}

#[tauri::command]
fn get_state(state: State<'_, AppSettings>) -> FullState {
    let s = state.snapshot();
    FullState {
        enabled: s.enabled,
        speak_all: s.speak_all,
        speech_enabled: s.speech_enabled,
        names: s.names,
        mode: s.mode,
        persona: s.persona,
        voice: s.voice,
        app_voices: s.app_voices,
        volume: s.volume,
        onboarded: s.onboarded,
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
    if !should_speak(settings, app_id, route) {
        return None;
    }
    if !fresh_notification(settings, app_id, &format!("{title}\n{body}"), route) {
        return None;
    }
    speak_now(settings, app_id, title, body, match route {
        Route::Direct => telemetry::Trigger::Direct,
        Route::Shortcut => telemetry::Trigger::Shortcut,
    })
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
/// 本文中の記号 (小数点など) は意味が変わるので残す。
fn notification_key(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace() && *c != '。').collect()
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
    if let Some(i) = recent.iter().position(|r| {
        r.key == key
            && (r.route != route || (same_app(&r.app_id) && now.duration_since(r.at) < SAME_ROUTE_WINDOW))
    }) {
        // 対になる受信を消費する (3回目以降の同文は改めて判定する)
        recent.remove(i);
        return false;
    }
    recent.push(RecentSpoken { key, app_id: app_id.to_string(), route, at: now });
    true
}

/// transform → speak (アプリ別ON/OFF判定なし)。キャラ口調ではアプリ名も渡し
/// 「Claudeの作業、終わったみたいだよ」のように言えるようにする。
fn speak_now(settings: &AppSettings, app_id: &str, title: &str, body: &str, trigger: telemetry::Trigger) -> Option<String> {
    if !settings.speech_enabled() {
        return None;
    }
    let request = speech::system::request()?;
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
    let text = transform::transform_text(settings, &raw, label.as_deref());
    speech::system::speak(&text, &settings.voice_for(app_id), request, telemetry::Context::new(app_id, trigger)).then_some(text)
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
                if settings.speech_enabled() && fresh_notification(&settings, INTENT_APP_ID, &text, Route::Shortcut) {
                    speak_now(&settings, INTENT_APP_ID, "", &text, telemetry::Trigger::Shortcut);
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
/// 変換に数秒かかるのでasync指定でメインスレッド (画面) を塞がない。
#[tauri::command(async)]
fn test_speak(
    state: State<'_, AppSettings>,
    app_id: String,
    title: String,
    body: String,
) -> Result<String, String> {
    Ok(speak_now(&state, &app_id, &title, &body, telemetry::Trigger::Preview).unwrap_or_default())
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
        // 非表示でもWKWebView生成はアプリをactivateする。設定を開くまで生成しない。
        for window in &mut context.config_mut().app.windows {
            if window.label == "main" {
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
            set_mode,
            get_personas,
            set_persona,
            set_voice,
            cloud_tts_configured,
            get_speech_issue,
            gemini_byok_status,
            save_gemini_key,
            delete_gemini_key,
            set_app_voice,
            set_volume,
            set_onboarded,
            windows_ensure_access,
            test_speak
        ])
        .setup(|app| {
            speech::system::set_app_handle(app.handle().clone());
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
            }
            // トレイを先に作り、窓を隠しても設定・終了の入口を失わないようにする。
            #[cfg(target_os = "macos")]
            {
                menubar::install(&handle)?;
                if !handle.state::<AppSettings>().onboarded.lock().map(|b| *b).unwrap_or(false) {
                    menubar::show_settings(&handle);
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
        .run(|_app, event| {
            // macOSのReopenには通知・AppIntentの起動も含まれる。
            // 設定を前面に出すのはメニューバーからの明示操作と初回案内だけ。
            if let tauri::RunEvent::Exit = event {
                speech::system::set_enabled(false);
            }
        });
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
    fn app_voice_overrides_global_voice() {
        let settings = AppSettings::default();
        *settings.voice.lock().unwrap() = "system:Kyoko".to_string();
        settings
            .app_voices
            .lock()
            .unwrap()
            .insert("slack".to_string(), "system:Otoya".to_string());
        assert_eq!(settings.voice_for("slack"), "system:Otoya");
        assert_eq!(settings.voice_for("discord"), "system:Kyoko");
    }

    #[test]
    fn global_off_blocks_all_notification_routes_and_previews() {
        let settings = AppSettings::default();
        *settings.speech_enabled.lock().unwrap() = false;
        *settings.speak_all.lock().unwrap() = true;
        for route in [Route::Direct, Route::Shortcut] {
            for app in [SELF_APP_ID, INTENT_APP_ID, "slack", "dev.test"] {
                assert!(!should_speak(&settings, app, route));
                assert!(speak_notification(&settings, app, "会議中", "", route).is_none());
            }
        }
        assert!(speak_now(&settings, "preview", "試聴", "", telemetry::Trigger::Preview).is_none());
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
    fn app_voices_round_trip_through_json() {
        let settings = AppSettings::default();
        settings
            .app_voices
            .lock()
            .unwrap()
            .insert("slack".to_string(), "system:Otoya".to_string());
        let json = serde_json::to_string(&settings.snapshot()).unwrap();
        let back: SavedSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.app_voices.get("slack").map(String::as_str), Some("system:Otoya"));
        // 旧形式 (app_voicesなし) も読める
        let old: SavedSettings = serde_json::from_str(r#"{"voice":"system"}"#).unwrap();
        assert!(old.app_voices.is_empty());
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
        *settings.mode.lock().unwrap() = "raw".to_string();
        assert_eq!(
            transform::transform_text(&settings, "作業が完了しました。", None),
            "作業が完了しました。"
        );
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
