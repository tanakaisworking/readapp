import { GeminiKeySettings } from "@/components/gemini-key-settings";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow, Play, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { GlobalCharacterRow, HomeAppList } from "@/components/home-app-list";
import { AppearanceSettings } from "@/components/appearance-settings";
import { StartupSettings } from "@/components/startup-settings";
import { MasAppList } from "@/components/mas-app-list";
import { CharacterImage } from "@/components/character-image";
import { CharacterList } from "@/components/character-list";
import { TrySpeak } from "@/components/try-speak";
import { VolumeSlider } from "@/components/volume-slider";
import { openCompanion } from "@/lib/companion-window";
import { KNOWN_APPS, type FullState, type Persona } from "@/lib/apps";
import { styleLabel, styleSample } from "@/lib/characters";
import { effectiveVoice, voiceName, type SystemVoice } from "@/lib/voices";
import { isOn, issueBadge, type SettingsApi } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  platform: string;
  edition: string;
  speaking: boolean;
  customs: Record<string, string | null | undefined>;
  systemVoices: SystemVoice[];
  onPreview: () => void;
  onOpenApp: (id: string) => void;
  onEditCharacter: (id: string) => void;
  onCreateCharacter: () => void;
  /** 初回の案内 (オンボーディング) を、設定を変えずにもう一度見る */
  onReplayOnboarding: () => void;
}

export function Home({ api, state, personas, platform, edition, speaking, customs, systemVoices, onPreview, onOpenApp, onEditCharacter, onCreateCharacter, onReplayOnboarding }: Props) {
  const [axOn, setAxOn] = useState<boolean | null>(null);
  const [watching, setWatching] = useState(false);
  const [togglingSpeech, setTogglingSpeech] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const mas = edition === "mas";
  const extraIds = Object.keys(state.enabled).filter((id) => id !== "readapp" && !KNOWN_APPS.some((a) => a.id === id));
  const totalOn = [...KNOWN_APPS.map((a) => a.id), ...extraIds].filter((id) => isOn(state, id)).length;
  const lastText = lastAt
    ? "最終受信 " + new Date(lastAt * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
    : null;
  const characterNameOf = (id: string): string | null => {
    const assigned = state.app_characters[id];
    return state.characters.find((c) => c.id === assigned)?.name ?? null;
  };

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

  // キャラの話し方は Apple Intelligence で作る。使えない間は通知をそのまま読むので、その時だけ知らせる
  const [intelligence, setIntelligence] = useState<string | null>(null);
  useEffect(() => {
    if (platform !== "macos") return;
    let disposed = false;
    const check = () => invoke<string>("apple_intelligence_status").then((s) => !disposed && setIntelligence(s)).catch(() => {});
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { disposed = true; window.removeEventListener("focus", onFocus); };
  }, [platform]);
  const usesStyle = state.characters.some((c) => c.style !== "raw");
  const intelligenceNote = !usesStyle ? null
    : intelligence === "disabled" ? "Apple Intelligenceがオフなので、通知をそのまま読み上げています。オンにすると、キャラの話し方で知らせます。"
    : intelligence === "not_ready" ? "Apple Intelligenceの準備中です。終わるまでは、通知をそのまま読み上げます。"
    : intelligence === "unsupported" ? "このMacはApple Intelligenceに対応していないため、キャラの話し方を使わず、通知をそのまま読み上げます。"
    : intelligence === "unavailable" ? "Apple Intelligenceを使えないため、今は通知をそのまま読み上げています。"
    : null;

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
    : reading ? state.speak_all ? "すべての通知を読み上げ" : totalOn + "件のアプリを読み上げ" : "おやすみ中";
  const receiving = platform === "macos" && !mas
    ? axOn === null ? "受信状態を確認中…" : watching ? "通知の受信待ち" : axOn ? "通知の受信を開始しています…" : lastAt ? "ショートカットから受信済み" : "直接受信の許可待ち"
    : null;

  const character = state.characters.find((c) => c.id === state.active_character) ?? state.characters[0];
  const sample = character ? styleSample(character.style) ?? character.style_note : "";
  const issue = api.speechIssue;
  const hasIssue = issue && state.voice.split(":")[0] === issue.voice_id.split(":")[0];
  const canPreview = state.speech_enabled && state.volume > 0;

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <section aria-label="全体のキャラ" className="surface p-4">
        <div className="flex items-start gap-3">
          <CharacterImage character={character} customs={customs} speaking={speaking} className="size-14 rounded-[16px]" />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[11px] font-medium text-muted">全体のキャラ</p>
            <h1 className="truncate text-base font-semibold">{character?.name}</h1>
            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">
              <Volume2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{voiceName(effectiveVoice(state.voice, api.cloudVoices), systemVoices)} · {character ? styleLabel(character.style, personas) : ""}</span>
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

        {sample && (
          <div className="relative mt-3.5 rounded-field bg-base-200 px-3.5 py-2.5">
            <span aria-hidden="true" className="absolute -top-1.5 left-6 size-3 rotate-45 rounded-[2px] bg-base-200" />
            <p className="relative line-clamp-2 whitespace-pre-line text-[13px] leading-relaxed">「{sample}」</p>
          </div>
        )}

        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium" role="status">
            <span aria-hidden="true" className={cn("status", reading ? "status-success" : "status-neutral opacity-40")} />
            <span className="truncate">{statusText}</span>
          </p>
          {(receiving || lastText) && (
            <p className="mt-0.5 truncate text-[11px] text-muted">{[receiving, lastText].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={onPreview} disabled={speaking || !canPreview}>
            {speaking ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Play aria-hidden="true" />}
            {speaking ? "話しています" : "声を試す"}
          </button>
          <button type="button" className="btn btn-sm border-base-300 bg-base-100" onClick={() => void openCompanion()}>
            <AppWindow aria-hidden="true" />
            小窓を開く
          </button>
        </div>
        {speechError && <p className="mt-2 text-xs text-error" role="alert">{speechError}</p>}
      </section>

      {intelligenceNote && (
        <div role="note" className="alert alert-soft alert-info flex items-center gap-3 px-3.5 py-3">
          <Sparkles className="size-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-base-content">{intelligenceNote}</p>
          {intelligence === "disabled" && (
            <button type="button" className="btn btn-sm shrink-0" onClick={() => void invoke("open_system_settings", { pane: "intelligence" }).catch(() => {})}>設定を開く</button>
          )}
        </div>
      )}

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

      <section aria-labelledby="home-characters-heading">
        <h2 id="home-characters-heading" className="section-label">キャラ</h2>
        <p className="mt-1 px-1 text-xs leading-relaxed text-muted">作ったキャラです。押すと、そのキャラの画像・話し方・声・声の出し方・読むアプリをまとめて変えられます。</p>
        <div className="surface mt-2 p-3">
          <CharacterList
            characters={state.characters}
            customs={customs}
            onPick={onEditCharacter}
            pickLabel={(c) => c.name + "を編集"}
            badge={(c) => (c.id === state.active_character ? "全体" : null)}
            onCreate={onCreateCharacter}
          />
        </div>
      </section>

      <section aria-labelledby="home-readers-heading">
        <h2 id="home-readers-heading" className="section-label">読み上げ担当</h2>
        <p className="mt-1 px-1 text-xs leading-relaxed text-muted">読み上げるアプリと、それぞれを読むキャラを決めます。</p>
        <div className="mt-2 space-y-2">
          {mas ? (
            <>
              <ul className="surface list"><GlobalCharacterRow api={api} state={state} customs={customs} /></ul>
              <MasAppList onOpenApp={onOpenApp} characterNameOf={characterNameOf} />
            </>
          ) : (
            <HomeAppList api={api} state={state} customs={customs} onOpenApp={onOpenApp} />
          )}
        </div>
      </section>

      <section aria-label="音量">
        <div className="surface px-4 py-3.5">
          <VolumeSlider value={state.volume} onCommit={async (v) => { await api.setVolume(v); if (v > 0) onPreview(); }} />
        </div>
      </section>

      {api.cloudVoices && (
        <section aria-labelledby="home-gemini-heading">
          <h2 id="home-gemini-heading" className="section-label">Geminiの声</h2>
          <p className="mt-1 px-1 text-xs leading-relaxed text-muted">登録すると、キャラの声にGeminiの声を選べます。</p>
          <div className="surface mt-2 space-y-2 p-1.5">
            <GeminiKeySettings api={api} />
            {api.cloudTtsConfigured && <p className="px-2 pb-1.5 text-xs leading-relaxed text-muted">「試用接続」の声はReadappのWorker経由でGoogleへ文章を送ります。</p>}
          </div>
        </section>
      )}

      <AppearanceSettings />

      {platform === "macos" && <StartupSettings api={api} state={state} />}

      <section aria-labelledby="home-help-heading">
        <h2 id="home-help-heading" className="section-label">困ったとき</h2>
        <details className="collapse collapse-arrow collapse-compact surface mt-2">
          <summary className="collapse-title">通知の動作確認</summary>
          <div className="collapse-content">
            <p className="text-xs leading-relaxed text-muted">読み上げられない時に、試しの通知を出して、届いてから読み上げるまでを確かめます。</p>
            <TrySpeak platform={platform} edition={edition} onDirect={(text) => void api.speak("preview", "", text)} />
          </div>
        </details>
        <div className="surface mt-2 flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">はじめの案内</p>
            <p className="text-xs leading-relaxed text-muted">最初に出る案内をもう一度見られます。見ても設定は変わりません。</p>
          </div>
          <button type="button" className="btn btn-sm shrink-0" onClick={onReplayOnboarding}>
            <Play aria-hidden="true" />
            再生
          </button>
        </div>
      </section>
    </div>
  );
}
