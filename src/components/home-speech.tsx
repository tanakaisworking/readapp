import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonaPicker } from "@/components/persona-picker";
import { PremiumSheet } from "@/components/premium-sheet";
import { TrySpeak } from "@/components/try-speak";
import { VolumeSlider } from "@/components/volume-slider";
import { GeminiKeySettings } from "@/components/gemini-key-settings";
import { SpeechIssueNotice } from "@/components/speech-issue-notice";
import { VOICES, CLOUD_VOICES, GEMINI_VOICES, personaAccent, speechSample, type FullState, type Persona } from "@/lib/apps";
import type { SettingsApi } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  systemVoices: { id: string; name: string; lang: string }[];
  platform: string;
  edition: string;
  speaking: boolean;
  onPreview: () => void;
  onPickPersona: (id: string) => void;
}

export function HomeSpeech({ api, state, personas, systemVoices, platform, edition, speaking, onPreview, onPickPersona }: Props) {
  const [premiumVoice, setPremiumVoice] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const active = personas.find((p) => p.id === state.persona);
  const voices = [
    ...(api.geminiByok?.configured || state.voice.startsWith("gemini:") ? GEMINI_VOICES : []),
    ...VOICES.filter((v) => !v.premium),
    ...systemVoices.map((v) => ({ ...v, tagline: v.lang, premium: false })),
    ...(api.cloudTtsConfigured ? CLOUD_VOICES.map((v) => ({ ...v, name: `${v.name} · 試用接続` })) : VOICES.filter((v) => v.premium)),
  ];
  const voiceName = voices.find((v) => v.id === state.voice)?.name ?? "選択した声";
  const issue = api.speechIssue;
  const hasIssue = issue && state.voice.split(":")[0] === issue.voice_id.split(":")[0];

  const pickVoice = async (id: string, name: string, premium: boolean) => {
    if (premium) {
      setPremiumVoice(name);
      return;
    }
    await api.setVoice(id);
    onPreview();
  };

  return (
    <section aria-label="声と話し方" className="mt-4">
      <h2 className="text-xs font-medium text-muted-foreground">声と話し方</h2>
      <div className="mt-2 rounded-lg bg-card p-3 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
        <div className="flex items-center gap-2.5">
          <motion.span
            animate={speaking && !reduce ? { scale: [1, 1.1, 1] } : { scale: 1 }}
            transition={speaking && !reduce ? { duration: 2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.15 }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            style={{ backgroundColor: `${personaAccent(state.persona)}44` }}
            aria-hidden="true"
          >
            {state.mode === "raw" ? <Play className="h-4 w-4" /> : active?.name.slice(0, 1)}
          </motion.span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{state.mode === "raw" ? "そのまま読み上げ" : active?.name ?? "キャラを選択"}</p>
            <p className="truncate text-xs text-muted-foreground">{voiceName}{hasIssue && <span className="ml-1.5 text-warning">· {issue.kind === "quota" ? "使用上限" : "接続を確認"}</span>}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onPreview} disabled={speaking || !state.speech_enabled || state.volume === 0}>
            <Play aria-hidden="true" />
            声を試す
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-surface-muted p-1" role="group" aria-label="話し方">
          {[
            { id: "raw", label: "そのまま読む" },
            { id: "persona", label: "キャラで話す" },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={state.mode === m.id}
              onClick={() => void api.setMode(m.id)}
              className={cn(
                "h-8 rounded-sm text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50",
                state.mode === m.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {state.mode === "persona" && (
          <details className="mt-2">
            <summary className="disclosure-summary">キャラを変更<span className="ml-auto truncate pl-2 text-xs font-normal text-muted-foreground">{active?.name}</span></summary>
            <div className="mt-3">
              <PersonaPicker personas={personas} selected={state.persona} onSelect={onPickPersona} speaking={speaking} />
              <p className="mt-3 whitespace-pre-line rounded-md bg-surface-muted px-3 py-2.5 text-[13px] leading-relaxed">「{speechSample(state.persona, state.mode)}」</p>
            </div>
          </details>
        )}

        <details className="mt-2">
          <summary className="disclosure-summary">声を変更<span className="ml-auto truncate pl-2 text-xs font-normal text-muted-foreground">{voiceName}</span></summary>
          {issue?.voice_id.startsWith("cloud:") && <div className="mt-3"><SpeechIssueNotice issue={issue} compact /></div>}
          <GeminiKeySettings api={api} />
          {api.geminiByok?.configured && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Gemini 3.8 Flash TTSの声を、自分のAPIキーで使えます。</p>}
          {state.voice.startsWith("gemini:") && api.geminiByok && !api.geminiByok.configured && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Geminiの声を使うにはAPIキーを登録してください。未登録の間はシステム音声で読み上げます。</p>}
          {api.cloudTtsConfigured && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">「試用接続」の声はreadappのWorker経由でGoogleへ文章を送ります。</p>}
          <ul className="mt-3 space-y-1.5">
            {voices.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={state.voice === v.id}
                  disabled={v.id.startsWith("gemini:") && !api.geminiByok?.configured}
                  onClick={() => void pickVoice(v.id, v.name, v.premium)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50",
                    state.voice === v.id && "bg-primary-soft",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">{v.name}{v.premium && <Sparkles className="h-3.5 w-3.5 text-primary" aria-label="プレミアム" />}</span>
                    <span className="block text-xs text-muted-foreground">{v.tagline}</span>
                  </span>
                  {state.voice === v.id && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        </details>
        <VolumeSlider embedded value={state.volume} onCommit={async (v) => { await api.setVolume(v); if (v > 0) onPreview(); }} />
      </div>

      <details className="mt-2">
        <summary className="disclosure-summary">通知の動作確認</summary>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">通知が届いて、読み上げるまでを試せます。</p>
        <TrySpeak platform={platform} edition={edition} onDirect={(text) => void api.speak("preview", "", text)} />
      </details>
      <PremiumSheet voiceName={premiumVoice} onClose={() => setPremiumVoice(null)} />
    </section>
  );
}
