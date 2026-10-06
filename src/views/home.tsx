import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HomeAppList } from "@/components/home-app-list";
import { HomeSpeech } from "@/components/home-speech";
import { MasAppList } from "@/components/mas-app-list";
import { KNOWN_APPS, GEMINI_VOICES, type FullState, type Persona } from "@/lib/apps";
import { isOn, type SettingsApi } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  platform: string;
  edition: string;
  speaking: boolean;
  onPreview: () => void;
  onOpenApp: (id: string) => void;
  onPickPersona: (id: string) => void;
}

export function Home({ api, state, personas, platform, edition, speaking, onPreview, onOpenApp, onPickPersona }: Props) {
  const [axOn, setAxOn] = useState<boolean | null>(null);
  const [watching, setWatching] = useState(false);
  const [togglingSpeech, setTogglingSpeech] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [systemVoices, setSystemVoices] = useState<{ id: string; name: string; lang: string }[]>([]);
  const mas = edition === "mas";
  const extraIds = Object.keys(state.enabled).filter((id) => id !== "readapp" && !KNOWN_APPS.some((a) => a.id === id));
  const totalOn = [...KNOWN_APPS.map((a) => a.id), ...extraIds].filter((id) => isOn(state, id)).length;
  const lastText = lastAt
    ? `最終受信 ${new Date(lastAt * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`
    : null;
  const voiceNameOf = (id: string): string | null => {
    const voice = state.app_voices[id];
    if (!voice) return null;
    if (voice === "system") return "システム音声";
    if (voice.startsWith("gemini:")) return GEMINI_VOICES.find((v) => v.id === voice)?.name ?? null;
    return systemVoices.find((v) => v.id === voice)?.name ?? null;
  };

  useEffect(() => {
    let disposed = false;
    invoke<{ id: string; name: string; lang: string }[]>("get_system_voices")
      .then((voices) => { if (!disposed) setSystemVoices(voices); }).catch(() => {});
    return () => { disposed = true; };
  }, []);

  const refreshWatch = useCallback(async () => {
    const [last, trusted, active] = await Promise.all([
      invoke<{ app_id: string; at: number } | null>("get_last_received").catch(() => null),
      mas ? Promise.resolve(false) : invoke<boolean>("ax_trusted").catch(() => false),
      mas ? Promise.resolve(false) : invoke<boolean>("ax_watching").catch(() => false),
    ]);
    return { last, trusted, active };
  }, [mas]);

  useEffect(() => {
    if (platform !== "macos") return;
    let disposed = false;
    const tick = async () => {
      const status = await refreshWatch();
      if (disposed) return;
      setLastAt(status.last?.at ?? null);
      setAxOn(status.trusted);
      setWatching(status.active);
    };
    void tick();
    const id = setInterval(() => void tick(), 5000);
    return () => { disposed = true; clearInterval(id); };
  }, [platform, refreshWatch]);

  const requestAx = async () => {
    const ok = await invoke<boolean>("ax_request_access").catch(() => false);
    if (!ok) await invoke("ax_open_settings").catch(() => {});
    const status = await refreshWatch();
    setAxOn(status.trusted);
    setWatching(status.active);
    setLastAt(status.last?.at ?? null);
  };

  const toggleSpeech = async (enabled: boolean) => {
    setTogglingSpeech(true);
    setSpeechError(null);
    try {
      await api.setSpeechEnabled(enabled);
    } catch {
      setSpeechError("読み上げを切り替えられませんでした。もう一度お試しください。");
    } finally {
      setTogglingSpeech(false);
    }
  };

  const reading = state.speech_enabled && state.volume > 0 && (mas || state.speak_all || totalOn > 0);
  const statusText = !state.speech_enabled ? "読み上げ停止中" : state.volume === 0 ? "消音中" : mas
    ? lastAt ? "通知を受信済み" : "ショートカットの設定待ち"
    : reading ? state.speak_all ? "すべての通知を読み上げ" : `${totalOn}件のアプリを読み上げ` : "おやすみ中";
  const receiving = platform === "macos" && !mas
    ? axOn === null ? "受信状態を確認中…" : watching ? "通知の受信待ち" : axOn ? "通知の受信を開始しています…" : lastAt ? "ショートカットから受信済み" : "直接受信の許可待ち"
    : null;

  return (
    <div className="px-5 pb-5 pt-4">
      <header>
        <div className="flex items-center gap-2.5">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", reading ? "bg-emerald-500" : "bg-border")} aria-hidden="true" />
          <h1 className="text-[15px] font-semibold">readapp</h1>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-medium">読み上げ</span>
            <Switch checked={state.speech_enabled} onChange={(v) => void toggleSpeech(v)} label="読み上げ" disabled={togglingSpeech} />
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground" role="status">{statusText}</p>
        {speechError && <p className="mt-1.5 text-xs text-muted-foreground" role="alert">{speechError}</p>}
        {(receiving || lastText) && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{[receiving, lastText].filter(Boolean).join(" · ")}</p>
        )}
      </header>

      {platform === "macos" && !mas && axOn === false && (
        <details className="mt-3 rounded-lg bg-surface-muted px-3.5 py-2.5">
          <summary className="disclosure-summary">通知を直接受け取る</summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">許可すると、ショートカットの登録なしで通知を受け取れます。</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void requestAx()}>受信を許可</Button>
        </details>
      )}

      <section aria-label="読み上げるアプリ" className="mt-4">
        <h2 className="text-xs font-medium text-muted-foreground">読み上げるアプリ</h2>
        <div className="mt-2">
          {mas
            ? <MasAppList onOpenApp={onOpenApp} voiceNameOf={voiceNameOf} />
            : <HomeAppList api={api} state={state} onOpenApp={onOpenApp} voiceNameOf={voiceNameOf} />}
        </div>
      </section>

      <HomeSpeech api={api} state={state} personas={personas} systemVoices={systemVoices} platform={platform} edition={edition} speaking={speaking} onPreview={onPreview} onPickPersona={onPickPersona} />
    </div>
  );
}
