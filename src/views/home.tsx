import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, ShieldCheck, Volume2 } from "lucide-react";
import { HomeAppList } from "@/components/home-app-list";
import { HomeSpeech } from "@/components/home-speech";
import { AppearanceSettings } from "@/components/appearance-settings";
import { StartupSettings } from "@/components/startup-settings";
import { MasAppList } from "@/components/mas-app-list";
import { AppLogo } from "@/components/app-logo";
import {
  CLOUD_VOICES,
  GEMINI_VOICES,
  KNOWN_APPS,
  VOICES,
  personaAccent,
  speechSample,
  type FullState,
  type Persona,
  type Voice,
} from "@/lib/apps";
import { isOn, issueBadge, type SettingsApi } from "@/hooks/useSettings";
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
  const voices: Voice[] = [
    ...(api.geminiByok?.configured || state.voice.startsWith("gemini:") ? GEMINI_VOICES : []),
    ...VOICES.filter((v) => !v.premium),
    ...systemVoices.map((v) => ({ ...v, tagline: v.lang, premium: false })),
    ...(api.cloudTtsConfigured ? CLOUD_VOICES.map((v) => ({ ...v, name: `${v.name} · 試用接続` })) : VOICES.filter((v) => v.premium)),
  ];
  const voiceName = voices.find((v) => v.id === state.voice)?.name ?? "選択した声";

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

  const raw = state.mode === "raw";
  const active = personas.find((p) => p.id === state.persona);
  const accent = personaAccent(state.persona);
  const issue = api.speechIssue;
  const hasIssue = issue && state.voice.split(":")[0] === issue.voice_id.split(":")[0];
  const canPreview = state.speech_enabled && state.volume > 0;

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <section
        aria-label="いまの読み上げ"
        className="surface p-4"
        style={raw ? undefined : { backgroundColor: `color-mix(in oklab, ${accent} 13%, var(--color-base-100))` }}
      >
        <div className="flex items-start gap-3">
          <AppLogo size={52} speaking={speaking} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="truncate text-base font-semibold">{raw ? "そのまま読み上げ" : active?.name ?? "キャラを選択"}</h1>
            <p className="truncate text-xs text-muted">{raw ? "通知の文をそのまま読みます" : active?.tagline}</p>
            <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted">
              <Volume2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{voiceName}</span>
              {hasIssue && (
                <span className="badge badge-soft badge-warning badge-xs shrink-0">{issueBadge(issue)}</span>
              )}
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer flex-col items-center gap-1 pt-0.5">
            <input
              type="checkbox"
              role="switch"
              className="toggle toggle-primary"
              checked={state.speech_enabled}
              disabled={togglingSpeech}
              onChange={(e) => void toggleSpeech(e.target.checked)}
            />
            <span className="text-[11px] font-medium text-muted">読み上げ</span>
          </label>
        </div>

        <div className={cn("relative mt-3.5 rounded-field px-3.5 py-2.5", raw ? "bg-base-200" : "bg-base-100")}>
          <span aria-hidden="true" className={cn("absolute -top-1.5 left-6 size-3 rotate-45 rounded-[2px]", raw ? "bg-base-200" : "bg-base-100")} />
          <p className="relative whitespace-pre-line text-[13px] leading-relaxed">「{speechSample(state.persona, state.mode)}」</p>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-medium" role="status">
              <span aria-hidden="true" className={cn("status", reading ? "status-success" : "status-neutral opacity-40")} />
              <span className="truncate">{statusText}</span>
            </p>
            {(receiving || lastText) && (
              <p className="mt-0.5 truncate text-[11px] text-muted">{[receiving, lastText].filter(Boolean).join(" · ")}</p>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-sm shrink-0" onClick={onPreview} disabled={speaking || !canPreview}>
            {speaking ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Play aria-hidden="true" />}
            {speaking ? "話しています" : "声を試す"}
          </button>
        </div>
        {speechError && <p className="mt-2 text-xs text-error" role="alert">{speechError}</p>}
      </section>

      {platform === "macos" && !mas && axOn === false && (
        <div role="note" className="alert alert-soft alert-info flex items-center gap-3 px-3.5 py-3">
          <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-base-content">
            <p className="text-[13px] font-medium">通知を直接受け取る</p>
            <p className="text-xs leading-relaxed text-muted">許可すると、ショートカットの登録なしで通知を受け取れます。</p>
          </div>
          <button type="button" className="btn btn-sm shrink-0" onClick={() => void requestAx()}>許可</button>
        </div>
      )}

      <section aria-labelledby="home-apps-heading">
        <h2 id="home-apps-heading" className="section-label">読み上げるアプリ</h2>
        <div className="mt-2">
          {mas
            ? <MasAppList onOpenApp={onOpenApp} voiceNameOf={voiceNameOf} />
            : <HomeAppList api={api} state={state} onOpenApp={onOpenApp} voiceNameOf={voiceNameOf} />}
        </div>
      </section>

      <HomeSpeech api={api} state={state} personas={personas} voices={voices} voiceName={voiceName} platform={platform} edition={edition} speaking={speaking} onPreview={onPreview} onPickPersona={onPickPersona} />

      <AppearanceSettings />

      {platform === "macos" && <StartupSettings api={api} state={state} />}
    </div>
  );
}
