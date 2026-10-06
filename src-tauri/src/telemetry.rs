//! 読み上げのメタデータだけを送る。本文・キー・API応答を受け取る入口を作らない。
use crate::speech::{gemini, premium, status::IssueKind};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{mpsc, OnceLock};
use std::time::{Instant, SystemTime};
use uuid::Uuid;

const ENDPOINT: &str = "https://us.i.posthog.com/i/v0/e/";
const EVENT_NAME: &str = "readapp_speech";
// 個人APIキーではなく、送信専用の公開project token。ソースや設定ファイルに保存しない。
const PROJECT_TOKEN: Option<&str> = option_env!("READAPP_POSTHOG_PROJECT_TOKEN");
const QUEUE_CAPACITY: usize = 128;
static TX: OnceLock<mpsc::SyncSender<Value>> = OnceLock::new();

#[derive(Clone, Copy)]
pub(crate) enum Trigger {
    Direct,
    Shortcut,
    Preview,
}

impl Trigger {
    fn name(self) -> &'static str {
        match self {
            Self::Direct => "direct",
            Self::Shortcut => "shortcut",
            Self::Preview => "preview",
        }
    }
}

pub(crate) struct Context {
    source_app_id: String,
    trigger: Trigger,
}

impl Context {
    pub(crate) fn new(app_id: &str, trigger: Trigger) -> Self {
        // アプリ識別子の形だけを受け付ける。URL・文章・制御文字を送り込まない。
        let valid = !app_id.is_empty()
            && app_id.chars().count() <= 120
            && app_id
                .chars()
                .all(|c| c.is_alphanumeric() || "._-".contains(c));
        Self {
            source_app_id: if valid { app_id } else { "unknown" }.to_owned(),
            trigger,
        }
    }
}

#[derive(Clone, Copy)]
struct Engine {
    provider: &'static str,
    model: &'static str,
}

impl Engine {
    fn for_voice(voice: &str) -> Self {
        if gemini::is_voice(voice) {
            Self {
                provider: "gemini_byok",
                model: premium::MODEL,
            }
        } else if premium::is_voice(voice) {
            Self {
                provider: "cloudflare_worker",
                model: premium::MODEL,
            }
        } else {
            Self {
                provider: "system",
                // OS音声の内部モデル名は公開されていないので方式名を記録する。
                model: match std::env::consts::OS {
                    "macos" => "macos-say",
                    "windows" => "windows-system-speech",
                    _ => "system-tts",
                },
            }
        }
    }
}

/// キューから実行に移った時に作る。停止で破棄した待機要求はイベントにしない。
pub(crate) struct SpeechEvent {
    context: Context,
    requested: Engine,
    timestamp: SystemTime,
    started: Instant,
}

impl SpeechEvent {
    pub(crate) fn start(context: Context, voice: &str) -> Self {
        Self {
            context,
            requested: Engine::for_voice(voice),
            timestamp: SystemTime::now(),
            started: Instant::now(),
        }
    }

    fn properties(
        &self,
        voice: &str,
        completed: bool,
        cancelled: bool,
        error: Option<IssueKind>,
    ) -> Value {
        let actual = Engine::for_voice(voice);
        let outcome = if cancelled {
            "cancelled"
        } else if completed {
            if error.is_some() {
                "fallback_completed"
            } else {
                "completed"
            }
        } else if error.is_some() {
            "fallback_failed"
        } else {
            "failed"
        };
        json!({
            "product": "readapp",
            "source_app_id": self.context.source_app_id,
            "trigger": self.context.trigger.name(),
            "requested_provider": self.requested.provider,
            "requested_model": self.requested.model,
            "provider": actual.provider,
            "model": actual.model,
            "outcome": outcome,
            "error_kind": error,
            "completed": completed && !cancelled,
            // 音声生成・再生の合計時間。音声の長さではない。
            "elapsed_ms": self.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            "app_version": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
            "distribution": if cfg!(feature = "mas") { "mas" } else { "standard" },
            "$process_person_profile": false,
            "$geoip_disable": true,
            // nullだと受信側が接続元IPを補完する。固定の未指定アドレスに置き換える。
            "$ip": "0.0.0.0",
        })
    }

    pub(crate) fn finish(
        self,
        voice: &str,
        completed: bool,
        cancelled: bool,
        error: Option<IssueKind>,
    ) {
        if let Some(tx) = TX.get() {
            let timestamp =
                DateTime::<Utc>::from(self.timestamp).to_rfc3339_opts(SecondsFormat::Millis, true);
            // 満杯・通信失敗でも読み上げを待たせない。ディスクへのイベント保存はしない。
            tx.try_send(json!({
                "event": EVENT_NAME,
                "timestamp": timestamp,
                "properties": self.properties(voice, completed, cancelled, error),
            }))
            .ok();
        }
    }
}

fn install_id(dir: &Path) -> Option<String> {
    let path = dir.join("analytics-install-id");
    if let Ok(value) = std::fs::read_to_string(&path) {
        return Uuid::parse_str(value.trim()).ok().map(|id| id.to_string());
    }
    std::fs::create_dir_all(dir).ok()?;
    let id = Uuid::new_v4().to_string();
    // 二重起動で既存のIDを上書きしない。
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(file) => file,
        Err(_) => {
            return std::fs::read_to_string(path)
                .ok()
                .and_then(|v| Uuid::parse_str(v.trim()).ok())
                .map(|id| id.to_string())
        }
    };
    file.write_all(id.as_bytes()).ok()?;
    Some(id)
}

pub(crate) fn init(dir: &Path) {
    let Some(token) = PROJECT_TOKEN.filter(|v| !v.is_empty()) else {
        return;
    };
    let Some(id) = install_id(dir) else {
        return;
    };
    let (tx, rx) = mpsc::sync_channel::<Value>(QUEUE_CAPACITY);
    if TX.set(tx).is_err() {
        return;
    }
    std::thread::spawn(move || {
        for mut event in rx {
            event["api_key"] = json!(token);
            event["distinct_id"] = json!(format!("readapp:{id}"));
            send(&event);
        }
    });
}

fn send(event: &Value) {
    let mut command = Command::new("curl");
    command
        .args([
            "--disable",
            "--silent",
            "--fail",
            "--proto",
            "=https",
            "--connect-timeout",
            "3",
            "--max-time",
            "5",
            "--request",
            "POST",
            "--header",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
            ENDPOINT,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let Ok(mut child) = command.spawn() else {
        return;
    };
    let written = child
        .stdin
        .take()
        .is_some_and(|mut stdin| serde_json::to_writer(&mut stdin, event).is_ok());
    if !written {
        child.kill().ok();
    }
    child.wait().ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_properties_are_an_allowlist_without_speech_or_credentials() {
        let event = SpeechEvent::start(Context::new("slack", Trigger::Direct), "gemini:Charon");
        let properties = event.properties("system", true, false, Some(IssueKind::Quota));
        let mut keys: Vec<_> = properties
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        let mut allowed = vec![
            "product",
            "source_app_id",
            "trigger",
            "requested_provider",
            "requested_model",
            "provider",
            "model",
            "outcome",
            "error_kind",
            "completed",
            "elapsed_ms",
            "app_version",
            "os",
            "distribution",
            "$process_person_profile",
            "$geoip_disable",
            "$ip",
        ];
        allowed.sort_unstable();
        assert_eq!(keys, allowed);
        assert_eq!(properties["outcome"], "fallback_completed");
        assert_eq!(properties["provider"], "system");
        assert_eq!(properties["requested_provider"], "gemini_byok");
        assert_eq!(properties["requested_model"], premium::MODEL);
        assert_eq!(properties["error_kind"], "quota");
        assert_eq!(properties["$process_person_profile"], false);
        assert_eq!(properties["$ip"], "0.0.0.0");
    }

    #[test]
    fn cancellation_and_playback_failure_are_never_counted_as_completed() {
        let event = SpeechEvent::start(Context::new("preview", Trigger::Preview), "cloud:Kore");
        let cancelled = event.properties("cloud:Kore", true, true, None);
        assert_eq!(cancelled["outcome"], "cancelled");
        assert_eq!(cancelled["completed"], false);
        assert_eq!(cancelled["trigger"], "preview");
        assert_eq!(cancelled["provider"], "cloudflare_worker");
        assert_eq!(
            event.properties("system", false, false, Some(IssueKind::Quota))["outcome"],
            "fallback_failed"
        );
        assert_eq!(
            event.properties("cloud:Kore", false, false, None)["outcome"],
            "failed"
        );
        assert_eq!(
            event.properties("cloud:Kore", true, false, None)["outcome"],
            "completed"
        );
    }

    #[test]
    fn source_app_id_rejects_sentences_urls_and_oversized_input() {
        for value in [
            "",
            "通知本文です。",
            "hello world",
            "https://example.com",
            "slack\nprivate",
        ] {
            assert_eq!(
                Context::new(value, Trigger::Shortcut).source_app_id,
                "unknown"
            );
        }
        assert_eq!(
            Context::new(&"a".repeat(121), Trigger::Shortcut).source_app_id,
            "unknown"
        );
        for value in ["slack", "com.openai.chat", "リマインダー"] {
            assert_eq!(Context::new(value, Trigger::Direct).source_app_id, value);
        }
    }

    #[test]
    fn installation_id_is_random_and_stable_without_reading_settings_or_keys() {
        let dir = std::env::temp_dir().join(format!("readapp-analytics-test-{}", Uuid::new_v4()));
        let first = install_id(&dir).unwrap();
        assert_eq!(first, install_id(&dir).unwrap());
        assert!(Uuid::parse_str(&first).is_ok());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
