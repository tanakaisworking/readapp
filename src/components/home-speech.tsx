import { useState } from "react";
import { PersonaPicker } from "@/components/persona-picker";
import { PremiumSheet } from "@/components/premium-sheet";
import { TrySpeak } from "@/components/try-speak";
import { VolumeSlider } from "@/components/volume-slider";
import { GeminiKeySettings } from "@/components/gemini-key-settings";
import { SpeechIssueNotice } from "@/components/speech-issue-notice";
import { VoiceOption } from "@/components/voice-option";
import type { FullState, Persona, Voice } from "@/lib/apps";
import type { SettingsApi } from "@/hooks/useSettings";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  voices: Voice[];
  voiceName: string;
  platform: string;
  edition: string;
  speaking: boolean;
  onPreview: () => void;
  onPickPersona: (id: string) => void;
}

const MODES = [
  { id: "persona", label: "キャラで話す" },
  { id: "raw", label: "そのまま読む" },
];

export function HomeSpeech({ api, state, personas, voices, voiceName, platform, edition, speaking, onPreview, onPickPersona }: Props) {
  const [premiumVoice, setPremiumVoice] = useState<string | null>(null);
  const active = personas.find((p) => p.id === state.persona);
  const issue = api.speechIssue;

  const pickVoice = async (id: string, name: string, premium: boolean) => {
    if (premium) {
      setPremiumVoice(name);
      return;
    }
    await api.setVoice(id);
    onPreview();
  };

  return (
    <>
      <section aria-labelledby="home-speech-heading">
        <h2 id="home-speech-heading" className="section-label">話し方と声</h2>
        <div className="surface mt-2">
          <div className="p-3">
            <div role="radiogroup" aria-label="話し方" className="tabs tabs-box tabs-sm flex-nowrap bg-base-200 p-1">
              {MODES.map((m) => (
                <input
                  key={m.id}
                  type="radio"
                  name="readapp-mode"
                  className="tab flex-1 text-[13px]"
                  aria-label={m.label}
                  checked={state.mode === m.id}
                  onChange={() => void api.setMode(m.id)}
                />
              ))}
            </div>
          </div>

          {state.mode === "persona" && (
            <details className="collapse collapse-arrow collapse-compact rounded-none border-t border-base-200">
              <summary className="collapse-title">
                キャラ
                <span className="ml-auto truncate text-xs font-normal text-muted">{active?.name}</span>
              </summary>
              <div className="collapse-content">
                <PersonaPicker personas={personas} selected={state.persona} onSelect={onPickPersona} speaking={speaking} />
              </div>
            </details>
          )}

          <details className="collapse collapse-arrow collapse-compact rounded-none border-t border-base-200">
            <summary className="collapse-title">
              声
              <span className="ml-auto truncate text-xs font-normal text-muted">{voiceName}</span>
            </summary>
            <div className="collapse-content space-y-3">
              {issue?.voice_id.startsWith("cloud:") && <SpeechIssueNotice issue={issue} compact />}
              <ul className="-mx-1.5 space-y-0.5">
                {voices.map((v) => (
                  <VoiceOption
                    key={v.id}
                    name={v.name}
                    note={v.tagline}
                    premium={v.premium}
                    selected={state.voice === v.id}
                    disabled={v.id.startsWith("gemini:") && !api.geminiByok?.configured}
                    onSelect={() => void pickVoice(v.id, v.name, v.premium)}
                  />
                ))}
              </ul>
              {api.cloudTtsConfigured && <p className="text-xs leading-relaxed text-muted">「試用接続」の声はreadappのWorker経由でGoogleへ文章を送ります。</p>}
              {state.voice.startsWith("gemini:") && api.geminiByok && !api.geminiByok.configured && (
                <p className="text-xs leading-relaxed text-muted">Geminiの声を使うにはAPIキーを登録してください。未登録の間はシステム音声で読み上げます。</p>
              )}
              <GeminiKeySettings api={api} />
            </div>
          </details>

          <div className="border-t border-base-200 px-4 py-3.5">
            <VolumeSlider value={state.volume} onCommit={async (v) => { await api.setVolume(v); if (v > 0) onPreview(); }} />
          </div>
        </div>
      </section>

      <details className="collapse collapse-arrow collapse-compact surface">
        <summary className="collapse-title">通知の動作確認</summary>
        <div className="collapse-content">
          <p className="text-xs leading-relaxed text-muted">通知が届いて、読み上げるまでを試せます。</p>
          <TrySpeak platform={platform} edition={edition} onDirect={(text) => void api.speak("preview", "", text)} />
        </div>
      </details>
      <PremiumSheet voiceName={premiumVoice} onClose={() => setPremiumVoice(null)} />
    </>
  );
}
