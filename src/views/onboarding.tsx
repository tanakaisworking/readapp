import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CheckCircle2, Play } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { CharacterImage } from "@/components/character-image";
import { CharacterList } from "@/components/character-list";
import { AutomationSetup } from "@/components/automation-setup";
import type { FullState, Persona } from "@/lib/apps";
import { styleLabel, styleSample } from "@/lib/characters";
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
  onDone: () => void;
}

export function Onboarding({ api, state, personas, customs, platform, edition, speaking, onPreview, onDone }: Props) {
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
    setAxOn(ok);
    if (ok) setGranted(true);
  };

  const grant = async () => {
    await invoke("windows_ensure_access").catch(() => {});
    setGranted(true);
  };

  const chosen = state.characters.find((c) => c.id === state.active_character) ?? state.characters[0];
  const sample = chosen ? styleSample(chosen.style) : null;

  return (
    <div className="flex min-h-screen flex-col px-6 pb-5 pt-8">
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
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.08 }}
                >
                  <AppLogo size={104} />
                </motion.div>
                <h1 className="mt-7 text-[26px] font-semibold leading-snug">
                  通知を、
                  <br />
                  好きな声に。
                </h1>
                <p className="mt-3 text-[13px] leading-relaxed text-muted">
                  大事な通知だけ、
                  <br />
                  選んだ声でお知らせします。
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
                  <div className="alert alert-soft alert-success mt-4 flex items-start gap-2.5 px-3.5 py-3 text-left">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <p className="text-[13px] leading-relaxed text-base-content">
                      直接監視が効いているので、このまま通知が届きます。ショートカットの登録は要りません。
                    </p>
                  </div>
                  <div className="flex-1" />
                  <button type="button" className="btn btn-primary btn-block" onClick={() => setStep(2)}>
                    つぎへ
                  </button>
                </>
              ) : direct ? (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    ショートカットなしで受け取るには、直接監視の許可が必要です。
                  </p>
                  <div className="flex-1" />
                  <button type="button" className="btn btn-primary btn-block" onClick={() => void requestAx()}>
                    通知の直接監視を許可
                  </button>
                  <button type="button" className="btn btn-ghost btn-block mt-2" onClick={() => setStep(2)}>
                    ショートカットで進める
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted">
                    macOSのショートカットで、アプリの通知を受け取ります。まずは練習に、readapp自身の通知を読み上げる設定を入れてみましょう。
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
              <p className="mt-2 text-[13px] text-muted">選んだキャラが、その声と話し方で通知を知らせます。名前・画像・話し方・声は、あとで変えたり、新しく作ったりできます。</p>
              <div className="mt-4">
                <CharacterList characters={state.characters} active={state.active_character} customs={customs} onSelect={(id) => void api.setActiveCharacter(id)} />
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
              <h1 className="text-[20px] font-semibold leading-snug">試しに喋る</h1>
              <p className="mt-2 text-[13px] text-muted">実際に声を聞いて、よければはじめましょう。</p>
              <div className="flex flex-1 flex-col items-center justify-center">
                <CharacterImage character={chosen} customs={customs} speaking={speaking} className="aspect-[3/4] w-28 rounded-box shadow-sm" />
                {sample && (
                  <div className="relative mt-4 max-w-[17rem] rounded-box bg-base-100 px-4 py-3 text-center shadow-xs">
                    <span aria-hidden="true" className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-base-100" />
                    <p className="relative whitespace-pre-line text-[14px] leading-relaxed">「{sample}」</p>
                  </div>
                )}
                {chosen && <p className="mt-2 text-xs text-muted">{chosen.name} · {styleLabel(chosen.style, personas)}</p>}
              </div>
              <button type="button" className="btn btn-block" onClick={onPreview} disabled={speaking}>
                {speaking ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Play aria-hidden="true" />}
                {speaking ? "話しています" : "試しに喋る"}
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
