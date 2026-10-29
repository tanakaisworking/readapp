import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Persona } from "@/lib/apps";

/** キャラ (Rust側 characters::Character と同じ形)。名前・画像・声・話し方をひとまとまりで持つ */
export interface Character {
  id: string;
  name: string;
  /** "preset:<id>" か、取り込んだ画像の "custom" */
  image: string;
  voice: string;
  /** 話し方: 口調のid (mio など)、"raw" (そのまま読む)、"custom" (自分で書く) */
  style: string;
  style_note: string;
  /** Geminiの声で読む時の声の出し方 (声の高さ・速さ・気持ちなど)。システム音声では使わない */
  voice_prompt: string;
  /** このキャラ専用の画像 ("preset:<id>")。画像とキャラは結びついていて、選べるのはこれか取り込んだ画像だけ */
  base_image: string;
}

export interface CharactersState {
  characters: Character[];
  active_character: string;
}

/** オンボーディングの最後にキャラが言うあいさつ (話し方で言い換えずに読む) */
export const ONBOARDING_GREETING = "こんにちは、これからよろしくね！";

export const STYLE_RAW = "raw";
export const STYLE_CUSTOM = "custom";
export const NAME_MAX = 20;
export const NOTE_MAX = 200;
export const VOICE_PROMPT_MAX = 200;

/** 声の出し方を使う声か (Geminiの声: 自分のAPIキーと試用接続) */
export function usesVoicePrompt(voice: string): boolean {
  return voice.startsWith("gemini:") || voice.startsWith("cloud:");
}

/** 同梱の画像 (public/companion/)。下4割は小窓の吹き出しが重なるので、主役が上半分にいる画像にする。
 * live は画像ではなくコードで描いて動かすキャラ (components/live-character.tsx)。src は描けない所での代わりの絵 */
export const PRESET_IMAGES = [
  { id: "cat", name: "ねこ" },
  { id: "shiba", name: "柴犬" },
  { id: "bunny", name: "うさぎ" },
  { id: "buncho", name: "文鳥" },
  { id: "girl", name: "女の子" },
  { id: "boy", name: "男の子" },
].map((p) => ({ ...p, image: "preset:" + p.id, src: "/companion/" + p.id + ".webp", live: false }))
  .concat([{ id: "fuki", name: "ふきだし (動く)", image: "preset:fuki", src: "/logo.png", live: true }]);

/** コードで描いて動かすキャラか */
export function isLiveImage(image: string | undefined): boolean {
  return !!image && PRESET_IMAGES.some((p) => p.live && p.image === image);
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

/** 取り込んだ画像が無い時などに見せる画像 */
export const FALLBACK_IMAGE = PRESET_IMAGES[0].src;

/** キャラの画像のURL。取り込んだ画像は読み込み中なら null */
export function characterSrc(character: Character | undefined, customs: Record<string, string | null | undefined>): string | null {
  if (!character) return FALLBACK_IMAGE;
  const preset = PRESET_IMAGES.find((p) => p.image === character.image);
  if (preset) return preset.src;
  const custom = customs[character.id];
  if (custom === undefined) return null;
  return custom ?? FALLBACK_IMAGE;
}

/** 取り込んだ画像を読み込む (無いキャラは null)。差し替えられたら読み直す */
export function useCustomImages(characters: Character[] | undefined): Record<string, string | null | undefined> {
  const [images, setImages] = useState<Record<string, string | null | undefined>>({});
  // 専用の画像に戻していても、取り込んだ画像は残っていれば読み込む (編集でまた選べるように)
  const ids = (characters ?? []).map((c) => c.id).join(",");

  useEffect(() => {
    let disposed = false;
    const load = (id: string) =>
      invoke<string | null>("character_image", { id })
        .then((url) => !disposed && setImages((cur) => ({ ...cur, [id]: url })))
        .catch(() => !disposed && setImages((cur) => ({ ...cur, [id]: null })));
    ids.split(",").filter(Boolean).forEach((id) => void load(id));
    let off: (() => void) | undefined;
    listen<string>("character-image-changed", ({ payload }) => void load(payload))
      .then((f) => (disposed ? f() : (off = f)))
      .catch(() => {});
    return () => { disposed = true; off?.(); };
  }, [ids]);

  return images;
}

/** 話し方の名前 (口調は Rust の personas() の説明、そのほかは固定の言い方) */
export function styleLabel(style: string, personas: Persona[]): string {
  if (style === STYLE_RAW) return "通知をそのまま読む";
  if (style === STYLE_CUSTOM) return "自分で書いた話し方";
  return personas.find((p) => p.id === style)?.tagline ?? "話し方";
}

// 吹き出しの見本。口調 (Rust側 persona instruction) に合わせる。
const STYLE_SAMPLES: Record<string, string> = {
  mio: "Claudeの作業、\n終わったみたいだよ",
  aoi: "Claudeの作業が\n完了したようです",
  ren: "Claudeの作業、\n終わったってさ",
  shiro: "Claude、作業完了。",
  neko: "Claudeの作業が\n終わりましたにゃん",
  tori: "Claude、作業完了ピヨ。",
  raw: "作業が完了しました。",
};

export function styleSample(style: string): string | null {
  return STYLE_SAMPLES[style] ?? null;
}

/** 旧版の小窓で選んでいた背景を、いまのキャラの画像へ移す (1度だけ) */
const LEGACY_BACKGROUND_KEY = "readapp.companion.background";
const LEGACY_DONE_KEY = "readapp.characters.migrated";

export async function migrateLegacyBackground(state: CharactersState & { migrated_from_legacy?: boolean }): Promise<void> {
  if (!state.migrated_from_legacy) return;
  let choice: string | null;
  try {
    if (localStorage.getItem(LEGACY_DONE_KEY)) return;
    localStorage.setItem(LEGACY_DONE_KEY, "1");
    choice = localStorage.getItem(LEGACY_BACKGROUND_KEY);
    localStorage.removeItem(LEGACY_BACKGROUND_KEY);
  } catch {
    return;
  }
  const active = state.characters.find((c) => c.id === state.active_character);
  if (!active) return;
  // 何も選んでいなければ、旧版の最初の背景 (ねこ)。取り込んだ画像はRust側で移し済み
  const image = choice?.startsWith("preset:") ? choice : choice === null && active.image !== "custom" ? "preset:cat" : null;
  if (!image || image === active.image || !PRESET_IMAGES.some((p) => p.image === image)) return;
  await invoke("update_character", { character: { ...active, image } }).catch(() => {});
}
