import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { AppAvatar } from "@/components/app-avatar";
import { AutomationSetup } from "@/components/automation-setup";
import { AutomationListHint } from "@/components/automation-list-hint";
import { knownApp } from "@/lib/apps";

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

interface Props {
  /** アプリの詳細 (声の設定など) を開く */
  onOpenApp: (id: string) => void;
  /** アプリごとの声を変えている時、その声の名前 */
  voiceNameOf: (id: string) => string | null;
}

export function MasAppList({ onOpenApp, voiceNameOf }: Props) {
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

  const ordered = [...(apps ?? []).filter((app) => app.added), ...(apps ?? []).filter((app) => !app.added)];
  const appRow = (app: MasApp) => {
    const ok = app.added && (setup[app.id]?.verified ?? false);
    const status = ok ? "受け取っています" : app.added ? "ショートカットでオンにしてください" : "まだ追加していません";
    return (
      <li key={app.id} className="list-row items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenApp(app.id)}
          aria-label={`${app.name}の設定を開く`}
          className="list-col-grow -my-1 flex min-w-0 items-center gap-3 rounded-field py-1 text-left"
        >
          <AppAvatar name={app.name} color={knownApp(app.id).color} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{app.name}</span>
            <span className="flex items-center gap-1 truncate text-xs text-muted">
              {ok && <Check className="size-3 text-success" strokeWidth={3} aria-hidden="true" />}
              {status}
              {voiceNameOf(app.id) && `・${voiceNameOf(app.id)}の声`}
            </span>
          </span>
        </button>
        {!app.added ? (
          <button
            type="button"
            className="btn btn-primary btn-soft btn-sm"
            onClick={() => {
              addStartedAt.current[app.id] = Math.floor(Date.now() / 1000);
              void run(
                "add_app_automation",
                { appId: app.id },
                `${app.name}のショートカットを開けませんでした。アプリを入れ直してください。`,
              );
            }}
          >
            <Plus aria-hidden="true" />
            追加
          </button>
        ) : (
          !ok && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                void run(
                  "open_shortcuts_app",
                  undefined,
                  "開けませんでした。Launchpadから「ショートカット」を開いてください。",
                )
              }
            >
              <ExternalLink aria-hidden="true" />
              開く
            </button>
          )
        )}
      </li>
    );
  };

  return (
    <div className="space-y-2">
      {apps === null ? (
        <div className="surface flex items-center gap-2 px-4 py-3.5 text-[13px] text-muted">
          <span className="loading loading-spinner loading-xs" aria-hidden="true" />
          アプリを調べています…
        </div>
      ) : apps.length === 0 ? (
        <p className="surface px-4 py-3.5 text-[13px] leading-relaxed text-muted">
          一覧にあるアプリが見つかりませんでした。下の「ほかのアプリを読み上げる」から追加できます。
        </p>
      ) : (
        <div className="surface">
          <ul className="list">{ordered.slice(0, 4).map(appRow)}</ul>
          {ordered.length > 4 && (
            <details className="collapse collapse-arrow collapse-compact rounded-none rounded-b-box border-t border-base-200">
              <summary className="collapse-title">
                すべてのアプリ
                <span className="ml-auto text-xs font-normal text-muted">{ordered.length}件</span>
              </summary>
              <div className="collapse-content">
                <ul className="list -mx-4">{ordered.slice(4).map(appRow)}</ul>
              </div>
            </details>
          )}
        </div>
      )}

      {error && (
        <p className="px-1 text-xs text-error" role="alert">
          {error}
        </p>
      )}

      <details className="collapse collapse-arrow collapse-compact surface">
        <summary className="collapse-title">アプリの設定方法</summary>
        <div className="collapse-content text-xs leading-relaxed text-muted">
          「追加」でショートカットが開いたら「ショートカットを追加」を押します。次にショートカットの「オートメーション」一覧で、そのアプリの行の右端のスイッチをオンにします。
          そのアプリの通知が届くと「受け取っています」になります。
          <AutomationListHint />
        </div>
      </details>

      <details className="collapse collapse-arrow collapse-compact surface">
        <summary className="collapse-title">ほかのアプリを読み上げる</summary>
        <div className="collapse-content">
          <p className="text-xs leading-relaxed text-muted">一覧にないアプリは、まとめ用のショートカットに「＋」で足します。</p>
          <div className="mt-3">
            <AutomationSetup />
          </div>
        </div>
      </details>
    </div>
  );
}
