import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { PersonaPicker } from "@/components/persona-picker";
import type { Persona } from "@/lib/apps";
import { cn } from "@/lib/utils";

interface Props {
  personas: Persona[];
  platform: string;
  edition: string;
  speaking: boolean;
  onPreview: () => void;
  onPickDefaultPersona: (id: string) => void;
  onDone: () => void;
}

export function Onboarding({ personas, platform, edition, speaking, onPreview, onPickDefaultPersona, onDone }: Props) {
  // 直接監視はdmg版のmacOSだけ。MAS版はショートカット経由のみ。
  const direct = platform === "macos" && edition !== "mas";
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState("mio");
  const [granted, setGranted] = useState(false);
  const [axOn, setAxOn] = useState<boolean | null>(null);
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

  const pick = (id: string) => {
    setPersona(id);
    void onPickDefaultPersona(id);
  };

  const grant = async () => {
    await invoke("windows_ensure_access").catch(() => {});
    setGranted(true);
  };

  return (
    <div className="flex min-h-full flex-col px-6 pb-6 pt-10">
      <div className="flex justify-center gap-1.5" aria-label={`手順 ${step + 1} / ${last + 1}`}>
        {Array.from({ length: last + 1 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-200",
              i === step ? "w-6 bg-primary" : "w-1.5 bg-border",
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
              <p className="text-center text-[26px] font-semibold leading-snug">
                通知を、
                <br />
                好きな声に。
              </p>
              <p className="mt-3 text-center text-[13px] leading-relaxed text-muted-foreground">
                大事な通知だけ、
                <br />
                選んだ声でお知らせします。
              </p>
              <div className="flex-1" />
              <Button className="w-full" onClick={() => setStep(1)}>
                はじめる
              </Button>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-[20px] font-semibold leading-snug">通知を受け取る</p>
              {platform === "windows" ? (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    通知の読み上げには、Windowsの許可が1回だけ必要です。
                  </p>
                  <div className="flex-1" />
                  <Button className="w-full" onClick={() => void grant()} disabled={granted}>
                    {granted ? "許可しました" : "通知へのアクセスを許可"}
                  </Button>
                  <Button className="mt-2 w-full" variant="ghost" onClick={() => setStep(2)}>
                    つぎへ
                  </Button>
                </>
              ) : direct && axOn ? (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    直接監視が効いているので、このまま通知が届きます。ショートカットの登録は要りません。
                  </p>
                  <div className="flex-1" />
                  <Button className="w-full" onClick={() => setStep(2)}>
                    つぎへ
                  </Button>
                </>
              ) : direct ? (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    ショートカットなしで受け取るには、直接監視の許可が必要です。
                  </p>
                  <div className="flex-1" />
                  <Button className="w-full" onClick={() => void requestAx()}>
                    通知の直接監視を許可
                  </Button>
                  <Button className="mt-2 w-full" variant="ghost" onClick={() => setStep(2)}>
                    ショートカットで進める
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    macOSのショートカットで、アプリの通知を受け取ります。
                  </p>
                  <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                    読み上げたいアプリは、このあとホームの「読み上げるアプリ」で選べます。よく使うアプリは「追加」を押すだけです。
                  </p>
                  <div className="flex-1" />
                  <Button className="mt-4 w-full" onClick={() => setStep(2)}>
                    つぎへ
                  </Button>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-[20px] font-semibold leading-snug">キャラを選ぶ</p>
              <p className="mt-2 text-[13px] text-muted-foreground">
                通知の言い方を変えられます。あとで変えられます。
              </p>
              <div className="mt-4">
                <PersonaPicker personas={personas} selected={persona} onSelect={pick} />
              </div>
              <div className="flex-1" />
              <Button className="mt-4 w-full" onClick={() => setStep(3)}>
                つぎへ
              </Button>
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-[20px] font-semibold leading-snug">試しに喋る</p>
              <p className="mt-2 text-[13px] text-muted-foreground">
                実際に声を聞いて、よければはじめましょう。
              </p>
              <div className="flex-1" />
              <Button
                className="w-full"
                variant="outline"
                onClick={onPreview}
                disabled={speaking}
              >
                {speaking ? "話しています…" : "試しに喋る"}
              </Button>
              <Button className="mt-2 w-full" onClick={onDone}>
                はじめる
              </Button>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {step > 0 && (
        <button
          type="button"
          onClick={onDone}
          className="mt-3 text-center text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          スキップ
        </button>
      )}
    </div>
  );
}
