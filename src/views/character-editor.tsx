import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, ChevronLeft, ImagePlus, Play, Trash2 } from "lucide-react";
import { CharacterImage } from "@/components/character-image";
import { GeminiKeySettings } from "@/components/gemini-key-settings";
import { PremiumSheet } from "@/components/premium-sheet";
import { SpeechIssueNotice } from "@/components/speech-issue-notice";
import { VoiceOption } from "@/components/voice-option";
import type { SettingsApi } from "@/hooks/useSettings";
import type { FullState, Persona } from "@/lib/apps";
import {
  IMAGE_EXTENSIONS,
  NAME_MAX,
  NOTE_MAX,
  PRESET_IMAGES,
  STYLE_CUSTOM,
  STYLE_RAW,
  styleSample,
  type Character,
} from "@/lib/characters";
import { voiceOptions, type SystemVoice } from "@/lib/voices";
import { cn } from "@/lib/utils";

interface Props {
  api: SettingsApi;
  state: FullState;
  personas: Persona[];
  characterId: string;
  customs: Record<string, string | null | undefined>;
  systemVoices: SystemVoice[];
  speaking: boolean;
  onBack: () => void;
  /** このキャラで試しに話す */
  onPreview: (characterId: string) => void;
}

// キャラの編集。名前・画像・話し方・声を1か所で直す。変えるとすぐ保存する。
export function CharacterEditor({ api, state, personas, characterId, customs, systemVoices, speaking, onBack, onPreview }: Props) {
  const character = state.characters.find((c) => c.id === characterId);
  const [name, setName] = useState(character?.name ?? "");
  const [note, setNote] = useState(character?.style_note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [premiumVoice, setPremiumVoice] = useState<string | null>(null);

  // 消された時 (小窓など別の窓から) はホームへ戻る
  useEffect(() => {
    if (!character) onBack();
  }, [character, onBack]);
  if (!character) return null;

  const active = state.active_character === character.id;
  const voices = voiceOptions({
    systemVoices,
    geminiConfigured: !!api.geminiByok?.configured,
    cloudConfigured: api.cloudTtsConfigured,
    current: character.voice,
  });
  const issue = api.speechIssue;

  const save = async (patch: Partial<Character>, preview = false) => {
    setError(null);
    try {
      await api.updateCharacter({ ...character, ...patch });
      if (preview) onPreview(character.id);
    } catch {
      setError("保存できませんでした。もう一度お試しください。");
    }
  };

  const saveName = () => {
    const next = name.trim();
    if (!next) {
      setName(character.name);
      return;
    }
    if (next !== character.name) void save({ name: next });
  };

  const saveNote = () => {
    if (note.trim() !== character.style_note) void save({ style_note: note.trim() });
  };

  const pickFile = async () => {
    const picked = await open({ multiple: false, directory: false, filters: [{ name: "画像", extensions: IMAGE_EXTENSIONS }] }).catch(() => null);
    if (typeof picked !== "string") return;
    setError(null);
    try {
      await api.setCharacterImage(character.id, picked);
    } catch (e) {
      setError(e === "too_large" ? "20MBまでの画像を使えます。" : e === "unsupported" ? "PNG・JPEG・WebP・GIFの画像を使えます。" : "画像を読み込めませんでした。");
    }
  };

  const pickVoice = (id: string, label: string, premium: boolean) => {
    if (premium) {
      setPremiumVoice(label);
      return;
    }
    void save({ voice: id }, true);
  };

  const remove = async () => {
    try {
      await api.deleteCharacter(character.id);
      onBack();
    } catch {
      setError("削除できませんでした。");
    }
  };

  const styles = [
    ...personas.map((p) => ({ id: p.id, label: p.tagline, sample: styleSample(p.id) })),
    { id: STYLE_RAW, label: "通知をそのまま読む", sample: styleSample(STYLE_RAW) },
    { id: STYLE_CUSTOM, label: "自分で書く", sample: null },
  ];
  const hasCustom = character.image === "custom" && !!customs[character.id];

  return (
    <div className="space-y-5 px-4 pb-6 pt-3">
      <header className="flex items-center gap-1.5">
        <button type="button" onClick={onBack} aria-label="もどる" className="btn btn-ghost btn-sm btn-circle -ms-1">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 className="truncate text-base font-semibold">キャラを編集</h1>
      </header>

      <section aria-label="キャラ" className="surface flex gap-4 p-4">
        <CharacterImage character={character} customs={customs} speaking={speaking} className="aspect-[3/4] w-24 rounded-box" />
        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor="character-name" className="text-xs font-medium text-muted">名前</label>
          <input
            id="character-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
            className="input input-sm mt-1 w-full text-sm font-semibold"
          />
          <p className="mt-1 text-[11px] text-muted">好きな名前に変えられます。</p>
          <div className="flex-1" />
          <div className="mt-3 flex flex-col gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onPreview(character.id)} disabled={speaking || !state.speech_enabled || state.volume === 0}>
              {speaking ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Play aria-hidden="true" />}
              {speaking ? "話しています" : "試しに話す"}
            </button>
            {active ? (
              <span className="badge badge-soft badge-primary self-start">
                <Check className="size-3" aria-hidden="true" />
                いま話しているキャラ
              </span>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => void api.setActiveCharacter(character.id)}>
                このキャラで話す
              </button>
            )}
          </div>
        </div>
      </section>
      {error && <p className="-mt-2 px-1 text-xs text-error" role="alert">{error}</p>}

      <section aria-labelledby="character-image-heading">
        <h2 id="character-image-heading" className="section-label">画像</h2>
        <p className="mt-1 px-1 text-xs leading-relaxed text-muted">小窓の背景になります。</p>
        <ul className="surface mt-2 grid grid-cols-4 gap-2 p-3">
          {PRESET_IMAGES.map((p) => (
            <ImageTile key={p.id} name={p.name} src={p.src} selected={character.image === p.image} onSelect={() => void save({ image: p.image })} />
          ))}
          {hasCustom && (
            <ImageTile name="自分の画像" src={customs[character.id] ?? ""} selected={character.image === "custom"} onSelect={() => {}} />
          )}
          <li>
            <button
              type="button"
              onClick={() => void pickFile()}
              className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-field border border-dashed border-base-content/25 text-muted transition-colors hover:border-primary hover:text-primary"
            >
              <ImagePlus className="size-4" aria-hidden="true" />
              <span className="text-[10px] font-medium leading-tight">{hasCustom ? "画像を" : "自分の"}<br />{hasCustom ? "変える" : "画像"}</span>
            </button>
          </li>
        </ul>
      </section>

      <section aria-labelledby="character-style-heading">
        <h2 id="character-style-heading" className="section-label">話し方</h2>
        <ul className="surface mt-2 space-y-0.5 p-1.5">
          {styles.map((s) => {
            const selected = character.style === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void save({ style: s.id }, s.id !== STYLE_CUSTOM)}
                  className={cn("flex w-full items-center gap-3 rounded-field px-3 py-2 text-left transition-colors duration-150", selected ? "bg-primary/10" : "hover:bg-base-200")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{s.label}</span>
                    {s.sample && <span className="block truncate text-xs text-muted">「{s.sample.replace(/\n/g, "")}」</span>}
                  </span>
                  <Check className={cn("size-4 shrink-0 text-primary transition-opacity", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                </button>
                {s.id === STYLE_CUSTOM && selected && (
                  <div className="px-3 pb-2.5 pt-1">
                    <textarea
                      aria-label="話し方"
                      value={note}
                      maxLength={NOTE_MAX}
                      rows={3}
                      placeholder="例: 関西弁で、元気に短く。語尾は「〜やで」"
                      onChange={(e) => setNote(e.target.value)}
                      onBlur={saveNote}
                      className="textarea textarea-sm w-full text-[13px] leading-relaxed"
                    />
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span>通知の内容は変えずに、言い方だけをこの口調にします。</span>
                      <span className="tabular-nums">{note.length}/{NOTE_MAX}</span>
                    </div>
                    <button type="button" className="btn btn-xs mt-1.5" onClick={() => { saveNote(); onPreview(character.id); }} disabled={speaking}>
                      <Play aria-hidden="true" />
                      この話し方で試す
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="character-voice-heading">
        <h2 id="character-voice-heading" className="section-label">声</h2>
        <div className="surface mt-2 space-y-3 p-1.5">
          {issue?.voice_id.startsWith("cloud:") && <div className="px-2 pt-2"><SpeechIssueNotice issue={issue} compact /></div>}
          <ul className="space-y-0.5">
            {voices.map((v) => (
              <VoiceOption
                key={v.id}
                name={v.name}
                note={v.tagline}
                premium={v.premium}
                selected={character.voice === v.id}
                disabled={v.id.startsWith("gemini:") && !api.geminiByok?.configured}
                onSelect={() => pickVoice(v.id, v.name, v.premium)}
              />
            ))}
          </ul>
          <div className="space-y-2 px-2.5 pb-2.5">
            {api.cloudTtsConfigured && <p className="text-xs leading-relaxed text-muted">「試用接続」の声はreadappのWorker経由でGoogleへ文章を送ります。</p>}
            {character.voice.startsWith("gemini:") && api.geminiByok && !api.geminiByok.configured && (
              <p className="text-xs leading-relaxed text-muted">Geminiの声を使うにはAPIキーを登録してください。未登録の間はシステム音声で読み上げます。</p>
            )}
            <GeminiKeySettings api={api} />
          </div>
        </div>
      </section>

      {state.characters.length > 1 && (
        <section aria-label="キャラの削除" className="pt-1">
          {confirmDelete ? (
            <div className="surface flex items-center gap-2 p-3" role="alert">
              <p className="min-w-0 flex-1 text-[13px]">{character.name}を削除しますか？</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>やめる</button>
              <button type="button" className="btn btn-error btn-sm" onClick={() => void remove()}>削除する</button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              このキャラを削除
            </button>
          )}
        </section>
      )}
      <PremiumSheet voiceName={premiumVoice} onClose={() => setPremiumVoice(null)} />
    </div>
  );
}

function ImageTile({ name, src, selected, onSelect }: { name: string; src: string; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" aria-pressed={selected} aria-label={name} onClick={onSelect} className="group/tile block w-full text-left">
        <span
          className={cn(
            "relative block aspect-[3/4] overflow-hidden rounded-field ring-offset-2 ring-offset-base-100 transition-all duration-150",
            selected ? "ring-2 ring-primary" : "group-hover/tile:ring-2 group-hover/tile:ring-base-content/20",
          )}
        >
          <img src={src} alt="" draggable={false} className="size-full object-cover transition-transform duration-200 group-hover/tile:scale-105" />
          {selected && (
            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-content" aria-hidden="true">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="mt-1 block truncate text-center text-[10px] font-medium text-muted">{name}</span>
      </button>
    </li>
  );
}
