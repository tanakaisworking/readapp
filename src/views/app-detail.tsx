import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, Download, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppAvatar } from "@/components/app-avatar";
import { knownApp } from "@/lib/apps";
import { isOn, type SettingsApi } from "@/hooks/useSettings";
import type { FullState } from "@/lib/apps";

interface Props {
  api: SettingsApi;
  state: FullState;
  appId: string;
  platform: string;
  edition: string;
  speaking: boolean;
  onBack: () => void;
  onPreviewApp: (appId: string) => void;
}

export function AppDetail({ api, state, appId, platform, edition, speaking, onBack, onPreviewApp }: Props) {
  const app = knownApp(appId);
  const appName = state.names[appId] ?? app.name;
  const on = isOn(state, appId);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [linked, setLinked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [axOn, setAxOn] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    invoke<boolean>("shortcut_installed", { appId }).then(setInstalled).catch(() => setInstalled(false));
    if (platform === "macos") {
      invoke<boolean>("ax_trusted").then(setAxOn).catch(() => setAxOn(false));
    }
  }, [appId, platform]);

  // 登録作業から戻ってきたら自動で検出し直す (ポーリングなし)。
  // 空文の実行は無音で、受信記録だけが残る。
  useEffect(() => {
    if (platform !== "macos") return;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onFocusChanged((e) => {
        if (e.payload) {
          invoke<boolean>("ax_trusted").then(setAxOn).catch(() => {});
          void refreshStatus(true);
        }
      })
      .then((f) => {
        unlisten = f;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [appId, platform]);

  const download = async () => {
    try {
      const path = await invoke<string>("download_shortcut", { appId });
      setSavedPath(path);
    } catch {
      setSavedPath(null);
    }
  };

  const refreshStatus = async (autoLink: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const ok = await invoke<boolean>("shortcut_installed", { appId });
      setInstalled(ok);
      if (!ok) {
        setLinked(false);
        return;
      }
      // 初めて繋がったアプリは読み上げ対象に加える (明示OFFは尊重する)
      if (state.enabled[appId] === undefined) {
        await api.setEnabled(appId, true);
      }
      if (autoLink) {
        const t0 = Date.now();
        await invoke("run_shortcut", { appId }).catch(() => {});
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const last = await invoke<{ app_id: string; at: number } | null>("get_last_received").catch(() => null);
          if (last && last.app_id === appId && last.at * 1000 >= t0 - 3000) {
            setLinked(true);
            break;
          }
        }
      }
    } finally {
      busy.current = false;
      setChecking(false);
    }
  };

  const shortcutBadge = linked
    ? { label: "つながっています", tone: "badge-success" }
    : installed
      ? { label: "登録済み", tone: "badge-primary" }
      : { label: "未登録", tone: "badge-ghost" };

  return (
    <div className="space-y-5 px-4 pb-6 pt-3">
      <header className="flex items-center gap-1.5">
        <button type="button" onClick={onBack} aria-label="もどる" className="btn btn-ghost btn-sm btn-circle -ms-1">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 className="truncate text-base font-semibold">{appName}</h1>
      </header>

      <section aria-label="読み上げ" className="surface p-4">
        <div className="flex items-center gap-3">
          <AppAvatar id={appId} name={appName} color={app.color} large />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">読み上げる</p>
            <p className="mt-0.5 text-xs text-muted">{on ? "通知が来たら声でお知らせ" : "今は読み上げません"}</p>
          </div>
          <input
            type="checkbox"
            role="switch"
            className="toggle toggle-primary"
            checked={on}
            onChange={(e) => void api.setEnabled(appId, e.target.checked)}
            aria-label={`${appName}の読み上げ`}
          />
        </div>
        {on && (
          <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => onPreviewApp(appId)} disabled={speaking}>
            {speaking ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Play aria-hidden="true" />}
            {speaking ? "話しています" : "試しに喋る"}
          </button>
        )}
      </section>

      {on && (
        <>
          {platform === "macos" && edition !== "mas" && !axOn && (
            <section aria-labelledby="app-shortcut-heading">
              <h2 id="app-shortcut-heading" className="section-label">ショートカット</h2>
              <div className="surface mt-2 p-4">
                <div className="flex items-center gap-2">
                  <span className={`badge badge-soft badge-sm ${shortcutBadge.tone}`}>
                    {linked && <CheckCircle2 className="size-3" aria-hidden="true" />}
                    {shortcutBadge.label}
                  </span>
                  {checking && (
                    <span className="flex items-center gap-1.5 text-xs text-muted" role="status">
                      <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                      確認中…
                    </span>
                  )}
                </div>
                {installed === null ? null : installed ? (
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">
                    通知オートメーションで「ショートカットを実行」を選べば、このアプリの通知が届きます。
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted">
                      ダウンロード→ダブルクリックで登録し、通知オートメーションで「ショートカットを実行」を選ぶだけです。
                    </p>
                    <button type="button" className="btn btn-sm btn-block mt-3" onClick={() => void download()}>
                      <Download aria-hidden="true" />
                      ダウンロード
                    </button>
                    {savedPath && (
                      <p className="mt-2 text-xs leading-relaxed text-muted">保存しました: {savedPath.split("/").pop()}（ダウンロード内）</p>
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
