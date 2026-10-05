import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { AutomationSetup } from "@/components/automation-setup";
import { AutomationListHint } from "@/components/automation-list-hint";
import { knownApp } from "@/lib/apps";
import { cn } from "@/lib/utils";

// MAS版「読み上げるアプリ」。
// このMacに入っている有名アプリごとに、そのアプリだけが通知元の通知オートメーションを1クリックで追加する。
// 追加済みかは shortcuts list で分かるが、オンにしたかは分からないので、
// 追加した後にそのアプリの通知を受け取ったら「受け取っています」にする (確認済みはこの端末に保存)。
// ショートカット側で削除されたら確認を取り消し、再追加後の受信で確かめ直す。
// 一覧にないアプリは「ほかのアプリ」から汎用のひな形で追加してもらう。

interface MasApp {
  id: string;
  name: string;
  added: boolean;
}

const STORE_KEY = "readapp.appSetup";

/** アプリごとの状態: 追加を確認した時刻 (UNIX秒) と、その後に受信して確認できたか */
type SetupState = Record<string, { addedAt: number; verified: boolean }>;

function loadState(): SetupState {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as SetupState) : {};
  } catch {
    return {};
  }
}

function saveState(s: SetupState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* 保存できなくても表示はできる */
  }
}

/** ショートカットの追加状況と受信時刻から、アプリごとの状態を更新する。
 *  addStartedAt: この画面で「追加」を押した時刻。検出 (数秒おき) より前に届いた通知も確認に数えるため基準にする */
function nextState(
  cur: SetupState,
  apps: MasApp[],
  receivedAt: Record<string, number>,
  addStartedAt: Record<string, number>,
): SetupState {
  const now = Math.floor(Date.now() / 1000);
  const next: SetupState = {};
  for (const app of apps) {
    if (!app.added) continue; // 消されたら確認も取り消す
    const prev = cur[app.id] ?? { addedAt: addStartedAt[app.id] ?? now, verified: false };
    const at = receivedAt[app.id];
    next[app.id] = { addedAt: prev.addedAt, verified: prev.verified || (at !== undefined && at >= prev.addedAt) };
  }
  return next;
}

export function MasAppList() {
  const [apps, setApps] = useState<MasApp[] | null>(null);
  const [setup, setSetup] = useState<SetupState>(loadState);
  // 次の状態を同期的に計算するための写し (押下時刻を確実に1回だけ使うため)
  const setupRef = useRef(setup);
  const [error, setError] = useState<string | null>(null);
  const addStartedAt = useRef<Record<string, number>>({});

  const refresh = useCallback(async () => {
    const [list, observed] = await Promise.all([
      invoke<MasApp[]>("mas_app_list").catch(() => null),
      invoke<{ id: string; at: number | null }[]>("get_observed_apps").catch(() => []),
    ]);
    if (!list) return;
    setApps(list);
    const receivedAt: Record<string, number> = {};
    for (const o of observed) if (o.at != null) receivedAt[o.id] = o.at;
    const cur = setupRef.current;
    const next = nextState(cur, list, receivedAt, addStartedAt.current);
    // 押下時刻は、その追加を検出した時点で使い切る (削除後の再追加で古い時刻を使わない)
    for (const app of list) if (app.added) delete addStartedAt.current[app.id];
    if (JSON.stringify(next) !== JSON.stringify(cur)) {
      saveState(next);
      setupRef.current = next;
      setSetup(next);
    }
  }, []);

  // ショートカットから戻った時と、通知元が増えた時、念のため数秒ごとに更新する
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    const offs: (() => void)[] = [];
    let disposed = false;
    const keep = (f: () => void) => (disposed ? f() : offs.push(f));
    getCurrentWindow()
      .onFocusChanged((e) => e.payload && void refresh())
      .then(keep)
      .catch(() => {});
    listen("observed-changed", () => void refresh())
      .then(keep)
      .catch(() => {});
    return () => {
      disposed = true;
      clearInterval(id);
      offs.forEach((f) => f());
    };
  }, [refresh]);

  const run = async (command: string, args: Record<string, unknown> | undefined, failure: string) => {
    try {
      await invoke(command, args);
      setError(null);
    } catch {
      setError(failure);
    }
  };

  return (
    <div>
      {apps === null ? (
        <p className="text-[13px] text-muted-foreground">アプリを調べています…</p>
      ) : apps.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          一覧にあるアプリが見つかりませんでした。下の「ほかのアプリ」から追加できます。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {apps.map((app) => {
            const ok = app.added && (setup[app.id]?.verified ?? false);
            const status = ok ? "受け取っています" : app.added ? "ショートカットでオンにしてください" : "まだ追加していません";
            return (
              <li
                key={app.id}
                className="flex items-center gap-3 rounded-lg bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(41,39,45,0.06)]"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                  style={{ backgroundColor: `${knownApp(app.id).color}2e` }}
                  aria-hidden="true"
                >
                  {app.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{app.name}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {ok && <Check className="h-3 w-3 text-emerald-500" strokeWidth={3} aria-hidden="true" />}
                    {status}
                  </span>
                </span>
                {!app.added ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      addStartedAt.current[app.id] = Math.floor(Date.now() / 1000);
                      void run(
                        "add_app_automation",
                        { appId: app.id },
                        `${app.name}のショートカットを開けませんでした。アプリを入れ直してください。`,
                      );
                    }}
                  >
                    <Plus />
                    追加
                  </Button>
                ) : (
                  !ok && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void run(
                          "open_shortcuts_app",
                          undefined,
                          "開けませんでした。Launchpadから「ショートカット」を開いてください。",
                        )
                      }
                    >
                      <ExternalLink />
                      開く
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 rounded-lg bg-surface-muted px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        「追加」でショートカットが開いたら「ショートカットを追加」を押します。次にショートカットの「オートメーション」一覧で、そのアプリの行の右端のスイッチをオンにします。
        そのアプリの通知が届くと「受け取っています」になります。
        <AutomationListHint />
      </div>

      {error && (
        <p className={cn("mt-2 text-xs text-muted-foreground")} role="alert">
          {error}
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer list-none text-[13px] font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
          ほかのアプリを読み上げる
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          一覧にないアプリは、まとめ用のショートカットに「＋」で足します。
        </p>
        <div className="mt-3">
          <AutomationSetup />
        </div>
      </details>
    </div>
  );
}
