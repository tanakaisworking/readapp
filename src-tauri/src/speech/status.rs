//! 最後のクラウド音声の失敗。キー・本文・Googleの応答は保持しない。
use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IssueKind {
    Quota,
    Authentication,
    Billing,
    Connection,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SpeechIssue {
    pub voice_id: String,
    pub kind: IssueKind,
    pub message: &'static str,
}

impl SpeechIssue {
    fn new(voice: &str, message: &'static str) -> Self {
        // 入力はTTSクライアントが返す固定メッセージのみ。APIの生の本文は使わない。
        let kind = match message {
            "自分のGeminiプロジェクトの利用上限に達しました。時間をおいて試してください"
            | "Gemini音声の利用上限に達しました。時間をおいて試してください"
            | "クラウド音声の今日の上限に達しました"
            | "クラウド音声が混み合っています。少し待ってください" => {
                IssueKind::Quota
            }
            "GeminiのAPIキーや利用権限を確認してください"
            | "GeminiのAPIキーを登録してください"
            | "APIキーを登録し直してください"
            | "端末の接続設定を確認してください"
            | "この端末のクラウド音声接続を設定してください" => {
                IssueKind::Authentication
            }
            "自分のGeminiプロジェクトの課金設定や残高を確認してください" => {
                IssueKind::Billing
            }
            _ => IssueKind::Connection,
        };
        Self {
            voice_id: voice.to_owned(),
            kind,
            message,
        }
    }
}

#[derive(Default)]
struct Status(Option<SpeechIssue>);

impl Status {
    fn report(&mut self, voice: &str, message: &'static str) -> bool {
        let next = SpeechIssue::new(voice, message);
        if self.0.as_ref() == Some(&next) {
            return false;
        }
        self.0 = Some(next);
        true
    }

    fn clear_for(&mut self, voice: &str) -> bool {
        let provider = voice.split_once(':').map(|(p, _)| p);
        if self
            .0
            .as_ref()
            .is_some_and(|issue| issue.voice_id.split_once(':').map(|(p, _)| p) == provider)
        {
            self.0 = None;
            return true;
        }
        false
    }
}

static STATUS: Mutex<Status> = Mutex::new(Status(None));

pub(crate) fn error_kind(message: &'static str) -> IssueKind {
    SpeechIssue::new("", message).kind
}

pub fn get() -> Option<SpeechIssue> {
    STATUS.lock().ok().and_then(|s| s.0.clone())
}

pub(super) fn report(
    voice: &str,
    message: &'static str,
    still_current: impl FnOnce() -> bool,
) -> bool {
    // キー変更の取消と状態クリアの間に、古い失敗を再登録しない。
    STATUS
        .lock()
        .map(|mut s| still_current() && s.report(voice, message))
        .unwrap_or(false)
}

pub(super) fn clear_for(voice: &str) -> bool {
    STATUS
        .lock()
        .map(|mut s| s.clear_for(voice))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_quota_credentials_billing_and_connection() {
        for message in [
            "自分のGeminiプロジェクトの利用上限に達しました。時間をおいて試してください",
            "クラウド音声の今日の上限に達しました",
            "Gemini音声の利用上限に達しました。時間をおいて試してください",
        ] {
            assert_eq!(
                SpeechIssue::new("gemini:Charon", message).kind,
                IssueKind::Quota
            );
        }
        assert_eq!(
            SpeechIssue::new("gemini:Kore", "GeminiのAPIキーや利用権限を確認してください").kind,
            IssueKind::Authentication
        );
        assert_eq!(
            SpeechIssue::new(
                "gemini:Kore",
                "自分のGeminiプロジェクトの課金設定や残高を確認してください"
            )
            .kind,
            IssueKind::Billing
        );
        assert_eq!(
            SpeechIssue::new("gemini:Kore", "Geminiに接続できませんでした").kind,
            IssueKind::Connection
        );
    }

    #[test]
    fn duplicate_errors_do_not_reopen_a_dismissed_notice() {
        let mut status = Status::default();
        assert!(status.report("gemini:Kore", "Geminiに接続できませんでした"));
        assert!(!status.report("gemini:Kore", "Geminiに接続できませんでした"));
        assert!(status.report("gemini:Kore", "GeminiのAPIキーや利用権限を確認してください"));
    }

    #[test]
    fn success_or_key_update_clears_only_the_same_provider() {
        let mut status = Status::default();
        status.report("gemini:Kore", "Geminiに接続できませんでした");
        assert!(!status.clear_for("system"));
        assert!(!status.clear_for("cloud:Kore"));
        assert!(status.clear_for("gemini:Charon"));
        assert!(status.0.is_none());
        status.report("gemini:Charon", "Geminiに接続できませんでした");
        assert!(status.clear_for("gemini:"));
    }
}
