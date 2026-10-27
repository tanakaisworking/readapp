import { useState, type FormEvent } from "react";
import { issueBadge, type SettingsApi } from "@/hooks/useSettings";
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
      setMessage("保存しました。上の一覧からGeminiの声を選べます。");
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
  const status = !api.geminiByok
    ? { label: "確認中…", tone: "badge-ghost" }
    : !api.geminiByok.configured
      ? { label: "未登録", tone: "badge-ghost" }
      : issue
        ? { label: issueBadge(issue), tone: "badge-warning" }
        : { label: "登録済み", tone: "badge-success" };

  return (
    <div className="rounded-field bg-base-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium">自分のGemini APIキー</p>
        <span className={`badge badge-soft badge-sm ${status.tone}`}>{status.label}</span>
      </div>
      {issue && <div className="mt-2"><SpeechIssueNotice issue={issue} compact /></div>}
      <p id="gemini-key-description" className="mt-1.5 text-xs leading-relaxed text-muted">
        {api.geminiByok?.configured ? "Gemini 3.8 Flash TTSの声を、自分のAPIキーで使えます。" : ""}
        キーはこのMacのKeychainに保存します。読み上げる文章をGoogleへ直接送り、料金と利用上限は自分のプロジェクトに紐づきます。
      </p>
      {api.geminiByokError ? (
        <div className="mt-2 text-xs leading-relaxed" role="status">
          <p>{api.geminiByokError}</p>
          <button type="button" className="btn btn-ghost btn-xs mt-1" onClick={() => void api.refreshGeminiByok()}>もう一度確認</button>
        </div>
      ) : api.geminiByok && (
        <form onSubmit={(event) => void save(event)} className="mt-3">
          <label htmlFor="gemini-api-key" className="block text-xs font-medium">Gemini APIキー{api.geminiByok.configured && "を変更"}</label>
          <div className="join mt-1.5 w-full">
            <input
              id="gemini-api-key"
              type={visible ? "text" : "password"}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              maxLength={256}
              disabled={busy}
              aria-describedby="gemini-key-description"
              placeholder="Google AI Studioで発行したキー"
              className="input input-sm join-item min-w-0 flex-1 text-xs"
            />
            <button type="button" className="btn btn-sm join-item" disabled={busy || !key} aria-pressed={visible} onClick={() => setVisible(!visible)}>
              {visible ? "隠す" : "表示"}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !key.trim()}>{busy ? "処理中…" : "保存"}</button>
            {api.geminiByok.configured && !confirmDelete && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setConfirmDelete(true); setMessage(null); setError(null); }}>
                キーを削除
              </button>
            )}
          </div>
        </form>
      )}
      {confirmDelete && (
        <div className="mt-3 rounded-field bg-base-100 p-2.5 text-xs leading-relaxed">
          <p>このMacに保存したキーを削除します。Googleのキー自体は削除されません。</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => setConfirmDelete(false)}>キャンセル</button>
            <button type="button" className="btn btn-error btn-soft btn-xs" disabled={busy} onClick={() => void remove()}>削除する</button>
          </div>
        </div>
      )}
      {(message || error) && <p role="status" className={`mt-2 text-xs leading-relaxed ${error ? "text-error" : ""}`}>{error ?? message}</p>}
    </div>
  );
}
