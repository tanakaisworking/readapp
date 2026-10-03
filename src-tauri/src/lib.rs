// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod notifications;
pub mod speech;
pub mod subscription;
pub mod transform;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::State;

use crate::transform::Mode;

/// アプリ別の読み上げ設定。JSONで永続化する (M5)。
/// 考え方は「キャラを決める→対象アプリを決める」。
/// persona/voice/mode はキャラ側の持ち物で全体共有、アプリ側はON/OFFだけ。
pub struct AppSettings {
    enabled: Mutex<HashMap<String, bool>>,
    mode: Mutex<String>,
    persona: Mutex<String>,
    voice: Mutex<String>,
    onboarded: Mutex<bool>,
    data_file: Mutex<Option<PathBuf>>,
    /// macOS変換ヘルパーのパス。無ければ素文フォールバック (実行時のみ)。
    helper_path: Mutex<Option<PathBuf>>,
    /// 最後にパイプラインへ入った通知 (疎通確認用。実行時のみ)。
    last_received: Mutex<Option<ReceivedNotification>>,
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
    #[serde(default = "persona_mode_default")]
    mode: String,
    #[serde(default = "default_persona_id")]
    persona: String,
    #[serde(default = "default_voice_id")]
    voice: String,
    #[serde(default)]
    onboarded: bool,
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
            mode: Mutex::new(persona_mode_default()),
            persona: Mutex::new(default_persona_id()),
            voice: Mutex::new(default_voice_id()),
            onboarded: Mutex::new(false),
            data_file: Mutex::new(None),
            helper_path: Mutex::new(None),
            last_received: Mutex::new(None),
        }
    }
}

impl AppSettings {
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

    pub fn voice(&self) -> String {
        self.voice
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| default_voice_id())
    }

    pub fn helper_path(&self) -> Option<PathBuf> {
        self.helper_path.lock().map(|p| p.clone()).unwrap_or(None)
    }

    pub fn set_helper_path(&self, path: Option<PathBuf>) {
        if let Ok(mut p) = self.helper_path.lock() {
            *p = path;
        }
    }

    fn snapshot(&self) -> SavedSettings {
        SavedSettings {
            enabled: self.enabled.lock().map(|m| m.clone()).unwrap_or_default(),
            mode: self.mode.lock().map(|m| m.clone()).unwrap_or_else(|_| persona_mode_default()),
            persona: self.persona.lock().map(|p| p.clone()).unwrap_or_else(|_| default_persona_id()),
            voice: self.voice.lock().map(|v| v.clone()).unwrap_or_else(|_| default_voice_id()),
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
                    if let Ok(mut m) = self.mode.lock() {
                        *m = saved.mode;
                    }
                    if let Ok(mut p) = self.persona.lock() {
                        *p = saved.persona;
                    }
                    if let Ok(mut vv) = self.voice.lock() {
                        *vv = saved.voice;
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

/// notification → shouldSpeak() → transform() → speak() の shouldSpeak 部分。
/// 未登録アプリは読み上げる (default true)。
fn should_speak(settings: &AppSettings, app_id: &str) -> bool {
    settings
        .enabled
        .lock()
        .map(|m| m.get(app_id).copied().unwrap_or(true))
        .unwrap_or(true)
}

#[tauri::command]
fn get_settings(state: State<'_, AppSettings>) -> HashMap<String, bool> {
    state.enabled.lock().map(|m| m.clone()).unwrap_or_default()
}

#[tauri::command]
fn set_app_enabled(state: State<'_, AppSettings>, app_id: String, enabled: bool) {
    if let Ok(mut m) = state.enabled.lock() {
        m.insert(app_id, enabled);
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

#[derive(Serialize)]
struct FullState {
    enabled: HashMap<String, bool>,
    mode: String,
    persona: String,
    voice: String,
    onboarded: bool,
}

#[tauri::command]
fn get_state(state: State<'_, AppSettings>) -> FullState {
    let s = state.snapshot();
    FullState {
        enabled: s.enabled,
        mode: s.mode,
        persona: s.persona,
        voice: s.voice,
        onboarded: s.onboarded,
    }
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

/// アクセシビリティ許可の状態 (macOS直接監視用)。
#[tauri::command]
fn ax_trusted() -> bool {
    #[cfg(target_os = "macos")]
    {
        notifications::ax::trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// プロンプト付きで許可を要求する。初回はシステムダイアログが出る。
#[tauri::command]
fn ax_request_access() -> bool {
    #[cfg(target_os = "macos")]
    {
        notifications::ax::request_prompt()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// 直接監視が動作中か。
#[tauri::command]
fn ax_watching() -> bool {
    #[cfg(target_os = "macos")]
    {
        notifications::ax::watching()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[tauri::command]
fn ax_open_settings() {
    #[cfg(target_os = "macos")]
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
) -> Option<String> {
    if !should_speak(settings, app_id) {
        return None;
    }
    let raw = if title.is_empty() {
        body.to_string()
    } else if body.is_empty() {
        title.to_string()
    } else {
        format!("{}。{}", title, body)
    };
    let text = transform::transform_text(settings, &raw);
    speech::system::speak(&text, &settings.voice());
    Some(text)
}

/// URLスキーム受信 (M3): readapp://notify?... をパイプラインに流す。
fn handle_notify_url(settings: &AppSettings, url: &url::Url) {
    if let Some(n) = notifications::macos::parse_notify_url(url) {
        record_received(settings, &n.app_id, &n.title, &n.body);
        speak_notification(settings, &n.app_id, &n.title, &n.body);
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
    if let Ok(mut l) = settings.last_received.lock() {
        *l = Some(ReceivedNotification {
            app_id: app_id.to_string(),
            text,
            at: now_secs(),
        });
    }
}

/// テスト用: 実通知なしでパイプライン一気通貫 (M1)。
/// OFFのアプリは "skipped" を返して喋らない。
#[tauri::command]
fn test_speak(
    state: State<'_, AppSettings>,
    app_id: String,
    title: String,
    body: String,
) -> Result<String, String> {
    Ok(speak_notification(&state, &app_id, &title, &body).unwrap_or_else(|| "skipped".to_string()))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 二重起動を既存インスタンスへ転送 (deep-link機能でURLも転送される)。
        // Windowsで別プロセスが設定を迂回するのを防ぐ。
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppSettings::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_platform,
            ax_trusted,
            ax_request_access,
            ax_watching,
            ax_open_settings,
            get_system_voices,
            download_shortcut,
            shortcut_installed,
            run_shortcut,
            get_last_received,
            get_state,
            get_settings,
            set_app_enabled,
            set_mode,
            get_personas,
            set_persona,
            set_voice,
            set_onboarded,
            windows_ensure_access,
            test_speak
        ])
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            let handle = app.handle().clone();
            // 保存済み設定の読み込み (M5)。無ければ既定値のまま。
            {
                let settings = handle.state::<AppSettings>();
                if let Ok(dir) = app.path().app_data_dir() {
                    settings.load(&dir.join("settings.json"));
                }
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
            // 起動時URL (cold start: アプリ停止中にURLで開かれた場合)
            if let Ok(Some(urls)) = handle.deep_link().get_current() {
                let settings = handle.state::<AppSettings>();
                for url in &urls {
                    handle_notify_url(&settings, url);
                }
            }
            // 起動中URL (macOSは起動中イベントで届く)
            let moved = handle.clone();
            handle.deep_link().on_open_url(move |event| {
                let settings = moved.state::<AppSettings>();
                for url in event.urls() {
                    handle_notify_url(&settings, &url);
                }
            });
            // macOS直接監視を開始 (dmg版。許可済みの場合のみ)。
            #[cfg(target_os = "macos")]
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_app_speaks_by_default() {
        let settings = AppSettings::default();
        assert!(should_speak(&settings, "dev.test"));
    }

    #[test]
    fn disabled_app_is_skipped() {
        let settings = AppSettings::default();
        settings
            .enabled
            .lock()
            .unwrap()
            .insert("dev.test".to_string(), false);
        assert!(!should_speak(&settings, "dev.test"));
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
            transform::transform_text(&settings, "作業が完了しました。"),
            "作業が完了しました。"
        );
    }

    #[test]
    fn persona_mode_without_helper_falls_back_to_raw() {
        let settings = AppSettings::default();
        assert!(settings.helper_path().is_none());
        assert_eq!(
            transform::transform_text(&settings, "作業が完了しました。"),
            "作業が完了しました。"
        );
    }

    #[test]
    fn persona_mode_with_broken_helper_falls_back_to_raw() {
        let settings = AppSettings::default();
        settings.set_helper_path(Some(std::path::PathBuf::from("/nonexistent/fm-helper")));
        assert_eq!(
            transform::transform_text(&settings, "作業が完了しました。"),
            "作業が完了しました。"
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
        assert!(should_speak(&settings, "slack"));
        assert_eq!(settings.persona(), "aoi");
        assert!(settings.onboarded.lock().map(|b| *b).unwrap_or(false));
    }
}
