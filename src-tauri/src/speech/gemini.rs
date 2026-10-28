//! BYOKはGoogle直結。Workerや事業者キーへは切り替えない。
use super::playback::{Playback, Request};
use super::premium::{curl_quote, speech_style, valid_wav, MODEL, VOICES};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

const URL: &str = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_RESPONSE: usize = 9_000_000;
const MAX_AUDIO: usize = 6_000_000;
/// プロジェクトの月の利用額の上限 (AI Studio の spend cap)。429で返るが、待っても翌月まで解けない。
pub(crate) const SPEND_CAP: &str =
    "自分のGeminiプロジェクトが月の利用額の上限に達しました。AI Studioで上限を確認してください";

pub fn is_voice(id: &str) -> bool {
    id.strip_prefix("gemini:")
        .is_some_and(|v| VOICES.contains(&v))
}

fn payload(text: &str, voice: &str, voice_prompt: &str) -> serde_json::Value {
    serde_json::json!({"model":MODEL,"store":false,
        "input":[{"type":"user_input","content":[{"type":"text","text":text,
            "annotations":[{"type":"speech_metadata","style":speech_style(voice_prompt)}]}]}],
        "response_format":{"type":"audio","mime_type":"audio/wav"},
        "generation_config":{"speech_config":[{"voice":voice}]}})
}

fn config(key: &str, text: &str, voice: &str, voice_prompt: &str, file: &std::path::Path) -> String {
    format!("url=\"{URL}\"\nheader=\"x-goog-api-key: {key}\"\nheader=\"Content-Type: application/json\"\ndata=\"{}\"\noutput=\"{}\"\n", curl_quote(&payload(text, voice, voice_prompt).to_string()), curl_quote(&file.to_string_lossy()))
}

/// 応答本文は表示・ログへ出さない。ステータスから固定の日本語だけを返す。
fn audio(bytes: &[u8]) -> Result<Vec<u8>, &'static str> {
    if bytes.len() > MAX_RESPONSE {
        return Err("Geminiの音声データが大きすぎます");
    }
    let data: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "Geminiに接続できませんでした")?;
    if data.get("error").is_some() {
        let code = &data["error"]["code"];
        // 本文は見分けに使うだけで、表示・ログには出さない。
        let message = data["error"]["message"].as_str().unwrap_or_default();
        if message.contains("spending cap") || message.contains("spend cap") {
            return Err(SPEND_CAP);
        }
        return Err(match (code.as_str(), code.as_u64()) {
            (Some("authentication" | "permission_denied"), _) | (_, Some(401 | 403)) => {
                "GeminiのAPIキーや利用権限を確認してください"
            }
            (Some("rate_limit_exceeded" | "quota_exceeded" | "too_many_requests"), _)
            | (_, Some(429)) => {
                "自分のGeminiプロジェクトの利用上限に達しました。時間をおいて試してください"
            }
            (Some("payment_required" | "failed_precondition"), _) | (_, Some(402)) => {
                "自分のGeminiプロジェクトの課金設定や残高を確認してください"
            }
            (Some("invalid_request" | "parameter_unknown"), _) | (_, Some(400)) => {
                "Geminiの音声生成の設定を確認してください"
            }
            _ => "Geminiで音声を生成できませんでした",
        });
    }
    let encoded = data["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|step| step["type"] == "model_output")
        .flat_map(|step| step["content"].as_array().into_iter().flatten())
        .filter(|block| block["type"] == "audio")
        .last()
        .ok_or("Geminiから音声が返りませんでした")?;
    if encoded["mime_type"] != "audio/wav" {
        return Err("Geminiの音声形式を確認できませんでした");
    }
    let encoded = encoded["data"]
        .as_str()
        .filter(|s| s.len() <= MAX_AUDIO * 4 / 3 + 4)
        .ok_or("Geminiの音声データが大きすぎます")?;
    let wav = STANDARD
        .decode(encoded)
        .map_err(|_| "Geminiの音声データを読み込めませんでした")?;
    if !valid_wav(&wav) {
        return Err("Geminiの音声データを読み込めませんでした");
    }
    Ok(wav)
}

struct TempFile(PathBuf);
impl TempFile {
    fn create() -> Result<Self, &'static str> {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "readapp-speech-gemini-{}-{}.wav",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(&path)
            .map_err(|_| "音声を保存できませんでした")?;
        Ok(Self(path))
    }
}
impl Drop for TempFile {
    fn drop(&mut self) {
        std::fs::remove_file(&self.0).ok();
    }
}

pub(super) fn speak(
    text: &str,
    id: &str,
    voice_prompt: &str,
    playback: &Playback,
    request: Request,
) -> Result<(), &'static str> {
    if !playback.accepts(request) {
        return Ok(());
    }
    let voice = id
        .strip_prefix("gemini:")
        .filter(|v| VOICES.contains(v))
        .ok_or("声を選び直してください")?;
    if text.is_empty() || text.chars().count() > 1000 {
        return Err("読み上げる文章は1000文字以内にしてください");
    }
    let key = super::gemini_key::get()?;
    // 読み取り中の削除・更新にも、run_with_inputの世代検査が効く。
    let file = TempFile::create()?;
    let config = config(&key, text, voice, voice_prompt, &file.0);
    let success = playback.run_with_input(
        Command::new("curl")
            .args([
                // ユーザーのcurlrcによる認証ログ出力や接続先変更を避ける。
                "--disable",
                "--silent",
                "--fail-with-body",
                "--max-time",
                "45",
                "--connect-timeout",
                "10",
                "--proto",
                "=https",
                "--max-filesize",
                "9000000",
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
    let bytes = std::fs::read(&file.0).map_err(|_| "Geminiから音声を受信できませんでした")?;
    let wav = audio(&bytes)?;
    if !success {
        return Err("Geminiに接続できませんでした");
    }
    std::fs::write(&file.0, wav).map_err(|_| "音声を保存できませんでした")?;
    #[cfg(target_os = "macos")]
    {
        let volume = format!("{:.2}", f32::from(playback.volume()) / 100.0);
        if !playback.run(
            Command::new("afplay").arg("-v").arg(volume).arg(&file.0),
            request,
        ) && playback.accepts(request)
        {
            return Err("Geminiの音声を再生できませんでした");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_only_explicit_byok_voices() {
        assert!(is_voice("gemini:Kore"));
        assert!(!is_voice("cloud:Kore"));
        assert!(!super::super::premium::is_voice("gemini:Kore"));
        assert!(!is_voice("gemini:arbitrary"));
    }
    #[test]
    fn request_uses_direct_google_header_exact_transcript_and_no_storage() {
        let text = "引用\"と改行\nで指示に変わらない文章。";
        let p = payload(text, "Aoede", "明るく元気な声。");
        assert_eq!(p["model"], MODEL);
        assert_eq!(p["store"], false);
        assert_eq!(p["input"][0]["content"][0]["text"], text);
        // 声の出し方は読み方の指示にだけ入り、読む文章には混ざらない
        assert_eq!(p["input"][0]["content"][0]["annotations"][0]["style"], "明るく元気な声。 Read the text exactly as written.");
        assert_eq!(p["generation_config"]["speech_config"][0]["voice"], "Aoede");
        let c = config(
            "test-only-not-a-real-api-key-123",
            text,
            "Aoede",
            "",
            std::path::Path::new("/tmp/test.wav"),
        );
        assert!(c.contains(URL));
        assert!(c.contains("x-goog-api-key:"));
        assert!(!c.contains("workers.dev"));
        assert!(!c.contains("Authorization:"));
        assert_eq!(c.lines().count(), 5);
    }
    #[test]
    fn decodes_last_wav_and_rejects_invalid_audio_without_echoing_details() {
        let mut wav = vec![0u8; 44];
        wav[..4].copy_from_slice(b"RIFF");
        wav[8..12].copy_from_slice(b"WAVE");
        let data = serde_json::json!({"steps":[{"type":"model_output","content":[{"type":"text","text":"ignored"},{"type":"audio","mime_type":"audio/wav","data":STANDARD.encode(&wav)}]}]});
        assert_eq!(audio(&serde_json::to_vec(&data).unwrap()).unwrap(), wav);
        assert!(audio(b"{\"steps\":[]}").is_err());
        assert!(audio(b"{\"steps\":[null]}").is_err());
        assert!(audio(b"malformed upstream private information")
            .unwrap_err()
            .contains("接続"));
        assert!(audio(&vec![0; MAX_RESPONSE + 1]).is_err());
    }
    #[test]
    fn distinguishes_own_project_quota_from_invalid_credentials() {
        for code in ["rate_limit_exceeded", "quota_exceeded", "too_many_requests"] {
            let error = serde_json::json!({"error":{"code":code,"message":"private details"}});
            assert!(audio(&serde_json::to_vec(&error).unwrap())
                .unwrap_err()
                .contains("自分のGeminiプロジェクト"));
        }
        for code in ["authentication", "permission_denied"] {
            let error = serde_json::json!({"error":{"code":code,"message":"private details"}});
            assert!(audio(&serde_json::to_vec(&error).unwrap())
                .unwrap_err()
                .contains("APIキー"));
        }
        assert!(
            audio(br#"{"error":{"code":"payment_required","message":"private details"}}"#)
                .unwrap_err()
                .contains("課金設定")
        );
        assert!(
            audio(br#"{"error":{"code":429,"message":"private details"}}"#)
                .unwrap_err()
                .contains("自分のGeminiプロジェクト")
        );
        assert!(
            audio(br#"{"error":{"code":403,"message":"private details"}}"#)
                .unwrap_err()
                .contains("APIキー")
        );
    }
    #[test]
    fn monthly_spend_cap_is_not_reported_as_a_temporary_limit() {
        // 2026-10-27 に実際に返った応答と同じ形
        let body = br#"{"error":{"code":"too_many_requests","message":"Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap."}}"#;
        assert_eq!(audio(body).unwrap_err(), SPEND_CAP);
        assert_eq!(super::super::status::error_kind(SPEND_CAP), super::super::status::IssueKind::Billing);
    }
    #[test]
    fn temporary_audio_is_private_and_removed_on_drop() {
        let file = TempFile::create().unwrap();
        let path = file.0.clone();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        drop(file);
        assert!(!path.exists());
    }
}
