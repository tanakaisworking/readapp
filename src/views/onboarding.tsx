import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { PersonaPicker } from "@/components/persona-picker";
import type { Persona } from "@/lib/apps";
import { cn } from "@/lib/utils";

interface Props {
  personas: Persona[];
  platform: string;
  speaking: boolean;
  onPreview: () => void;
  onPickDefaultPersona: (id: string) => void;
  onDone: () => void;
}

export function Onboarding({ personas, platform, speaking, onPreview, onPickDefaultPersona, onDone }: Props) {
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState("mio");
  const [granted, setGranted] = useState(false);
  const last = 3;

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
              ) : (
                <>
                  <ol className="mt-4 space-y-3 text-[13px] leading-relaxed">
                    <li className="flex gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
                        1
                      </span>
                      読み上げたいアプリの設定を開き、ショートカットをダウンロードする
                    </li>
                    <li className="flex gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
                        2
                      </span>
                      ダウンロードしたファイルをダブルクリックして登録する
                    </li>
                    <li className="flex gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
                        3
                      </span>
                      通知オートメーションで「ショートカットを実行」を選ぶ
                    </li>
                  </ol>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    以後のオン・オフはこのアプリで変えられます。
                  </p>
                  <div className="flex-1" />
                  <Button className="w-full" onClick={() => setStep(2)}>
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
