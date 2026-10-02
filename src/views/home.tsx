import { useState } from "react";
import { motion } from "motion/react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PersonaPicker } from "@/components/persona-picker";
import {
  KNOWN_APPS,
  knownApp,
  personaAccent,
  type Persona,
} from "@/lib/apps";
import { isOn, modeOf, personaOf, type SettingsApi } from "@/hooks/useSettings";
import type { FullState } from "@/lib/apps";
import { cn } from "@/lib/utils";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  speaking: boolean;
  onPreview: () => void;
  onOpenApp: (id: string) => void;
  onPickPersona: (id: string) => void;
}

export function Home({ api, state, personas, speaking, onPreview, onOpenApp, onPickPersona }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const onCount = KNOWN_APPS.filter((a) => isOn(state, a.id)).length;
  const extraIds = Object.keys(state.enabled).filter((id) => !KNOWN_APPS.some((a) => a.id === id));
  const totalOn = onCount + extraIds.filter((id) => isOn(state, id)).length;
  const active = personas.find((p) => p.id === state.default_persona);

  return (
    <div className="px-5 pb-5 pt-4">
      <header className="flex items-center gap-2.5">
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            totalOn > 0 ? "bg-emerald-500" : "bg-border",
          )}
        />
        <h1 className="text-[15px] font-semibold">readapp</h1>
        <p className="ml-auto text-xs text-muted-foreground">
          {totalOn > 0 ? `${totalOn}件のアプリを読み上げ中` : "おやすみ中"}
        </p>
      </header>
      <p className="mt-3 text-[22px] font-semibold leading-snug">通知を、好きな声に。</p>

      <section aria-label="読み上げるアプリ" className="mt-4">
        <h2 className="text-xs font-medium text-muted-foreground">読み上げるアプリ</h2>
        <ul className="mt-2 space-y-1.5">
          {KNOWN_APPS.map((app) => (
            <li key={app.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpenApp(app.id)}
                onKeyDown={(e) => e.key === "Enter" && onOpenApp(app.id)}
                className="flex cursor-pointer items-center gap-3 rounded-lg bg-card px-3.5 py-3 outline-none transition-all duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/50 shadow-[0_1px_2px_rgba(41,39,45,0.06)]"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                  style={{ backgroundColor: `${app.color}2e` }}
                >
                  {app.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{app.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {personaName(personas, personaOf(state, app.id))} ·{" "}
                    {modeOf(state, app.id) === "persona" ? "キャラっぽく話す" : "素文で読む"}
                  </span>
                </span>
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <Switch
                    checked={isOn(state, app.id)}
                    onChange={(v) => void api.setEnabled(app.id, v)}
                    label={`${app.name}の読み上げ`}
                  />
                </span>
              </div>
            </li>
          ))}
          {extraIds.map((id) => {
            const app = knownApp(id);
            return (
              <li key={id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenApp(id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpenApp(id)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg bg-card px-3.5 py-3 outline-none transition-all duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/50 shadow-[0_1px_2px_rgba(41,39,45,0.06)]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[13px] font-semibold">
                    {app.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{app.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {personaName(personas, personaOf(state, id))} ·{" "}
                      {modeOf(state, id) === "persona" ? "キャラっぽく話す" : "素文で読む"}
                    </span>
                  </span>
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Switch
                      checked={isOn(state, id)}
                      onChange={(v) => void api.setEnabled(id, v)}
                      label={`${app.name}の読み上げ`}
                    />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="キャラ" className="mt-5">
        <h2 className="text-xs font-medium text-muted-foreground">キャラ</h2>
        <div className="mt-2 rounded-xl bg-card p-4 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
          {active && (
            <>
              <div className="flex items-center gap-2.5">
                <motion.span
                  animate={speaking ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                  transition={
                    speaking
                      ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
                      : { duration: 0.15 }
                  }
                  className="flex h-10 w-10 items-center justify-center rounded-full text-base font-semibold"
                  style={{ backgroundColor: `${personaAccent(active.id)}44` }}
                >
                  {active.name.slice(0, 1)}
                </motion.span>
                <div>
                  <p className="text-sm font-medium">{active.name}</p>
                  <p className="text-xs text-muted-foreground">{active.tagline}</p>
                </div>
              </div>
              <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2.5 text-[13px] leading-relaxed">
                「Claudeの作業、
                <br />
                終わったみたいだよ」
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={onPreview} disabled={speaking}>
                  <Play className="h-3.5 w-3.5" />
                  試しに喋る
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPickerOpen((v) => !v)}>
                  キャラを変える
                </Button>
              </div>
              {pickerOpen && (
                <div className="mt-3">
                  <PersonaPicker
                    personas={personas}
                    selected={state.default_persona}
                    onSelect={(id) => void onPickPersona(id)}
                    speaking={speaking}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <section aria-label="声" className="mt-5">
        <h2 className="text-xs font-medium text-muted-foreground">声</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          今はシステム音声で話します。アプリごとの声は、各アプリの設定で変えられます。
        </p>
      </section>
    </div>
  );
}

function personaName(personas: Persona[], id: string): string {
  return personas.find((p) => p.id === id)?.name ?? id;
}
