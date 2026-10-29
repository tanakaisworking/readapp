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
  /** 選ぶ時に見せる名前。声の特徴で書く (固有の名前はユーザーには手がかりにならない) */
  name: string;
  /** 補足 (どこの声か・元の名前) */
  tagline: string;
  premium: boolean;
}

export const VOICES: Voice[] = [
  { id: "system", name: "Macの標準の声", tagline: "システム音声 · いつもの声", premium: false },
  { id: "clear", name: "抜けのいい声", tagline: "クリア", premium: true },
  { id: "warm", name: "寄り添う声", tagline: "ウォーム", premium: true },
];

// Geminiの声。特徴はGoogleの声の説明 (Kore=Firm, Aoede=Breezy, Puck=Upbeat, Charon=Informative) に合わせる
export const CLOUD_VOICES: Voice[] = [
  { id: "cloud:Kore", name: "しっかり落ち着いた声", tagline: "Gemini · Kore · 試用接続", premium: false },
  { id: "cloud:Aoede", name: "軽やかな声", tagline: "Gemini · Aoede · 試用接続", premium: false },
  { id: "cloud:Puck", name: "明るく弾む声", tagline: "Gemini · Puck · 試用接続", premium: false },
  { id: "cloud:Charon", name: "語りかける声", tagline: "Gemini · Charon · 試用接続", premium: false },
];

export const GEMINI_VOICES: Voice[] = CLOUD_VOICES.map((voice) => ({
  ...voice, id: voice.id.replace("cloud:", "gemini:"), tagline: voice.tagline.replace("試用接続", "自分のAPIキー"),
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
