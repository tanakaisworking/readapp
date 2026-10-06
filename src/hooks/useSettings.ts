import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { KNOWN_APPS, type FullState, type Persona } from "@/lib/apps";

export interface GeminiByokStatus { supported: boolean; configured: boolean }
export interface SpeechIssue {
  voice_id: string;
  kind: "quota" | "authentication" | "billing" | "connection";
  message: string;
}

export function useSettings() {
  const [state, setState] = useState<FullState | null>(null);
  const [platform, setPlatform] = useState("macos");
  const [edition, setEdition] = useState("direct");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [cloudTtsConfigured, setCloudTtsConfigured] = useState(false);
  const [geminiByok, setGeminiByok] = useState<GeminiByokStatus | null>(null);
  const [geminiByokError, setGeminiByokError] = useState<string | null>(null);
  const [speechIssue, setSpeechIssue] = useState<SpeechIssue | null>(null);
  const refreshGeminiByok = useCallback(async () => {
    try {
      setGeminiByok(await invoke<GeminiByokStatus>("gemini_byok_status"));
      setGeminiByokError(null);
    } catch {
      setGeminiByokError("APIキーの登録状態を確認できませんでした。もう一度お試しください。");
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let received = false;
    let unlisten: UnlistenFn | undefined;
    void listen<SpeechIssue | null>("speech-issue-changed", ({ payload }) => {
      if (disposed) return;
      received = true;
      setSpeechIssue(payload);
    }).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => {}).then(async () => {
      const initial = await invoke<SpeechIssue | null>("get_speech_issue");
      if (!disposed && !received) setSpeechIssue(initial);
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let controls: Pick<FullState, "speech_enabled" | "volume"> | null = null;
    // ネイティブメニューからの操作も、開いている設定画面へ反映する。
    void listen<Pick<FullState, "speech_enabled" | "volume">>("speech-controls-changed", ({ payload }) => {
      if (disposed) return;
      controls = payload;
      setState((s) => s ? { ...s, ...payload } : s);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => {}).then(async () => {
      const initial = await invoke<FullState>("get_state");
      if (!disposed) setState(controls ? { ...initial, ...controls } : initial);
    }).catch(() => {});
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
    invoke<string>("get_edition").then(setEdition).catch(() => {});
    invoke<Persona[]>("get_personas").then(setPersonas).catch(() => {});
    invoke<boolean>("cloud_tts_configured").then(setCloudTtsConfigured).catch(() => {});
    void refreshGeminiByok();
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const saveGeminiKey = useCallback(async (key: string) => {
    await invoke("save_gemini_key", { key });
    await refreshGeminiByok();
  }, [refreshGeminiByok]);
  const deleteGeminiKey = useCallback(async () => {
    await invoke("delete_gemini_key");
    await refreshGeminiByok();
  }, [refreshGeminiByok]);

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
  const setSpeechEnabled = useCallback(async (v: boolean) => {
    await invoke("set_speech_enabled", { enabled: v });
    setState((s) => (s ? { ...s, speech_enabled: v } : s));
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
    cloudTtsConfigured,
    geminiByok,
    geminiByokError,
    speechIssue,
    refreshGeminiByok,
    saveGeminiKey,
    deleteGeminiKey,
    setEnabled,
    setSpeakAll,
    setSpeechEnabled,
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
