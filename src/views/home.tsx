import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { FolderOpen, Play, Plus, Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PersonaPicker } from "@/components/persona-picker";
import { PremiumSheet } from "@/components/premium-sheet";
import {
  KNOWN_APPS,
  VOICES,
  knownApp,
  personaAccent,
  type Persona,
} from "@/lib/apps";
import { isOn, type SettingsApi } from "@/hooks/useSettings";
import type { FullState } from "@/lib/apps";
import { cn } from "@/lib/utils";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  platform: string;
  speaking: boolean;
  onPreview: () => void;
  onOpenApp: (id: string) => void;
  onPickPersona: (id: string) => void;
}

export function Home({ api, state, personas, platform, speaking, onPreview, onOpenApp, onPickPersona }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [axOn, setAxOn] = useState<boolean | null>(null);
  const [watching, setWatching] = useState(false);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [observed, setObserved] = useState<string[]>([]);
  const displayOf = (id: string) =>
    state.names[id] ?? knownApp(id).name;
  const [systemVoices, setSystemVoices] = useState<{ id: string; name: string; lang: string }[]>([]);
  const [premiumVoice, setPremiumVoice] = useState<string | null>(null);
  const onCount = KNOWN_APPS.filter((a) => isOn(state, a.id)).length;
  const extraIds = Object.keys(state.enabled).filter((id) => !KNOWN_APPS.some((a) => a.id === id));
  const newcomers = observed.filter(
    (id) => !KNOWN_APPS.some((a) => a.id === id) && !(id in state.enabled),
  );
  const totalOn = onCount + extraIds.filter((id) => isOn(state, id)).length;
  const active = personas.find((p) => p.id === state.persona);
  const voices = [
    ...VOICES.filter((v) => !v.premium),
    ...systemVoices.map((v) => ({ id: v.id, name: v.name, tagline: v.lang, premium: false })),
    ...VOICES.filter((v) => v.premium),
  ];

  useEffect(() => {
    if (platform === "macos") {
      invoke<boolean>("ax_trusted").then(setAxOn).catch(() => setAxOn(false));
    }
    invoke<{ id: string; name: string; lang: string }[]>("get_system_voices")
      .then(setSystemVoices)
      .catch(() => {});
    const fetchObserved = () =>
      invoke<string[]>("get_observed_apps").then(setObserved).catch(() => {});
    void fetchObserved();
    let unlisten: (() => void) | null = null;
    listen("observed-changed", () => void fetchObserved())
      .then((f) => {
        unlisten = f;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [platform]);

  // 監視状態と最終受信を追う (ローカル取得、5秒間隔)
  useEffect(() => {
    if (platform !== "macos") return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await refreshWatch();
    };
    void tick();
    const id = setInterval(() => void tick(), 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [platform]);

  const refreshWatch = async () => {
    try {
      const [w, last] = await Promise.all([
        invoke<boolean>("ax_watching"),
        invoke<{ app_id: string; at: number } | null>("get_last_received").catch(() => null),
      ]);
      setWatching(w);
      setLastAt(last ? last.at : null);
    } catch {
      /* 取得失敗は無視 */
    }
  };

  const requestAx = async () => {
    const ok = await invoke<boolean>("ax_request_access").catch(() => false);
    if (ok) {
      setAxOn(true);
      // 許可直後に即反映 (インターバルを待たない)
      await refreshWatch();
    } else {
      await invoke("ax_open_settings").catch(() => {});
      const recheck = await invoke<boolean>("ax_trusted").catch(() => false);
      setAxOn(recheck);
      if (recheck) await refreshWatch();
    }
  };

  const pickVoice = async (id: string, name: string, premium: boolean) => {
    if (premium) {
      setPremiumVoice(name);
      return;
    }
    await api.setVoice(id);
    onPreview();
  };

  const pickFromFile = async () => {
    const picked = await open({
      directory: false,
      multiple: false,
      defaultPath: "/Applications",
      filters: [{ name: "Application", extensions: ["app"] }],
    }).catch(() => null);
    if (typeof picked !== "string") return;
    const file = picked.split("/").pop() ?? "";
    const display = file.replace(/\.app$/i, "");
    const id = display.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
    if (!id) return;
    await api.setEnabled(id, true, display);
  };

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

      <section aria-label="すべて読み上げ" className="mt-4 rounded-xl bg-card p-4 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">すべての通知を読み上げる</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              オンの間はアプリ別の設定に関わらず読む
            </p>
          </div>
          <Switch
            checked={state.speak_all}
            onChange={(v) => void api.setSpeakAll(v)}
            label="すべての通知を読み上げる"
          />
        </div>
      </section>

      <section aria-label="キャラ" className="mt-4">
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
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPickerOpen((v) => !v)}>
                  変える
                </Button>
              </div>
              {pickerOpen && (
                <div className="mt-3">
                  <PersonaPicker
                    personas={personas}
                    selected={state.persona}
                    onSelect={(id) => void onPickPersona(id)}
                    speaking={speaking}
                  />
                </div>
              )}
              <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2.5 text-[13px] leading-relaxed">
                「Claudeの作業、
                <br />
                終わったみたいだよ」
              </p>
              <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-1" role="group" aria-label="話し方">
                {[
                  { id: "raw", label: "素文で読む" },
                  { id: "persona", label: "キャラっぽく話す" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={state.mode === m.id}
                    onClick={() => void api.setMode(m.id)}
                    className={cn(
                      "h-8 rounded-md text-[13px] font-medium outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary/50",
                      state.mode === m.id
                        ? "bg-card text-foreground shadow-[0_1px_2px_rgba(41,39,45,0.1)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={onPreview} disabled={speaking}>
                  <Play className="h-3.5 w-3.5" />
                  試しに喋る
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      <section aria-label="声" className="mt-5">
        <h2 className="text-xs font-medium text-muted-foreground">声</h2>
        <ul className="mt-2 space-y-1.5">
          {voices.map((v) => {
            const selected = state.voice === v.id;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void pickVoice(v.id, v.name, v.premium)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg bg-card px-3.5 py-2.5 text-left outline-none transition-all duration-150 hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/50 shadow-[0_1px_2px_rgba(41,39,45,0.06)]",
                    selected && "ring-2 ring-primary/60",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {v.name}
                      {v.premium && (
                        <Sparkles className="h-3.5 w-3.5 text-primary" aria-label="プレミアム" />
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">{v.tagline}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="読み上げるアプリ" className="mt-5">
        <h2 className="text-xs font-medium text-muted-foreground">読み上げるアプリ</h2>
        <ul className="mt-2 space-y-1.5">
          {[...KNOWN_APPS, ...extraIds.map((id) => knownApp(id))].map((app) => (
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
                  <span className="block truncate text-sm font-medium">{displayOf(app.id)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {isOn(state, app.id) ? "読み上げます" : "おやすみ中"}
                  </span>
                </span>
                <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <Switch
                    checked={isOn(state, app.id)}
                    onChange={(v) => void api.setEnabled(app.id, v)}
                    label={`${displayOf(app.id)}の読み上げ`}
                  />
                </span>
              </div>
            </li>
          ))}
        </ul>
        {newcomers.length > 0 && (
          <div className="mt-3 rounded-xl bg-card p-4 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
            <p className="text-[13px] font-medium">見つけたアプリ</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              通知が来ていたアプリです。追加すると読み上げます。
            </p>
            <ul className="mt-2 space-y-1.5">
              {newcomers.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{displayOf(id)}</span>
                  <Button size="sm" variant="outline" onClick={() => void api.setEnabled(id, true)}>
                    <Plus className="h-3.5 w-3.5" />
                    追加
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button className="mt-3 w-full" variant="outline" onClick={() => void pickFromFile()}>
          <FolderOpen className="h-4 w-4" />
          ファイルからアプリを追加
        </Button>
      </section>

      {platform === "macos" && (
        <section aria-label="直接監視" className="mt-5">
          <h2 className="text-xs font-medium text-muted-foreground">直接監視</h2>
          <div className="mt-2 rounded-xl bg-card p-4 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
            {!axOn ? (
              <>
                <p className="text-[13px] font-medium">ショートカット経由で受けています</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  許可すると、ショートカットの登録なしで通知が届きます。
                </p>
                <Button className="mt-3 w-full" variant="outline" onClick={() => void requestAx()}>
                  通知の直接監視を許可
                </Button>
              </>
            ) : (
              <>
                <p className="flex items-center gap-1.5 text-[13px] font-medium">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      watching ? "bg-emerald-500" : "bg-border",
                    )}
                  />
                  {watching ? "通知を受け取っています" : "開始待ちです…"}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                  {lastAt
                    ? `最終受信: ${new Date(lastAt * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`
                    : "まだ受信がありません。通知が来たら読み上げます。"}
                </p>
              </>
            )}
          </div>
        </section>
      )}
      <PremiumSheet voiceName={premiumVoice} onClose={() => setPremiumVoice(null)} />
    </div>
  );
}
