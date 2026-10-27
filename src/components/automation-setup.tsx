import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, ExternalLink, Keyboard, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AutomationListHint } from "@/components/automation-list-hint";
import { cn } from "@/lib/utils";

// MAS版の通知の受け取り設定 (ショートカットの通知オートメーション)。
// 1. 同梱のひな形を追加する   … 追加済みかは shortcuts list で自動判定
// 2. 読み上げるアプリを足す   … 編集画面をURLで直接開く。選んだかは判定できないので本人が進める
//    (ひな形の通知元には最初から readapp 自身が入っている)
// 3. オートメーションをオンにする … readappのテスト通知が読み上げられたら完了 (読み込んだオートメーションは最初オフ)
// 最初の通知が届いたら、途中でも全部できたことにする。
// 画面の文言・見本は macOS 27 のショートカットで実際に操作して確認したもの (2026-10-06)。

/** ショートカット側の名前 (src-tauri の AUTOMATION_NAME と同じ) */
const AUTOMATION = "readapp通知";
/** ショートカットの青 (見本の「押す場所」を本物と同じ色で示す) */
const SHORTCUTS_BLUE = "#0a84ff";
const STORE_KEY = "readapp.automationSetup";

type Stage = 0 | 1 | 2 | 3; // 3 = 完了

function loadStage(): Stage {
  try {
    const v = Number(localStorage.getItem(STORE_KEY));
    return v >= 0 && v <= 3 ? (v as Stage) : 0;
  } catch {
    return 0;
  }
}

function saveStage(s: Stage) {
  try {
    localStorage.setItem(STORE_KEY, String(s));
  } catch {
    /* 保存できなくても進行はできる */
  }
}

interface Props {
  /** 完了 (最初の通知の受信を含む) が変わったら呼ばれる */
  onDoneChange?: (done: boolean) => void;
  /** オンボーディングの練習: readapp自身の通知だけを読む設定を入れる (アプリ選びは省く)。
   *  追加→オンの手順を一度体験すると、ホームで有名アプリを同じ手順で足せる */
  practice?: boolean;
}

export function AutomationSetup({ onDoneChange, practice = false }: Props) {
  const [stage, setStageState] = useState<Stage>(loadStage);
  const [waitingAdd, setWaitingAdd] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [received, setReceived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Math.floor(Date.now() / 1000));
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const doneRef = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);

  const setStage = useCallback((s: Stage) => {
    moved.current = true;
    setStageState((cur) => {
      const next = (Math.max(cur, s) as Stage);
      saveStage(next);
      return next;
    });
  }, []);

  /** 最初からやり直す (ショートカット側で消された時など) */
  const restart = useCallback(() => {
    moved.current = true;
    saveStage(0);
    startedAt.current = Math.floor(Date.now() / 1000);
    setReceived(false);
    setWaitingAdd(false);
    setTestSent(false);
    setStageState(0);
  }, []);

  const done = stage === 3;
  useEffect(() => onDoneChange?.(done), [done, onDoneChange]);

  // 最初の通知が届いたら、途中でも完了として保存する
  useEffect(() => {
    if (received) setStage(3);
  }, [received, setStage]);

  // 操作で段階が進んだら、次にやることへフォーカスを移す (キーボード・読み上げ利用者が迷わないように)
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (stage === 3 ? doneRef.current : stepRefs.current[stage])?.focus();
  }, [stage]);

  // 途中まで進んだ後にひな形が消されていたら (ショートカットで削除など)、最初から案内し直す
  useEffect(() => {
    if (stage === 0) return;
    invoke<boolean>("notify_automation_installed")
      .then((ok) => {
        if (!ok) restart();
      })
      .catch(() => {});
    // 起動時に一度だけ確かめる
  }, []);

  // ひな形が追加されたら自動で次へ。ショートカットから戻った時 (フォーカス) と、待機中は2秒ごとに確かめる。
  useEffect(() => {
    if (stage > 0) return;
    let alive = true;
    const check = () =>
      invoke<boolean>("notify_automation_installed")
        .then((ok) => {
          if (alive && ok) {
            setWaitingAdd(false);
            setStage(practice ? 2 : 1);
          }
        })
        .catch(() => {});
    void check();
    const id = waitingAdd ? setInterval(check, 2000) : null;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged((e) => e.payload && void check())
      .then((f) => (disposed ? f() : (unlisten = f)))
      .catch(() => {});
    return () => {
      alive = false;
      disposed = true;
      if (id) clearInterval(id);
      unlisten?.();
    };
  }, [stage, waitingAdd, setStage]);

  // 最初の通知が届いたら完了 (設定を始めた後の受信だけ数える)
  useEffect(() => {
    if (received) return;
    const tick = () =>
      invoke<{ id: string; at: number | null }[]>("get_observed_apps")
        // readapp自身のテスト通知が一巡したら完了 (ほかのアプリの通知では完了にしない)。
        // アプリ別の受信時刻を見るので、直後に別アプリの通知が来ても結果は失われない。
        // 時刻は秒単位。始めた秒と同じ受信は (やり直し直前の古い通知かもしれないので) 数えない
        .then((apps) => {
          const at = apps.find((a) => a.id === "readapp")?.at;
          if (at != null && at > startedAt.current) setReceived(true);
        })
        .catch(() => {});
    void tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [received]);

  const run = async (command: string, failure: string) => {
    try {
      await invoke(command);
      setError(null);
      return true;
    } catch {
      setError(failure);
      return false;
    }
  };

  const add = async () => {
    if (await run("add_notify_automation", "設定ファイルを開けませんでした。アプリを入れ直してください。")) {
      setWaitingAdd(true);
    }
  };

  const steps = [
    {
      title: "設定を追加",
      doneLabel: "追加しました",
      body: (
        <>
          <p>ショートカットが開いたら「ショートカットを追加」を押します。</p>
          <MockAdd />
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void add()}>
              <Plus />
              追加する
            </button>
            {waitingAdd && (
              <span className="text-xs text-muted" role="status">
                追加を待っています…
              </span>
            )}
          </div>
        </>
      ),
    },
    {
      title: "アプリを選ぶ",
      doneLabel: "選びました",
      body: (
        <>
          <p>
            青い「＋」を押して、読み上げたいアプリを足します。「readapp」は確認用なので、そのまま残してください。
          </p>
          <MockApps />
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                void run("open_notify_automation", "開けませんでした。ショートカットで「" + AUTOMATION + "」を開いてください。")
              }
            >
              <ExternalLink />
              開く
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStage(2)}>
              選んだ
            </button>
          </div>
        </>
      ),
    },
    {
      title: "オンにして確かめる",
      doneLabel: "読み上げました",
      body: (
        <>
          <p>
            ショートカットの「オートメーション」一覧で、「readappからの通知を受け取ったとき」の右端のスイッチをオンにします。
            {practice
              ? "テスト通知を送り、readappの通知が読み上げられたら完了です。"
              : "最後にテスト通知を送り、読み上げられたら完了です。"}
          </p>
          <MockToggle />
          <AutomationListHint />
          <p className="mt-2 text-xs">初回は右上に「readapp」の通知の許可が出ます。「許可」を押すと、そのままテスト通知が届きます。</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={async () => {
                try {
                  await invoke("send_test_notification");
                  setError(null);
                  setTestSent(true);
                } catch (e) {
                  setTestSent(false);
                  setError(
                    e === "denied"
                      ? "readappの通知がオフです。システム設定の「通知」で readapp を許可してから、もう一度送ってください。"
                      : "テスト通知を送れませんでした。もう一度お試しください。",
                  );
                }
              }}
            >
              <Bell />
              テスト通知
            </button>
          </div>
          {testSent && !done && (
            <p className="mt-2 text-xs" role="status">
              送りました。読み上げられない時は、ショートカットでスイッチがオンかを確かめてください。
              <button
                type="button"
                className="ml-1 underline underline-offset-2 outline-none hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/50"
                onClick={() => setStage(3)}
              >
                確認せずに進む
              </button>
            </p>
          )}
        </>
      ),
    },
  ];

  return (
    <div>
      <ol className="space-y-2" aria-label="通知を受け取る設定">
        {(practice ? [0, 2] : [0, 1, 2]).map((i, order) => {
          const step = steps[i];
          const finished = done || i < stage;
          const current = !done && i === stage;
          return (
            <li
              key={step.title}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              tabIndex={-1}
              aria-current={current ? "step" : undefined}
              className={cn(
                "rounded-box px-3.5 py-3 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary/50",
                current ? "surface ring-1 ring-primary/30" : "bg-base-100/50",
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    finished ? "bg-success text-success-content" : current ? "bg-primary text-primary-content" : "bg-base-300 text-muted",
                  )}
                  aria-hidden="true"
                >
                  {finished ? <Check className="h-3 w-3" strokeWidth={3} /> : order + 1}
                </span>
                <span className="text-[13px] font-medium">{step.title}</span>
                {finished && <span className="ml-auto text-xs text-muted">{step.doneLabel}</span>}
              </div>
              {/* 流れ全体を最初から見せる。今やるステップはカードの背景と枠で示し、文字は薄くしない (読みやすさ)。
                  操作は今のステップだけ (先のボタンで段階を飛ばさないように)。 */}
              <fieldset
                disabled={!current}
                className="mt-2 min-w-0 pl-[30px] text-[13px] leading-relaxed text-muted"
              >
                {step.body}
              </fieldset>
            </li>
          );
        })}
      </ol>

      {done && (
        <div
          ref={doneRef}
          tabIndex={-1}
          className="mt-3 rounded-box bg-primary/10 px-3.5 py-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          role="status"
        >
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-base-content">
            <Check className="h-4 w-4 text-success" strokeWidth={3} />
            {practice && !received ? "設定を入れました" : "準備ができました"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {practice
              ? received
                ? "readappの通知を読み上げられました。ほかのアプリも、ホームの「読み上げるアプリ」から同じ手順（追加してオン）で読み上げられます。"
                : "読み上げはまだ確認できていません。ホームの「試しに喋る」で、あとから確かめられます。ほかのアプリも、ホームの「読み上げるアプリ」から同じ手順で追加できます。"
              : received
                ? "通知を受け取りました。選んだアプリに通知が来るたびに読み上げます。"
                : "選んだアプリに通知が来ると読み上げます。"}
          </p>
          {!practice && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                void run("open_notify_automation", "開けませんでした。ショートカットで「" + AUTOMATION + "」を開いてください。")
              }
            >
              <ExternalLink />
              アプリを変える
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={restart}>
              最初から設定する
            </button>
          </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-muted" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---- 見本 (ショートカットの画面の一部を小さく再現し、押す場所を示す) ----

function MockFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2.5 rounded-field bg-base-200 p-2.5" role="img" aria-label={label}>
      {children}
    </div>
  );
}

function Target({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="rounded-[7px] px-1.5 py-0.5 font-medium ring-2"
      style={{ color: SHORTCUTS_BLUE, backgroundColor: `${SHORTCUTS_BLUE}1f`, ["--tw-ring-color" as string]: `${SHORTCUTS_BLUE}66` }}
    >
      {children}
    </span>
  );
}

function MockAdd() {
  return (
    <MockFrame label="ショートカットの追加画面。「ショートカットを追加」ボタンを押す">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-amber-400/90 text-white" aria-hidden="true">
          <Keyboard className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-base-content">{AUTOMATION}</p>
          <span
            className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white ring-2"
            style={{ backgroundColor: SHORTCUTS_BLUE, ["--tw-ring-color" as string]: `${SHORTCUTS_BLUE}55` }}
          >
            ショートカットを追加
          </span>
        </div>
      </div>
    </MockFrame>
  );
}

function MockApps() {
  return (
    <MockFrame label="通知オートメーションの設定。readappの横の「＋」を押して読み上げたいアプリを足す">
      <p className="flex flex-wrap items-center gap-1 text-[11px] text-base-content">
        <Bell className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
        <span className="font-medium" style={{ color: SHORTCUTS_BLUE }}>
          readapp
        </span>
        <Target>＋</Target>
        からの通知を受け取ったとき
      </p>
    </MockFrame>
  );
}

function MockToggle() {
  return (
    <MockFrame label="ショートカットのオートメーション一覧。readappからの通知を受け取ったとき の行の右端のスイッチをオンにする">
      <div className="flex items-center gap-2 text-[11px]">
        <Bell className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-base-content">readappからの通知を受け取ったとき</span>
          <span className="block truncate text-[10px] text-muted">{AUTOMATION}</span>
        </span>
        <span
          className="relative h-4 w-7 shrink-0 rounded-full ring-2"
          style={{ backgroundColor: SHORTCUTS_BLUE, ["--tw-ring-color" as string]: `${SHORTCUTS_BLUE}55` }}
          aria-hidden="true"
        >
          <span className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-white" />
        </span>
      </div>
    </MockFrame>
  );
}
