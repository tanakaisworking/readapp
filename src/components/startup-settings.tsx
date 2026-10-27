import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SettingsApi } from "@/hooks/useSettings";
import type { FullState } from "@/lib/apps";

type LoginItem = "enabled" | "disabled" | "requires_approval" | "unsupported";

// 設定ウィンドウの「起動とDock」(macOSのみ)。
// ログイン時の起動はmacOSの「ログイン項目」が持つ状態をそのまま見せる (readapp側には保存しない)。
export function StartupSettings({ api, state }: { api: SettingsApi; state: FullState }) {
  const [loginItem, setLoginItem] = useState<LoginItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    invoke<LoginItem>("login_item_status").then(setLoginItem).catch(() => setLoginItem("unsupported"));
  }, []);

  // システム設定で許可して戻ってきた時に読み直す
  useEffect(() => {
    refresh();
    let off: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => payload && refresh())
      .then((f) => (disposed ? f() : (off = f)))
      .catch(() => {});
    return () => { disposed = true; off?.(); };
  }, [refresh]);

  const toggleLogin = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setLoginItem(await invoke<LoginItem>("set_login_item", { enabled }));
    } catch {
      setError(enabled ? "ログイン時の起動を設定できませんでした。もう一度お試しください。" : "ログイン時の起動を解除できませんでした。もう一度お試しください。");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const loginOn = loginItem === "enabled" || loginItem === "requires_approval";

  return (
    <section aria-labelledby="home-startup-heading">
      <h2 id="home-startup-heading" className="section-label">起動とDock</h2>
      <ul className="surface list mt-2">
        {loginItem !== "unsupported" && (
          <li className="list-row items-center gap-3 px-4 py-3">
            <div className="list-col-grow min-w-0">
              <label htmlFor="readapp-login-item" className="block text-sm font-medium">ログイン時に起動</label>
              <p className="text-xs leading-relaxed text-muted">
                {loginItem === "requires_approval"
                  ? "システム設定の「ログイン項目」で、readappを許可してください。"
                  : "Macにログインしたら、メニューバーに常駐します。"}
              </p>
              {loginItem === "requires_approval" && (
                <button type="button" className="btn btn-xs mt-1.5" onClick={() => void invoke("open_login_items_settings").catch(() => {})}>
                  <ExternalLink aria-hidden="true" />
                  システム設定を開く
                </button>
              )}
              {error && <p className="mt-1 text-xs text-error" role="alert">{error}</p>}
            </div>
            <input
              id="readapp-login-item"
              type="checkbox"
              role="switch"
              className="toggle toggle-primary toggle-sm"
              checked={loginOn}
              disabled={busy || loginItem === null}
              onChange={(e) => void toggleLogin(e.target.checked)}
            />
          </li>
        )}
        <li className="list-row items-center gap-3 px-4 py-3">
          <div className="list-col-grow min-w-0">
            <label htmlFor="readapp-show-dock" className="block text-sm font-medium">Dockにアイコンを表示</label>
            <p className="text-xs leading-relaxed text-muted">
              {state.show_in_dock
                ? "Dockのアイコンをクリックすると、小窓を開きます。"
                : "オフの間は、メニューバーのアイコンから使います。"}
            </p>
          </div>
          <input
            id="readapp-show-dock"
            type="checkbox"
            role="switch"
            className="toggle toggle-primary toggle-sm"
            checked={state.show_in_dock}
            onChange={(e) => void api.setShowInDock(e.target.checked)}
          />
        </li>
      </ul>
    </section>
  );
}
