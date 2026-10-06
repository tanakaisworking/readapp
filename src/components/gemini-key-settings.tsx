import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { SettingsApi } from "@/hooks/useSettings";
import { SpeechIssueNotice } from "@/components/speech-issue-notice";

export function GeminiKeySettings({ api }: { api: SettingsApi }) {
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const issue = api.speechIssue?.voice_id.startsWith("gemini:") ? api.speechIssue : null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.saveGeminiKey(key.trim());
      setMessage("保存しました。下からGeminiの声を選べます。");
      setConfirmDelete(false);
    } catch (e) {
      setError(typeof e === "string" ? e : "APIキーを保存できませんでした。もう一度お試しください。");
    } finally {
      setKey(""); setVisible(false); setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.deleteGeminiKey();
      setKey(""); setVisible(false); setConfirmDelete(false);
      setMessage("このMacからキーを削除しました。");
    } catch (e) {
      setError(typeof e === "string" ? e : "APIキーを削除できませんでした。もう一度お試しください。");
    } finally { setBusy(false); }
  };

  if (api.geminiByok && !api.geminiByok.supported) return null;
  return (
    <div className="mt-3 rounded-md bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium">自分のGemini APIキー</p>
        <span className="text-xs text-muted-foreground">{api.geminiByok ? api.geminiByok.configured ? issue ? issue.kind === "quota" ? "使用上限" : "要確認" : "登録済み" : "未登録" : "確認中…"}</span>
      </div>
      {issue && <div className="mt-2"><SpeechIssueNotice issue={issue} compact /></div>}
      <p id="gemini-key-description" className="mt-1.5 text-xs leading-relaxed text-muted-foreground">キーはこのMacのKeychainに保存します。読み上げる文章をGoogleへ直接送り、料金と利用上限は自分のプロジェクトに紐づきます。</p>
      {api.geminiByokError ? <div className="mt-2 text-xs leading-relaxed" role="status">
        <p>{api.geminiByokError}</p><Button size="sm" variant="ghost" onClick={() => void api.refreshGeminiByok()}>もう一度確認</Button>
      </div> : api.geminiByok && <form onSubmit={(event) => void save(event)} className="mt-3">
        <label htmlFor="gemini-api-key" className="block text-xs font-medium">Gemini APIキー{api.geminiByok.configured && "を変更"}</label>
        <div className="mt-1.5 flex items-center gap-1.5">
          <input id="gemini-api-key" type={visible ? "text" : "password"} value={key} onChange={(event) => setKey(event.target.value)}
            autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={256} disabled={busy}
            aria-describedby="gemini-key-description" placeholder="Google AI Studioで発行したキー"
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50" />
          <Button type="button" size="sm" variant="ghost" disabled={busy || !key} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "隠す" : "表示"}</Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !key.trim()}>{busy ? "処理中…" : "保存"}</Button>
          {api.geminiByok.configured && !confirmDelete && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setConfirmDelete(true); setMessage(null); setError(null); }}>キーを削除</Button>}
        </div>
      </form>}
      {confirmDelete && <div className="mt-3 text-xs leading-relaxed">
        <p>このMacに保存したキーを削除します。Googleのキー自体は削除されません。</p>
        <div className="mt-2 flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>キャンセル</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void remove()}>削除する</Button></div>
      </div>}
      {(message || error) && <p role="status" className="mt-2 text-xs leading-relaxed">{error ?? message}</p>}
    </div>
  );
}
