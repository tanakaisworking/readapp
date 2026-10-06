import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KNOWN_APPS, type FullState, type Persona } from "@/lib/apps";

export function useSettings() {
  const [state, setState] = useState<FullState | null>(null);
  const [platform, setPlatform] = useState("macos");
  const [edition, setEdition] = useState("direct");
  const [personas, setPersonas] = useState<Persona[]>([]);

  useEffect(() => {
    invoke<FullState>("get_state").then(setState).catch(() => {});
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
    invoke<string>("get_edition").then(setEdition).catch(() => {});
    invoke<Persona[]>("get_personas").then(setPersonas).catch(() => {});
  }, []);

  const setEnabled = useCallback(async (id: string, v: boolean, displayName?: string) => {
    await invoke("set_app_enabled", { appId: id, enabled: v, displayName: displayName ?? null });
    setState((s) =>
      s
        ? {
            ...s,
            enabled: { ...s.enabled, [id]: v },
            names: displayName ? { ...s.names, [id]: displayName } : s.names,
          }
        : s,
    );
  }, []);

  const setSpeakAll = useCallback(async (v: boolean) => {
    await invoke("set_speak_all", { enabled: v });
    setState((s) => (s ? { ...s, speak_all: v } : s));
  }, []);
  const setMode = useCallback(async (v: string) => {
    await invoke("set_mode", { mode: v });
    setState((s) => (s ? { ...s, mode: v } : s));
  }, []);

  const setPersona = useCallback(async (v: string) => {
    await invoke("set_persona", { personaId: v });
    setState((s) => (s ? { ...s, persona: v } : s));
  }, []);

  const setVoice = useCallback(async (v: string) => {
    await invoke("set_voice", { voiceId: v });
    setState((s) => (s ? { ...s, voice: v } : s));
  }, []);

  /** アプリごとの声。null で解除 (いつもの声に戻す) */
  const setAppVoice = useCallback(async (appId: string, voiceId: string | null) => {
    await invoke("set_app_voice", { appId, voiceId });
    setState((s) => {
      if (!s) return s;
      const app_voices = { ...s.app_voices };
      if (voiceId) app_voices[appId] = voiceId;
      else delete app_voices[appId];
      return { ...s, app_voices };
    });
  }, []);

  // 先に表示を変えてから保存する。保存の応答を待って変えると、続けて動かした時に古い応答で値が巻き戻る
  const setVolume = useCallback(async (v: number) => {
    setState((s) => (s ? { ...s, volume: v } : s));
    await invoke("set_volume", { volume: v });
  }, []);

  const setOnboarded = useCallback(async (done: boolean) => {
    await invoke("set_onboarded", { done });
    setState((s) => (s ? { ...s, onboarded: done } : s));
  }, []);

  const speak = useCallback(
    async (appId: string, title: string, body: string): Promise<string> => {
      return invoke<string>("test_speak", { appId, title, body });
    },
    [],
  );

  return {
    state,
    platform,
    edition,
    personas,
    setEnabled,
    setSpeakAll,
    setMode,
    setPersona,
    setVoice,
    setAppVoice,
    setVolume,
    setOnboarded,
    speak,
  };
}

export type SettingsApi = ReturnType<typeof useSettings>;

// 未設定はカタログのアプリだけON (Rust側 should_speak と同じ規則)。
export function isOn(state: FullState, id: string): boolean {
  return state.enabled[id] ?? KNOWN_APPS.some((a) => a.id === id);
}
