//! OS標準TTS (M1/M2/M3共通)。単一ワーカースレッドで直列化する。
//!
//! - 連続通知の音声重なりを防ぐ (キュー投入順に1件ずつ発声)
//! - 子プロセスを必ず wait() してゾンビ化を防ぐ
//! - 通知本文はコマンド文字列に埋め込まない (OSコマンド注入対策)

#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::sync::{mpsc, OnceLock};

/// OS標準の声。id "system" はOS既定の声、`system:<名前>` は指名。
#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemVoice {
    pub id: String,
    pub name: String,
    pub lang: String,
}

/// 日本語のOS標準声の一覧。無ければ空。
/// 185件全部は選べないので日本語に絞る (通知読みは日本語想定)。
pub fn list_voices() -> Vec<SystemVoice> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("say").arg("-v").arg("?").output();
        let mut voices = Vec::new();
        if let Ok(out) = out {
            // 形式: "<名前> (<言語>) <ja_JPなど> # <サンプル>"
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let mut parts = line.split_whitespace();
                let (Some(name), Some(locale)) =
                    (parts.next(), parts.nth(1))
                else {
                    continue;
                };
                if !locale.starts_with("ja") {
                    continue;
                }
                voices.push(SystemVoice {
                    id: format!("system:{name}"),
                    name: name.to_string(),
                    lang: "日本語".to_string(),
                });
            }
        }
        voices
    }
    #[cfg(target_os = "windows")]
    {
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + \"`t\" + $_.VoiceInfo.Culture }",
            ])
            .output();
        let mut voices = Vec::new();
        if let Ok(out) = out {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let mut parts = line.split('\t');
                if let (Some(name), Some(culture)) =
                    (parts.next(), parts.next())
                {
                    let name = name.trim();
                    let culture = culture.trim();
                    if name.is_empty() || !culture.starts_with("ja") {
                        continue;
                    }
                    voices.push(SystemVoice {
                        id: format!("system:{name}"),
                        name: name.to_string(),
                        lang: "日本語".to_string(),
                    });
                }
            }
        }
        voices
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}

fn queue() -> &'static mpsc::Sender<(String, String)> {
    static TX: OnceLock<mpsc::Sender<(String, String)>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<(String, String)>();
        std::thread::spawn(move || {
            for (text, voice) in rx {
                speak_once(&text, &voice);
            }
        });
        tx
    })
}

/// 読み上げ要求をキューへ。呼び出し元は待たない。空文字は捨てる。
pub fn speak(text: &str, voice: &str) {
    if text.is_empty() {
        return;
    }
    queue().send((text.to_string(), voice.to_string())).ok();
}

fn speak_once(text: &str, voice: &str) {
    #[cfg(target_os = "macos")]
    {
        // "--" 以降は必ず本文として扱う。--input-file= 等のオプション解釈を防ぐ。
        let mut cmd = Command::new("say");
        if let Some(name) = voice.strip_prefix("system:") {
            cmd.arg("-v").arg(name);
        }
        if let Ok(mut child) = cmd.arg("--").arg(text).spawn() {
            child.wait().ok();
        }
    }
    #[cfg(target_os = "windows")]
    {
        // 本文・声名は環境変数で渡し、スクリプトに埋め込まない。
        // PowerShellはスマートクォートも区切りと解釈するため、エスケープでは防げない。
        // CREATE_NO_WINDOW でコンソールウィンドウの表示を抑える。
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = if voice.strip_prefix("system:").is_some() {
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.SelectVoice($env:READAPP_VOICE) } catch {}; $s.Speak($env:READAPP_SPEECH_TEXT)"
        } else {
            "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($env:READAPP_SPEECH_TEXT)"
        };
        let voice_name = voice.strip_prefix("system:").unwrap_or("");
        if let Ok(mut child) = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .env("READAPP_SPEECH_TEXT", text)
            .env("READAPP_VOICE", voice_name)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            child.wait().ok();
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (text, voice);
    }
}
