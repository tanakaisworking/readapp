import catalog from "./catalog.json";
import type { Character } from "./characters";

export interface KnownApp {
  id: string;
  name: string;
  color: string;
}

// アプリカタログの正本は catalog.json (生成スクリプトと共有)。
export const KNOWN_APPS: KnownApp[] = catalog.apps;

export interface Voice {
  id: string;
  name: string;
  tagline: string;
  premium: boolean;
}

export const VOICES: Voice[] = [
  { id: "system", name: "システム音声", tagline: "いつもの声", premium: false },
  { id: "clear", name: "クリア", tagline: "抜けのいい声", premium: true },
  { id: "warm", name: "ウォーム", tagline: "寄り添う声", premium: true },
];

export const CLOUD_VOICES: Voice[] = [
  { id: "cloud:Kore", name: "Kore", tagline: "落ち着いた声 · Gemini", premium: false },
  { id: "cloud:Aoede", name: "Aoede", tagline: "軽やかな声 · Gemini", premium: false },
  { id: "cloud:Puck", name: "Puck", tagline: "明るい声 · Gemini", premium: false },
  { id: "cloud:Charon", name: "Charon", tagline: "語りかける声 · Gemini", premium: false },
];

export const GEMINI_VOICES: Voice[] = CLOUD_VOICES.map((voice) => ({
  ...voice, id: voice.id.replace("cloud:", "gemini:"), tagline: voice.tagline.replace("Gemini", "自分のAPIキー"),
}));

export interface Persona {
  id: string;
  name: string;
  tagline: string;
  instruction: string;
}

export interface FullState {
  enabled: Record<string, boolean>;
  speak_all: boolean;
  /** 全体の読み上げ。OFFで再生中・待機中の音声も停止 */
  speech_enabled: boolean;
  names: Record<string, string>;
  /** いまのキャラの話し方・口調・声 (表示用。変えるのはキャラ側) */
  mode: string;
  persona: string;
  voice: string;
  characters: Character[];
  active_character: string;
  /** 旧設定から引き継いだ直後 */
  migrated_from_legacy: boolean;
  /** アプリごとの担当キャラ (app_id → キャラID)。無いアプリは、いま話すキャラが読む */
  app_characters: Record<string, string>;
  /** 読み上げの音量 (0〜100 %) */
  volume: number;
  onboarded: boolean;
  /** Dockにアイコンを出す (macOS。既定は出さない) */
  show_in_dock: boolean;
}

export function knownApp(id: string): KnownApp {
  return (
    KNOWN_APPS.find((a) => a.id === id) ?? { id, name: id, color: "#B9B3AA" }
  );
}
