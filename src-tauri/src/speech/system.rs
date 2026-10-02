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

fn queue() -> &'static mpsc::Sender<String> {
    static TX: OnceLock<mpsc::Sender<String>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for text in rx {
                speak_once(&text);
            }
        });
        tx
    })
}

/// 読み上げ要求をキューへ。呼び出し元は待たない。空文字は捨てる。
pub fn speak(text: &str) {
    if text.is_empty() {
        return;
    }
    queue().send(text.to_string()).ok();
}

fn speak_once(text: &str) {
    #[cfg(target_os = "macos")]
    {
        // "--" 以降は必ず本文として扱う。--input-file= 等のオプション解釈を防ぐ。
        if let Ok(mut child) = Command::new("say").arg("--").arg(text).spawn() {
            child.wait().ok();
        }
    }
    #[cfg(target_os = "windows")]
    {
        // 本文は環境変数で渡し、スクリプトに埋め込まない。
        // PowerShellはスマートクォートも区切りと解釈するため、エスケープでは防げない。
        // CREATE_NO_WINDOW でコンソールウィンドウの表示を抑える。
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        if let Ok(mut child) = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak($env:READAPP_SPEECH_TEXT)",
            ])
            .env("READAPP_SPEECH_TEXT", text)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            child.wait().ok();
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = text;
    }
}
