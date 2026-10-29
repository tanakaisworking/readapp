import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CLOUD_VOICES, GEMINI_VOICES, VOICES, type Voice } from "@/lib/apps";

export interface SystemVoice { id: string; name: string; lang: string }

/** Macの日本語の声の特徴。同じ文を読ませて声の高さを測って決めた (2026-10-28、Kyoko だけはOSの情報でも女性)。
 * 知らない声は元の名前のまま出す */
const SYSTEM_VOICE_TRAITS: Record<string, string> = {
  Kyoko: "自然な女性の声",
  Otoya: "自然な男性の声",
  Sandy: "高めの女性の声",
  Flo: "女性の声",
  Shelley: "低めの女性の声",
  Eddy: "男性の声",
  Reed: "低めの男性の声",
  Rocko: "とても低い男性の声",
  Grandma: "おばあさんの声",
  Grandpa: "おじいさんの声",
};

/** Macの声を、特徴を名前にした選択肢にする (元の名前は補足へ) */
function systemVoiceOption(v: SystemVoice): Voice {
  const base = v.name.replace(/[（(].*$/, "").trim();
  const premium = /プレミアム|拡張|Premium|Enhanced/.test(v.name);
  const trait = SYSTEM_VOICE_TRAITS[base];
  return {
    id: v.id,
    name: trait ? trait + (premium ? "（高音質）" : "") : v.name,
    tagline: "Macの声 · " + v.name,
    premium: false,
  };
}

/** このMacにある声 */
export function useSystemVoices(): SystemVoice[] {
  const [voices, setVoices] = useState<SystemVoice[]>([]);
  useEffect(() => {
    let disposed = false;
    invoke<SystemVoice[]>("get_system_voices").then((v) => { if (!disposed) setVoices(v); }).catch(() => {});
    return () => { disposed = true; };
  }, []);
  return voices;
}

/** Geminiの声・サーバー経由の声・プレミアムの声か (cloud-voices を外した版では使えない) */
function isCloudVoice(id: string): boolean {
  return id.startsWith("gemini:") || id.startsWith("cloud:") || VOICES.some((v) => v.premium && v.id === id);
}

/** 実際に読む声。Geminiの声などを使えない版では、それを選んでいたキャラもMacの標準の声で読む (Rust側と同じ) */
export function effectiveVoice(id: string, cloudVoices: boolean): string {
  return !cloudVoices && isCloudVoice(id) ? "system" : id;
}

/** キャラに選べる声の一覧。Geminiの声はキーを登録した時か、すでに選んでいる時だけ出す。
 * cloudVoices が false の版では、Geminiの声・サーバー経由の声・プレミアムの声を出さない */
export function voiceOptions(opts: { systemVoices: SystemVoice[]; geminiConfigured: boolean; cloudConfigured: boolean; cloudVoices: boolean; current?: string }): Voice[] {
  const { systemVoices, geminiConfigured, cloudConfigured, cloudVoices, current } = opts;
  if (!cloudVoices) return [...VOICES.filter((v) => !v.premium), ...systemVoices.map(systemVoiceOption)];
  return [
    ...(geminiConfigured || current?.startsWith("gemini:") ? GEMINI_VOICES : []),
    ...VOICES.filter((v) => !v.premium),
    ...systemVoices.map(systemVoiceOption),
    ...(cloudConfigured ? CLOUD_VOICES : VOICES.filter((v) => v.premium)),
  ];
}

/** 声の表示名 (特徴で書いた名前)。見つからなければ fallback */
export function voiceName(id: string, systemVoices: SystemVoice[], fallback = "選択した声"): string {
  return (
    [...GEMINI_VOICES, ...CLOUD_VOICES, ...VOICES].find((v) => v.id === id)?.name
    ?? systemVoices.filter((v) => v.id === id).map((v) => systemVoiceOption(v).name)[0]
    ?? fallback
  );
}
