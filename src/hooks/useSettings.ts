import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FullState, Persona } from "@/lib/apps";

export function useSettings() {
  const [state, setState] = useState<FullState | null>(null);
  const [platform, setPlatform] = useState("macos");
  const [personas, setPersonas] = useState<Persona[]>([]);

  useEffect(() => {
    invoke<FullState>("get_state").then(setState).catch(() => {});
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
    invoke<Persona[]>("get_personas").then(setPersonas).catch(() => {});
  }, []);

  const setEnabled = useCallback(async (id: string, v: boolean) => {
    await invoke("set_app_enabled", { appId: id, enabled: v });
    setState((s) => (s ? { ...s, enabled: { ...s.enabled, [id]: v } } : s));
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
    personas,
    setEnabled,
    setMode,
    setPersona,
    setVoice,
    setOnboarded,
    speak,
  };
}

export type SettingsApi = ReturnType<typeof useSettings>;

export function isOn(state: FullState, id: string): boolean {
  return state.enabled[id] ?? true;
}
