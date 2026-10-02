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

  const patchMap = useCallback(
    (key: "enabled" | "mode" | "persona" | "voice", id: string, value: boolean | string) => {
      setState((s) =>
        s ? { ...s, [key]: { ...(s[key] as Record<string, unknown>), [id]: value } } : s,
      );
    },
    [],
  );

  const setEnabled = useCallback(
    async (id: string, v: boolean) => {
      await invoke("set_app_enabled", { appId: id, enabled: v });
      patchMap("enabled", id, v);
    },
    [patchMap],
  );

  const setMode = useCallback(
    async (id: string, v: string) => {
      await invoke("set_app_mode", { appId: id, mode: v });
      patchMap("mode", id, v);
    },
    [patchMap],
  );

  const setPersona = useCallback(
    async (id: string, v: string) => {
      await invoke("set_app_persona", { appId: id, personaId: v });
      patchMap("persona", id, v);
    },
    [patchMap],
  );

  const setVoice = useCallback(
    async (id: string, v: string) => {
      await invoke("set_app_voice", { appId: id, voiceId: v });
      patchMap("voice", id, v);
    },
    [patchMap],
  );

  const setDefaultPersona = useCallback(async (v: string) => {
    await invoke("set_default_persona", { personaId: v });
    setState((s) => (s ? { ...s, default_persona: v } : s));
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
    setDefaultPersona,
    setOnboarded,
    speak,
  };
}

export type SettingsApi = ReturnType<typeof useSettings>;

export function isOn(state: FullState, id: string): boolean {
  return state.enabled[id] ?? true;
}

export function modeOf(state: FullState, id: string): string {
  return state.mode[id] ?? "persona";
}

export function personaOf(state: FullState, id: string): string {
  return state.persona[id] ?? state.default_persona;
}

export function voiceOf(state: FullState, id: string): string {
  return state.voice[id] ?? "system";
}
