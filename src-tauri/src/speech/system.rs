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

use super::playback::{Playback, Request};
use crate::telemetry::{Context, SpeechEvent};

pub fn set_app_handle(handle: tauri::AppHandle) {
    APP_HANDLE.set(handle).ok();
}
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

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

fn playback() -> &'static Playback {
    static PLAYBACK: OnceLock<Playback> = OnceLock::new();
    PLAYBACK.get_or_init(Playback::new)
}

pub fn set_volume(volume: u8) {
    playback().set_volume(volume);
}

pub fn set_enabled(enabled: bool) {
    playback().set_enabled(enabled);
}

pub fn cancel_pending() {
    playback().cancel_pending();
}

fn notify_remote_status() {
    if let Some(handle) = APP_HANDLE.get() {
        use tauri::Emitter;
        handle.emit("speech-issue-changed", super::status::get()).ok();
    }
}

pub(super) fn clear_byok_issue() {
    if super::status::clear_for("gemini:") { notify_remote_status(); }
}

/// 変換前に取得し、停止後に変換が終わっても古い音声を鳴らさない。
pub(crate) fn request() -> Option<SpeechRequest> {
    playback().request().map(SpeechRequest)
}

#[derive(Clone, Copy)]
pub(crate) struct SpeechRequest(Request);

/// 読み上げ1件 (文・声・声の出し方・要求・計測・小窓の行)
type Job = (String, String, String, SpeechRequest, Context, u64);

fn queue() -> &'static mpsc::Sender<Job> {
    static TX: OnceLock<mpsc::Sender<Job>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        std::thread::spawn(move || {
            for (text, voice, voice_prompt, request, context, line) in rx {
                if playback().accepts(request.0) {
                    crate::companion::mark(line, crate::companion::LineState::Speaking);
                    speak_once(&text, &voice, &voice_prompt, playback().volume(), request, context);
                }
                crate::companion::mark(line, crate::companion::LineState::Done);
            }
        });
        tx
    })
}

/// 読み上げ要求をキューへ。停止前の要求・空文字は捨てる。line は小窓の行 (話し始め・終わりを伝える)。
/// voice_prompt はキャラの声の出し方 (Geminiの声だけが使う)。
pub(crate) fn speak(text: &str, voice: &str, voice_prompt: &str, request: SpeechRequest, context: Context, line: u64) -> bool {
    if text.is_empty() || !playback().accepts(request.0) {
        return false;
    }
    queue().send((text.to_string(), voice.to_string(), voice_prompt.to_string(), request, context, line)).is_ok()
}

/// 音量を下げた時の書き出し先の名前の頭。通知本文の音声なので、前回の終了時に残ったものは消す。
const SPEECH_FILE_PREFIX: &str = "readapp-speech-";

/// 起動時に呼ぶ。
pub fn remove_leftover_files() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(SPEECH_FILE_PREFIX) {
            std::fs::remove_file(entry.path()).ok();
        }
    }
}

/// afplay -v に渡す値 (1.0 が元の大きさ)。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn afplay_volume(volume: u8) -> String {
    format!("{:.2}", f32::from(volume.min(MAX_VOLUME)) / 100.0)
}

fn speak_once(text: &str, voice: &str, voice_prompt: &str, volume: u8, request: SpeechRequest, context: Context) {
    let event = SpeechEvent::start(context, voice);
    let mut remote_error = None;
    let remote = if super::gemini::is_voice(voice) {
        Some(super::gemini::speak(text, voice, voice_prompt, playback(), request.0))
    } else if super::premium::is_voice(voice) {
        Some(super::premium::speak(text, voice, voice_prompt, playback(), request.0))
    } else { None };
    if let Some(result) = remote {
        match result {
            Ok(()) => {
                let cancelled = !playback().accepts(request.0);
                event.finish(voice, !cancelled, cancelled, None);
                if !cancelled && super::status::clear_for(voice) {
                    notify_remote_status();
                }
                return;
            },
            Err(message) => {
                if !playback().accepts(request.0) {
                    event.finish(voice, false, true, None);
                    return;
                }
                remote_error = Some(super::status::error_kind(message));
                if super::status::report(voice, message, || playback().accepts(request.0)) { notify_remote_status(); }
            }
        }
    }
    let completed = speak_system(text, voice, volume, request);
    let actual_voice = if remote_error.is_some() { "system" } else { voice };
    event.finish(actual_voice, completed, !playback().accepts(request.0), remote_error);
}

fn speak_system(text: &str, voice: &str, volume: u8, request: SpeechRequest) -> bool {
    #[cfg(target_os = "macos")]
    {
        // "--" 以降は必ず本文として扱う。--input-file= 等のオプション解釈を防ぐ。
        let mut cmd = Command::new("say");
        if let Some(name) = voice.strip_prefix("system:") {
            cmd.arg("-v").arg(name);
        }
        if volume >= MAX_VOLUME {
            // 既定の音量: すぐ読み始められるよう、そのまま喋らせる
            return playback().run(cmd.arg("--").arg(text), request.0);
        }
        // sayには音量の指定が無く、文中の [[volm]] はOS既定の声 (システム音声) に効かない (2026-10-06 実測)。
        // そこで一度書き出してから afplay で音量を付けて再生する。書き出しの分 (1〜2秒) 読み始めが遅れる。
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let file = std::env::temp_dir().join(format!("{SPEECH_FILE_PREFIX}{}-{n}.aiff", std::process::id()));
        let written = playback().run(cmd.arg("-o").arg(&file).arg("--").arg(text), request.0);
        // 書き出し中に消音・停止したら再生しない。音量は最新の値を使う。
        let volume = playback().volume();
        let played = written && volume > 0 && playback().run(
                Command::new("afplay").arg("-v").arg(afplay_volume(volume)).arg(&file),
                request.0,
            );
        std::fs::remove_file(&file).ok();
        played
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
        playback().run(
            Command::new("powershell")
                .args(["-NoProfile", "-Command", script])
                .env("READAPP_SPEECH_TEXT", text)
                .env("READAPP_VOICE", voice_name)
                .env("READAPP_VOLUME", volume.min(MAX_VOLUME).to_string())
                .creation_flags(CREATE_NO_WINDOW),
            request.0,
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (text, voice, volume, request);
        false
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
