import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { KNOWN_APPS, type FullState, type Persona } from "@/lib/apps";
import { migrateLegacyBackground, type Character, type CharactersState } from "@/lib/characters";

export interface GeminiByokStatus { supported: boolean; configured: boolean }
export interface SpeechIssue {
  voice_id: string;
  kind: "quota" | "authentication" | "billing" | "connection";
  message: string;
}

/** 自分のGeminiプロジェクトの月の利用額の上限 (Rust側 gemini::SPEND_CAP と同じ文) */
export const SPEND_CAP_MESSAGE = "自分のGeminiプロジェクトが月の利用額の上限に達しました。AI Studioで上限を確認してください";

/** 状態の短い表示 (バッジ用) */
export function issueBadge(issue: SpeechIssue): string {
  if (issue.message === SPEND_CAP_MESSAGE) return "利用額の上限";
  return { quota: "使用上限", billing: "課金を確認", authentication: "キーを確認", connection: "接続を確認" }[issue.kind];
}

/** キャラの一覧が変わった時に、いまのキャラから決まる表示用の値も合わせる */
function withCharacters(s: FullState, next: CharactersState): FullState {
  const active = next.characters.find((c) => c.id === next.active_character) ?? next.characters[0];
  if (!active) return s;
  return {
    ...s,
    characters: next.characters,
    active_character: active.id,
    voice: active.voice,
    persona: active.style,
    mode: active.style === "raw" ? "raw" : "persona",
  };
}

export function useSettings() {
  const [state, setState] = useState<FullState | null>(null);
  const [platform, setPlatform] = useState("macos");
  const [edition, setEdition] = useState("direct");
  const [personas, setPersonas] = useState<Persona[]>([]);
  /** キャラのひな形 (キャラを作る画面・オンボーディングで選ぶ) */
  const [presets, setPresets] = useState<Character[]>([]);
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
      void migrateLegacyBackground(initial);
    }).catch(() => {});
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
    invoke<string>("get_edition").then(setEdition).catch(() => {});
    invoke<Persona[]>("get_personas").then(setPersonas).catch(() => {});
    invoke<Character[]>("get_character_presets").then(setPresets).catch(() => {});
    invoke<boolean>("cloud_tts_configured").then(setCloudTtsConfigured).catch(() => {});
    void refreshGeminiByok();
    return () => { disposed = true; unlisten?.(); };
  }, []);

  // 小窓などほかの窓でキャラを選んだ・直した時も反映する
  useEffect(() => {
    let disposed = false;
    let off: UnlistenFn | undefined;
    listen<CharactersState>("characters-changed", ({ payload }) => {
      if (!disposed) setState((s) => (s ? withCharacters(s, payload) : s));
    }).then((f) => (disposed ? f() : (off = f))).catch(() => {});
    return () => { disposed = true; off?.(); };
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
  /** いま話すキャラを選ぶ */
  const setActiveCharacter = useCallback(async (id: string) => {
    setState((s) => (s ? withCharacters(s, { characters: s.characters, active_character: id }) : s));
    await invoke("set_active_character", { id });
  }, []);

  /** 新しいキャラを作る (まだ選ばない)。preset を渡すとそのひな形から、無ければ一から */
  const createCharacter = useCallback(async (preset?: string): Promise<Character> => {
    const created = await invoke<Character>("create_character", { preset: preset ?? null });
    setState((s) => (s && !s.characters.some((c) => c.id === created.id)
      ? withCharacters(s, { characters: [...s.characters, created], active_character: s.active_character })
      : s));
    return created;
  }, []);

  /** キャラを直す。先に表示を変え、保存できなければ元に戻す */
  const updateCharacter = useCallback(async (next: Character) => {
    let before: Character[] | null = null;
    setState((s) => {
      if (!s) return s;
      before = s.characters;
      return withCharacters(s, { characters: s.characters.map((c) => (c.id === next.id ? next : c)), active_character: s.active_character });
    });
    try {
      const saved = await invoke<Character>("update_character", { character: next });
      setState((s) => (s ? withCharacters(s, { characters: s.characters.map((c) => (c.id === saved.id ? saved : c)), active_character: s.active_character }) : s));
    } catch (e) {
      const restore = before;
      if (restore) setState((s) => (s ? withCharacters(s, { characters: restore, active_character: s.active_character }) : s));
      throw e;
    }
  }, []);

  /** オンボーディングで、最初のキャラをひな形から選ぶ */
  const startWithPreset = useCallback(async (preset: string) => {
    await invoke("start_with_preset", { preset });
    const next = await invoke<FullState>("get_state");
    setState((s) => (s ? withCharacters(s, next) : s));
  }, []);

  const deleteCharacter = useCallback(async (id: string) => {
    await invoke("delete_character", { id });
    const next = await invoke<FullState>("get_state");
    setState((s) => (s ? { ...withCharacters(s, next), app_characters: next.app_characters } : s));
  }, []);

  /** 画像を取り込んで、そのキャラの画像にする */
  const setCharacterImage = useCallback(async (id: string, path: string): Promise<string> => {
    const url = await invoke<string>("set_character_image", { id, path });
    setState((s) => (s ? withCharacters(s, { characters: s.characters.map((c) => (c.id === id ? { ...c, image: "custom" } : c)), active_character: s.active_character }) : s));
    return url;
  }, []);

  /** アプリの担当キャラ。null で解除 (いま話すキャラが読む) */
  const setAppCharacter = useCallback(async (appId: string, characterId: string | null) => {
    await invoke("set_app_character", { appId, characterId });
    setState((s) => {
      if (!s) return s;
      const app_characters = { ...s.app_characters };
      if (characterId) app_characters[appId] = characterId;
      else delete app_characters[appId];
      return { ...s, app_characters };
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

  const setShowInDock = useCallback(async (show: boolean) => {
    setState((s) => (s ? { ...s, show_in_dock: show } : s));
    await invoke("set_show_in_dock", { show });
  }, []);

  const speak = useCallback(
    async (appId: string, title: string, body: string, characterId?: string, preset?: string, verbatim = false): Promise<string> => {
      return invoke<string>("test_speak", { appId, title, body, characterId: characterId ?? null, preset: preset ?? null, verbatim });
    },
    [],
  );

  return {
    state,
    platform,
    edition,
    personas,
    presets,
    cloudTtsConfigured,
    // Geminiの声・サーバー経由の声を使える版か (Rust の Cargo feature cloud-voices。外した版では両方 false)
    cloudVoices: geminiByok?.supported === true || cloudTtsConfigured,
    geminiByok,
    geminiByokError,
    speechIssue,
    refreshGeminiByok,
    saveGeminiKey,
    deleteGeminiKey,
    setEnabled,
    setSpeakAll,
    setSpeechEnabled,
    setActiveCharacter,
    createCharacter,
    startWithPreset,
    updateCharacter,
    deleteCharacter,
    setCharacterImage,
    setAppCharacter,
    setVolume,
    setOnboarded,
    setShowInDock,
    speak,
  };
}

export type SettingsApi = ReturnType<typeof useSettings>;

// 未設定はカタログのアプリだけON (Rust側 should_speak と同じ規則)。
export function isOn(state: FullState, id: string): boolean {
  return state.enabled[id] ?? KNOWN_APPS.some((a) => a.id === id);
}
