import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CheckCircle2, Play, X } from "lucide-react";
import { LiveCharacter } from "@/components/live-character";
import { CharacterImage } from "@/components/character-image";
import { CharacterList } from "@/components/character-list";
import { AutomationSetup } from "@/components/automation-setup";
import type { FullState, Persona } from "@/lib/apps";
import { ONBOARDING_GREETING, styleLabel } from "@/lib/characters";
import type { SettingsApi } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  customs: Record<string, string | null | undefined>;
  platform: string;
  edition: string;
  speaking: boolean;
  onPreview: () => void;
  /** 再生中だけ使う: まだ作っていないひな形のキャラで試しに喋る */
  onPreviewPreset?: (preset: string) => void;
  /** 設定の「オンボーディングを再生」から開いた時。同じ画面を見せるが、キャラ選びも完了も設定を変えない */
  replay?: boolean;
  onDone: () => void;
}

export function Onboarding({ api, state, personas, customs, platform, edition, speaking, onPreview, onPreviewPreset, replay = false, onDone }: Props) {
  // 直接監視はdmg版のmacOSだけ。MAS版はショートカット経由のみ。
  const direct = platform === "macos" && edition !== "mas";
  const [step, setStep] = useState(0);
  const [granted, setGranted] = useState(false);
  const [axOn, setAxOn] = useState<boolean | null>(null);
  const [setupDone, setSetupDone] = useState(false);
  const last = 3;

  useEffect(() => {
    if (direct) {
      invoke<boolean>("ax_trusted").then(setAxOn).catch(() => setAxOn(false));
    }
  }, [direct]);

  // システム設定で許可して戻ってきたら反映する
  useEffect(() => {
    if (!direct || axOn) return;
    const recheck = () =>
      invoke<boolean>("ax_trusted").then((ok) => ok && setAxOn(true)).catch(() => {});
    const id = setInterval(recheck, 2000);
    let unlisten: (() => void) | null = null;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged((e) => e.payload && void recheck())
      .then((f) => {
        // 登録完了より先に片付けられていたら、その場で解除する
        if (disposed) f();
        else unlisten = f;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      clearInterval(id);
      unlisten?.();
    };
  }, [direct, axOn]);

  const requestAx = async () => {
    const ok = await invoke<boolean>("ax_request_access").catch(() => false);
    // 一度断ると確認が出なくなるので、その時はシステム設定のアクセシビリティを開く (戻ってきたら下で確かめ直す)
    if (!ok) await invoke("ax_open_settings").catch(() => {});
    setAxOn(ok);
    if (ok) setGranted(true);
  };
  // dmg版で直接監視を使わず、ショートカットで受け取る (MAS版と同じ手順)
  const [viaShortcut, setViaShortcut] = useState(false);

  const grant = async () => {
    await invoke("windows_ensure_access").catch(() => {});
    setGranted(true);
  };

  // 再生中はキャラを作らず、選んだひな形をこの画面の中だけで覚える
  const [picked, setPicked] = useState<string | null>(null);
  const pickedPreset = api.presets.find((p) => p.id === picked) ?? api.presets[0];
  const chosen = replay ? pickedPreset : state.characters.find((c) => c.id === state.active_character) ?? state.characters[0];
  const pick = (id: string) => (replay ? setPicked(id) : void api.startWithPreset(id));
  const speak = () => (replay && pickedPreset ? onPreviewPreset?.(pickedPreset.id) : onPreview());

  // 最後の手順に来たら、1回だけ実際に喋らせる (どんな体験かを音で分かってもらう)
  const spoke = useRef(false);
  useEffect(() => {
    if (step !== 3 || spoke.current || !state.speech_enabled || state.volume === 0) return;
    spoke.current = true;
    const id = setTimeout(speak, 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  return (
    <div className="flex min-h-screen flex-col px-6 pb-5 pt-8">
      {replay && (
        <div className="-mt-4 mb-3 flex items-center justify-between gap-2 rounded-field bg-base-200 px-3 py-1.5 text-[11px] text-muted" role="status">
          <span>はじめの案内を再生中。設定は変わりません</span>
          <button type="button" className="btn btn-ghost btn-xs btn-circle" onClick={onDone} aria-label="再生をやめる">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="flex justify-center gap-1.5" role="img" aria-label={`手順 ${step + 1} / ${last + 1}`}>
        {Array.from({ length: last + 1 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-200",
              i === step ? "w-6 bg-primary" : i < step ? "w-1.5 bg-primary/40" : "w-1.5 bg-base-300",
            )}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="flex flex-1 flex-col pt-8"
        >
          {step === 0 && (
            <>
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <WelcomeDemo />
                <h1 className="mt-6 text-[24px] font-semibold leading-snug">
                  通知を、
                  <br />
                  キャラの声で。
                </h1>
                <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
                  通知が届くと、小窓のキャラが
                  <br />
                  声で教えてくれます。
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-block" onClick={() => setStep(1)}>
                はじめる
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="text-[20px] font-semibold leading-snug">通知を受け取る</h1>
              {platform === "windows" ? (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    通知の読み上げには、Windowsの許可が1回だけ必要です。
                  </p>
                  <div className="flex-1" />
                  <button type="button" className="btn btn-primary btn-block" onClick={() => void grant()} disabled={granted}>
                    {granted ? "許可しました" : "通知へのアクセスを許可"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-block mt-2" onClick={() => setStep(2)}>
                    つぎへ
                  </button>
                </>
              ) : direct && axOn ? (
                <>
                  <p className="mt-4 flex items-center gap-2 text-[15px] font-semibold text-success">
                    <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
                    設定済み
                  </p>
                  <div className="flex-1" />
                  <button type="button" className="btn btn-primary btn-block" onClick={() => setStep(2)}>
                    つぎへ
                  </button>
                </>
              ) : direct && !viaShortcut ? (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    ショートカットなしで受け取るには、直接監視の許可が必要です。押すとシステム設定の「アクセシビリティ」が開くので、Readappをオンにしてください。オンにして戻ると、ここに「設定済み」と出ます。
                  </p>
                  <div className="flex-1" />
                  <button type="button" className="btn btn-primary btn-block" onClick={() => void requestAx()}>
                    通知の直接監視を許可
                  </button>
                  <button type="button" className="btn btn-ghost btn-block mt-2" onClick={() => setViaShortcut(true)}>
                    ショートカットで受け取る
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    macOSのショートカットで、アプリの通知を受け取ります。まずは練習に、Readapp自身の通知を読み上げる設定を入れてみましょう。
                  </p>
                  <div className="mt-4">
                    <AutomationSetup practice onDoneChange={setSetupDone} />
                  </div>
                  {!setupDone && (
                    <p className="mt-3 text-xs leading-relaxed text-muted">
                      ほかのアプリも、あとでホームの「読み上げるアプリ」から同じ手順で追加できます。
                    </p>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    className={cn("btn btn-block mt-4", setupDone ? "btn-primary" : "btn-ghost")}
                    onClick={() => setStep(2)}
                  >
                    {setupDone ? "つぎへ" : "あとで設定する"}
                  </button>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-[20px] font-semibold leading-snug">キャラを選ぶ</h1>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">通知を教えてくれるキャラです。あとで変えたり、増やしたりできます。</p>
              <div className="mt-4">
                <CharacterList characters={api.presets} customs={customs} selected={replay ? pickedPreset?.id : state.characters[0]?.id} pickLabel={(c) => c.name + "にする"} onPick={pick} />
              </div>
              {chosen && <p className="mt-3 text-center text-xs text-muted">{chosen.name} · {styleLabel(chosen.style, personas)}</p>}
              <div className="flex-1" />
              <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => setStep(3)}>
                つぎへ
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-[20px] font-semibold leading-snug">こんな声で教えます</h1>
              <p className="mt-2 text-[13px] text-muted">よければ、はじめましょう。</p>
              <div className="flex flex-1 flex-col items-center justify-center">
                <CharacterImage character={chosen} customs={customs} speaking={speaking} className="aspect-[3/4] w-28 rounded-box shadow-sm" />
                <div className="relative mt-4 max-w-[17rem] rounded-box bg-base-100 px-4 py-3 text-center shadow-xs">
                  <span aria-hidden="true" className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-base-100" />
                  <p className="relative whitespace-pre-line text-[14px] leading-relaxed">「{ONBOARDING_GREETING.replace("、", "、\n")}」</p>
                </div>
                {chosen && <p className="mt-2 text-xs text-muted">{chosen.name} · {styleLabel(chosen.style, personas)}</p>}
              </div>
              <button type="button" className="btn btn-block" onClick={speak} disabled={speaking}>
                {speaking ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Play aria-hidden="true" />}
                {speaking ? "話しています" : "もう一度聞く"}
              </button>
              <button type="button" className="btn btn-primary btn-block mt-2" onClick={onDone}>
                はじめる
              </button>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {step > 0 && (
        <button type="button" onClick={onDone} className="btn btn-ghost btn-xs mx-auto mt-3 font-normal text-muted">
          スキップ
        </button>
      )}
    </div>
  );
}

// 最初の画面の見本: 小窓のキャラに通知が届き、吹き出しを出して話す様子を繰り返す (音は出さない)
const DEMO = [
  { at: 900, app: "Slack", color: "#e01e5a", text: "鈴木さんから。\n資料を見てほしいって！", talk: [1500, 3600] },
  { at: 5200, app: "カレンダー", color: "#e8553d", text: "あと5分で、定例だよ。", talk: [5800, 7300] },
] as const;
const DEMO_LOOP = 9800;

function WelcomeDemo() {
  const reduce = useReducedMotion();
  const [t, setT] = useState(reduce ? DEMO_LOOP - 1 : 0);
  useEffect(() => {
    if (reduce) return;
    const started = performance.now();
    const id = setInterval(() => setT((performance.now() - started) % DEMO_LOOP), 100);
    return () => clearInterval(id);
  }, [reduce]);
  const shown = DEMO.filter((d) => t >= d.at);
  const speaking = !reduce && DEMO.some((d) => t >= d.talk[0] && t < d.talk[1]);
  return (
    <div className="relative h-[250px] w-[200px] overflow-hidden rounded-[22px] shadow-[0_10px_30px_rgb(41_39_45/0.18)]" aria-hidden="true">
      <LiveCharacter framing="scene" speaking={speaking} notifyKey={shown.length} className="absolute inset-0 block size-full" />
      <ol className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {shown.map((d) => (
            <motion.li
              key={d.app}
              initial={{ opacity: 0, y: 12, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              style={{ transformOrigin: "left bottom" }}
              className="w-fit max-w-full rounded-[13px] rounded-bl-[4px] bg-base-100/95 px-2.5 pb-1.5 pt-1 text-left shadow-sm"
            >
              <span className="flex items-center gap-1 text-[9px] font-semibold text-muted">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: d.color }} />
                {d.app}
              </span>
              <span className="block whitespace-pre-line text-[11px] font-bold leading-snug text-base-content">{d.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
