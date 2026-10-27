import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CLOUD_VOICES, GEMINI_VOICES, VOICES, type Voice } from "@/lib/apps";

export interface SystemVoice { id: string; name: string; lang: string }

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

/** キャラに選べる声の一覧。Geminiの声はキーを登録した時か、すでに選んでいる時だけ出す */
export function voiceOptions(opts: { systemVoices: SystemVoice[]; geminiConfigured: boolean; cloudConfigured: boolean; current?: string }): Voice[] {
  const { systemVoices, geminiConfigured, cloudConfigured, current } = opts;
  return [
    ...(geminiConfigured || current?.startsWith("gemini:") ? GEMINI_VOICES : []),
    ...VOICES.filter((v) => !v.premium),
    ...systemVoices.map((v) => ({ ...v, tagline: v.lang, premium: false })),
    ...(cloudConfigured ? CLOUD_VOICES.map((v) => ({ ...v, name: v.name + " · 試用接続" })) : VOICES.filter((v) => v.premium)),
  ];
}

/** 声の表示名。見つからなければ fallback */
export function voiceName(id: string, systemVoices: SystemVoice[], fallback = "選択した声"): string {
  if (id === "system") return "システム音声";
  return (
    [...GEMINI_VOICES, ...CLOUD_VOICES, ...VOICES].find((v) => v.id === id)?.name
    ?? systemVoices.find((v) => v.id === id)?.name
    ?? fallback
  );
}
