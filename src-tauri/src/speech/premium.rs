//! 個別端末のセッションでWorkerへ接続。Googleキーはクライアントへ渡さない。
use super::playback::{Playback, Request};
use sha2::{Digest, Sha256};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

pub const MODEL: &str = "gemini-3.8-flash-tts";
const URL: &str = "https://readapp-tts.hibachi-pj.workers.dev/v1/tts";
const SERVICE: &str = "com.hibachi.readapp.cloud-tts";
const ACCOUNT: &str = "device-token";
pub(super) const VOICES: [&str; 4] = ["Kore", "Aoede", "Puck", "Charon"];
/// 声の出し方を書いていない時の読み方
const DEFAULT_STYLE: &str = "Natural, calm Japanese notification voice.";
/// どの声の出し方でも最後に付ける。声の出し方の指示で文章を言い換えさせない
const EXACT: &str = "Read the text exactly as written.";

/// Geminiの声への読み方の指示。キャラの声の出し方 (空なら既定) に、文章を変えずに読む指示を足す
pub(super) fn speech_style(voice_prompt: &str) -> String {
    let prompt = voice_prompt.trim();
    format!("{} {EXACT}", if prompt.is_empty() { DEFAULT_STYLE } else { prompt })
}

/// Workerへ送る本文。声の出し方はある時だけ送る (Worker側でも文章を変えずに読む指示を足す)
fn request_body(text: &str, voice: &str, voice_prompt: &str) -> String {
    let prompt = voice_prompt.trim();
    if prompt.is_empty() {
        serde_json::json!({"text": text, "voice": voice}).to_string()
    } else {
        serde_json::json!({"text": text, "voice": voice, "style": prompt}).to_string()
    }
}

fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn token() -> Option<&'static str> {
    static TOKEN: OnceLock<Option<String>> = OnceLock::new();
    TOKEN
        .get_or_init(|| {
            #[cfg(target_os = "macos")]
            let value = security_framework::passwords::get_generic_password(SERVICE, ACCOUNT)
                .ok()
                .and_then(|b| String::from_utf8(b).ok());
            #[cfg(not(target_os = "macos"))]
            let value = std::env::var("READAPP_TTS_TOKEN").ok();
            value.filter(|v| valid_token(v))
        })
        .as_deref()
}

pub fn configured() -> bool {
    token().is_some()
}
pub fn is_voice(id: &str) -> bool {
    id.strip_prefix("cloud:")
        .is_some_and(|v| VOICES.contains(&v))
}

/// アプリ自身の署名でlogin Keychainへ保存。出力はハッシュだけ。
pub fn provision_token() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let value = match security_framework::passwords::get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => String::from_utf8(bytes).map_err(|_| "端末認証の形式が不正です")?,
            Err(e) if e.code() == -25300 => {
                let mut random = [0u8; 32];
                security_framework::random::SecRandom::default()
                    .copy_bytes(&mut random)
                    .map_err(|_| "端末認証を生成できません")?;
                let value: String = random.iter().map(|b| format!("{b:02x}")).collect();
                security_framework::passwords::set_generic_password(
                    SERVICE,
                    ACCOUNT,
                    value.as_bytes(),
                )
                .map_err(|_| "Keychainへ保存できません")?;
                value
            }
            Err(_) => return Err("Keychainを読み込めません".into()),
        };
        if !valid_token(&value) {
            return Err("端末認証の形式が不正です".into());
        }
        Ok(format!("{:x}", Sha256::digest(value.as_bytes())))
    }
    #[cfg(not(target_os = "macos"))]
    Err("端末設定はmacOSで行ってください".into())
}

pub(super) fn curl_quote(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

pub(super) fn valid_wav(bytes: &[u8]) -> bool {
    bytes.len() >= 44
        && bytes.len() <= 6_000_000
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WAVE"
}

/// 停止・消音でHTTP取得プロセスも止まる。再生には最新の音量を使う。
pub(super) fn speak(
    text: &str,
    voice: &str,
    voice_prompt: &str,
    playback: &Playback,
    request: Request,
    started: &dyn Fn(Option<&std::path::Path>),
) -> Result<(), &'static str> {
    if !playback.accepts(request) {
        return Ok(());
    }
    let Some(voice) = voice.strip_prefix("cloud:").filter(|v| VOICES.contains(v)) else {
        return Err("声を選び直してください");
    };
    let Some(token) = token() else {
        return Err("この端末のクラウド音声接続を設定してください");
    };
    if text.chars().count() > 1000 {
        return Err("読み上げる文章が長すぎます");
    }
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let file = std::env::temp_dir().join(format!(
        "readapp-speech-cloud-{}-{n}.wav",
        std::process::id()
    ));
    let result = (|| {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&file)
                .map_err(|_| "音声の保存に失敗しました")?;
        }
        let body = request_body(text, voice, voice_prompt);
        let config = format!("url=\"{URL}\"\nheader=\"Authorization: Bearer {token}\"\nheader=\"Content-Type: application/json\"\ndata=\"{}\"\noutput=\"{}\"\n", curl_quote(&body), curl_quote(&file.to_string_lossy()));
        let success = playback.run_with_input(
            Command::new("curl")
                .args([
                    "--silent",
                    "--fail-with-body",
                    "--max-time",
                    "45",
                    "--connect-timeout",
                    "10",
                    "--proto",
                    "=https",
                    "--max-filesize",
                    "6000000",
                    "--config",
                    "-",
                ])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null()),
            request,
            Some(config.as_bytes()),
        );
        if !playback.accepts(request) {
            return Ok(());
        }
        let bytes = std::fs::read(&file).map_err(|_| "音声を受信できませんでした")?;
        if !success || !valid_wav(&bytes) {
            let code = serde_json::from_slice::<serde_json::Value>(&bytes)
                .ok()
                .and_then(|v| v["code"].as_str().map(str::to_owned));
            return Err(match code.as_deref() {
                Some("unauthorized") => "端末の接続設定を確認してください",
                Some("daily_limit") => "クラウド音声の今日の上限に達しました",
                Some("rate_limit") => "クラウド音声が混み合っています。少し待ってください",
                Some("provider_limit") => "Gemini音声の利用上限に達しました。時間をおいて試してください",
                _ => "クラウド音声を生成できませんでした",
            });
        }
        #[cfg(target_os = "macos")]
        {
            let volume = format!("{:.2}", f32::from(playback.volume()) / 100.0);
            if !playback.accepts(request) {
                return Ok(());
            }
            started(Some(&file));
            let played = playback.run(
                Command::new("afplay").arg("-v").arg(volume).arg(&file),
                request,
            );
            if !played && playback.accepts(request) {
                return Err("音声を再生できませんでした");
            }
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            started(Some(&file));
            playback.run(Command::new("powershell").args(["-NoProfile", "-Command", "$p = New-Object System.Media.SoundPlayer $env:READAPP_AUDIO; $p.PlaySync()"])
                .env("READAPP_AUDIO", &file).creation_flags(0x08000000), request);
        }
        Ok(())
    })();
    std::fs::remove_file(&file).ok();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_voices_and_bad_credentials() {
        assert!(is_voice("cloud:Kore"));
        assert!(!is_voice("cloud:voice_other"));
        assert!(!valid_token("unsafe\nheader"));
        assert!(valid_token(&"a".repeat(64)));
    }
    #[test]
    fn config_cannot_inject_headers_or_options() {
        assert_eq!(curl_quote("a\n\"\\b\r"), "a\\n\\\"\\\\b\\r");
    }
    #[test]
    fn voice_prompt_is_sent_only_when_written_and_never_drops_the_exact_reading() {
        assert_eq!(speech_style("  "), "Natural, calm Japanese notification voice. Read the text exactly as written.");
        assert_eq!(speech_style(" 元気に "), "元気に Read the text exactly as written.");
        let plain: serde_json::Value = serde_json::from_str(&request_body("本文", "Kore", "")).unwrap();
        assert!(plain.get("style").is_none());
        let styled: serde_json::Value = serde_json::from_str(&request_body("本文", "Kore", " 元気に ")).unwrap();
        assert_eq!(styled["style"], "元気に");
        assert_eq!(styled["text"], "本文");
    }
    #[test]
    fn only_wav_can_be_played() {
        let mut bytes = [0; 44];
        bytes[..4].copy_from_slice(b"RIFF");
        bytes[8..12].copy_from_slice(b"WAVE");
        assert!(valid_wav(&bytes));
        assert!(!valid_wav(b"{\"code\":\"unauthorized\"}"));
    }
}
