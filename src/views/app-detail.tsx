import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, Download, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { knownApp } from "@/lib/apps";
import { isOn, type SettingsApi } from "@/hooks/useSettings";
import type { FullState } from "@/lib/apps";

interface Props {
  api: SettingsApi;
  state: FullState;
  appId: string;
  platform: string;
  speaking: boolean;
  onBack: () => void;
  onPreviewApp: (appId: string) => void;
}

export function AppDetail({ api, state, appId, platform, speaking, onBack, onPreviewApp }: Props) {
  const app = knownApp(appId);
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

  return (
    <div className="px-5 pb-5 pt-4">
      <header className="flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="もどる"
          className="rounded-md p-1.5 outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[15px] font-semibold">{app.name}</h1>
      </header>

      <section aria-label="読み上げ" className="mt-3 rounded-xl bg-card p-4 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">読み上げる</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {on ? "通知が来たら声でお知らせ" : "今は読み上げません"}
            </p>
          </div>
          <Switch checked={on} onChange={(v) => void api.setEnabled(appId, v)} label={`${app.name}の読み上げ`} />
        </div>
      </section>

      {on && (
        <>
          <Button className="mt-4 w-full" onClick={() => onPreviewApp(appId)} disabled={speaking}>
            <Play className="h-4 w-4" />
            試しに喋る
          </Button>

          {platform === "macos" && !axOn && (
            <section aria-label="ショートカット" className="mt-4">
              <h2 className="text-xs font-medium text-muted-foreground">ショートカット</h2>
              <div className="mt-2 rounded-xl bg-card p-4 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
                <p className="flex items-center gap-1.5 text-[13px] font-medium">
                  {linked ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      つながっています
                    </>
                  ) : installed ? (
                    "登録済みです"
                  ) : (
                    "まだ登録されていません"
                  )}
                </p>
                {checking && (
                  <p className="mt-2 text-xs text-muted-foreground">確認中…</p>
                )}
                {installed === null ? null : installed ? (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    通知オートメーションで「ショートカットを実行」を選べば、このアプリの通知が届きます。
                  </p>
                ) : (
                  <>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                      ダウンロード→ダブルクリックで登録し、通知オートメーションで「ショートカットを実行」を選ぶだけです。
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button className="flex-1" variant="outline" onClick={() => void download()}>
                        <Download className="h-4 w-4" />
                        ダウンロード
                      </Button>
                    </div>
                    {savedPath && (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        保存しました: {savedPath.split("/").pop()}（ダウンロード内）
                      </p>
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
