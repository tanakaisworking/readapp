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
                // 同じ名前の声が複数入っていることがある (例: Kyoko)。sayでは名前でしか選べないので1つにまとめる
                if voices.iter().any(|v: &SystemVoice| v.name == name) {
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

/// 音量の上限 (%)。これ未満の時だけ音量を付けて再生する。
pub const MAX_VOLUME: u8 = 100;

fn queue() -> &'static mpsc::Sender<(String, String, u8)> {
    static TX: OnceLock<mpsc::Sender<(String, String, u8)>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<(String, String, u8)>();
        std::thread::spawn(move || {
            for (text, voice, volume) in rx {
                speak_once(&text, &voice, volume);
            }
        });
        tx
    })
}

/// 読み上げ要求をキューへ。呼び出し元は待たない。空文字と音量0は捨てる。
/// volume は 0〜100 (%)。
pub fn speak(text: &str, voice: &str, volume: u8) {
    if text.is_empty() || volume == 0 {
        return;
    }
    queue()
        .send((text.to_string(), voice.to_string(), volume.min(MAX_VOLUME)))
        .ok();
}

/// afplay -v に渡す値 (1.0 が元の大きさ)。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn afplay_volume(volume: u8) -> String {
    format!("{:.2}", f32::from(volume.min(MAX_VOLUME)) / 100.0)
}

fn speak_once(text: &str, voice: &str, volume: u8) {
    #[cfg(target_os = "macos")]
    {
        // "--" 以降は必ず本文として扱う。--input-file= 等のオプション解釈を防ぐ。
        let mut cmd = Command::new("say");
        if let Some(name) = voice.strip_prefix("system:") {
            cmd.arg("-v").arg(name);
        }
        if volume >= MAX_VOLUME {
            // 既定の音量: すぐ読み始められるよう、そのまま喋らせる
            if let Ok(mut child) = cmd.arg("--").arg(text).spawn() {
                child.wait().ok();
            }
            return;
        }
        // sayには音量の指定が無く、文中の [[volm]] はOS既定の声 (システム音声) に効かない (2026-10-06 実測)。
        // そこで一度書き出してから afplay で音量を付けて再生する。書き出しの分 (1〜2秒) 読み始めが遅れる。
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let file = std::env::temp_dir().join(format!("readapp-speech-{}-{n}.aiff", std::process::id()));
        let written = cmd
            .arg("-o")
            .arg(&file)
            .arg("--")
            .arg(text)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if written {
            if let Ok(mut child) = Command::new("afplay")
                .arg("-v")
                .arg(afplay_volume(volume))
                .arg(&file)
                .spawn()
            {
                child.wait().ok();
            }
        }
        std::fs::remove_file(&file).ok();
    }
    #[cfg(target_os = "windows")]
    {
        // 本文・声名は環境変数で渡し、スクリプトに埋め込まない。
        // PowerShellはスマートクォートも区切りと解釈するため、エスケープでは防げない。
        // CREATE_NO_WINDOW でコンソールウィンドウの表示を抑える。
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        // 音量は SpeechSynthesizer.Volume (0〜100) にそのまま渡す
        let script = if voice.strip_prefix("system:").is_some() {
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.SelectVoice($env:READAPP_VOICE) } catch {}; $s.Volume = [int]$env:READAPP_VOLUME; $s.Speak($env:READAPP_SPEECH_TEXT)"
        } else {
            "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Volume = [int]$env:READAPP_VOLUME; $s.Speak($env:READAPP_SPEECH_TEXT)"
        };
        let voice_name = voice.strip_prefix("system:").unwrap_or("");
        if let Ok(mut child) = Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .env("READAPP_SPEECH_TEXT", text)
            .env("READAPP_VOICE", voice_name)
            .env("READAPP_VOLUME", volume.min(MAX_VOLUME).to_string())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            child.wait().ok();
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (text, voice, volume);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn afplay_volume_is_linear_fraction() {
        assert_eq!(afplay_volume(100), "1.00");
        assert_eq!(afplay_volume(35), "0.35");
        assert_eq!(afplay_volume(250), "1.00");
    }
}
