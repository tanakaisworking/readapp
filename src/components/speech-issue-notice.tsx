import { useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SPEND_CAP_MESSAGE, type SpeechIssue } from "@/hooks/useSettings";

const titles: Record<SpeechIssue["kind"], string> = {
  quota: "使用上限に達しました",
  authentication: "接続設定を確認してください",
  billing: "課金設定を確認してください",
  connection: "音声を生成できませんでした",
};

interface Props {
  issue: SpeechIssue;
  compact?: boolean;
  onDismiss?: () => void;
  onUseSystem?: () => Promise<void>;
}

export function SpeechIssueNotice({ issue, compact = false, onDismiss, onUseSystem }: Props) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ownKey = issue.voice_id.startsWith("gemini:");
  const spendCap = ownKey && issue.message === SPEND_CAP_MESSAGE;
  const description = spendCap
    ? "Googleのプロジェクトに設定した、月の利用額の上限を超えています。翌月まで待つか、AI Studioで上限を引き上げてください。同じプロジェクトのAPIキーは、新しく作ったものも上限を共有します。"
    : issue.kind === "quota" && ownKey
      ? "Google側の使用上限に達しています。"
      : issue.message;
  const title = spendCap
    ? "月の利用額の上限に達しました"
    : ownKey && issue.kind === "authentication" ? "APIキーを確認してください" : titles[issue.kind];
  // 利用額の上限は利用額の設定画面、それ以外はレート制限の画面を開く
  const studioUrl = spendCap ? "https://ai.studio/spend" : "https://aistudio.google.com/rate-limit";
  const useSystem = async () => {
    if (!onUseSystem || busy) return;
    setBusy(true); setActionError(null);
    try { await onUseSystem(); }
    catch { setActionError("声を変更できませんでした。もう一度お試しください。"); }
    finally { setBusy(false); }
  };

  return (
    <div
      role={compact ? undefined : "status"}
      aria-atomic={compact ? undefined : true}
      className="alert alert-soft alert-warning flex flex-col items-stretch gap-0 px-3.5 py-3 text-left"
    >
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {!compact && <p className="text-[11px] text-muted">{ownKey ? "Gemini · 自分のAPIキー" : "クラウド音声"} · 前回の試行</p>}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label="状態のお知らせを閉じる" className="btn btn-ghost btn-xs btn-circle -me-1 -mt-0.5 text-base-content">
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-1.5 ps-6 text-xs leading-relaxed text-base-content">
        <p>{description}{description.endsWith("。") ? "" : "。"}{issue.kind === "quota" && ownKey && "時間をおいて試してください。"}</p>
        <p className="mt-0.5 text-muted">通知はシステム音声で読み上げます。</p>
        {(onUseSystem || ownKey) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {onUseSystem && (
              <button type="button" className="btn btn-xs" disabled={busy} onClick={() => void useSystem()}>
                {busy ? "変更中…" : "システム音声を使う"}
              </button>
            )}
            {ownKey && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => { setActionError(null); void openUrl(studioUrl).catch(() => setActionError("Google AI Studioを開けませんでした。ブラウザからご確認ください。")); }}
              >
                {spendCap ? "上限を確認" : "利用状況を確認"}
              </button>
            )}
          </div>
        )}
        {actionError && <p className="mt-2" role="status">{actionError}</p>}
      </div>
    </div>
  );
}
