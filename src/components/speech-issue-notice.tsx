import { useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import type { SpeechIssue } from "@/hooks/useSettings";

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
  const description = issue.kind === "quota" && ownKey
    ? "Google側の使用上限に達しています。"
    : issue.message;
  const useSystem = async () => {
    if (!onUseSystem || busy) return;
    setBusy(true); setActionError(null);
    try { await onUseSystem(); }
    catch { setActionError("声を変更できませんでした。もう一度お試しください。"); }
    finally { setBusy(false); }
  };

  return (
    <div role={compact ? undefined : "status"} aria-atomic={compact ? undefined : true} className="rounded-md bg-warning-soft p-3">
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {!compact && <p className="mb-1 text-xs text-muted-foreground">{ownKey ? "Gemini · 自分のAPIキー" : "クラウド音声"} · 前回の試行</p>}
          <h3 className="text-sm font-semibold">{ownKey && issue.kind === "authentication" ? "APIキーを確認してください" : titles[issue.kind]}</h3>
        </div>
        {onDismiss && <button type="button" onClick={onDismiss} aria-label="状態のお知らせを閉じる" className="rounded-sm p-1 text-muted-foreground outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-primary/50"><X className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
      <p className="mt-2 text-xs leading-relaxed">{description}{description.endsWith("。") ? "" : "。"}</p>
      {issue.kind === "quota" && ownKey && <p className="text-xs leading-relaxed">時間をおいて試してください。</p>}
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">通知はシステム音声で読み上げます。</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {onUseSystem && <Button size="sm" variant="outline" disabled={busy} onClick={() => void useSystem()}>{busy ? "変更中…" : "システム音声を使う"}</Button>}
        {ownKey && <Button size="sm" variant="ghost" onClick={() => { setActionError(null); void openUrl("https://aistudio.google.com/rate-limit").catch(() => setActionError("Google AI Studioを開けませんでした。ブラウザからご確認ください。")); }}>利用状況を確認</Button>}
      </div>
      {actionError && <p className="mt-2 text-xs leading-relaxed" role="status">{actionError}</p>}
    </div>
  );
}
