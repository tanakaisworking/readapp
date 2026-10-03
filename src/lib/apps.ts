import catalog from "./catalog.json";

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

export interface Persona {
  id: string;
  name: string;
  tagline: string;
  instruction: string;
}

export interface FullState {
  enabled: Record<string, boolean>;
  mode: string;
  persona: string;
  voice: string;
  onboarded: boolean;
}

export const PERSONA_ACCENTS: Record<string, string> = {
  mio: "#F2A7C3",
  aoi: "#8FC1F0",
  ren: "#F0A35C",
  shiro: "#B9A8F0",
};

export function personaAccent(id: string): string {
  return PERSONA_ACCENTS[id] ?? "#B9A8F0";
}

export function knownApp(id: string): KnownApp {
  return (
    KNOWN_APPS.find((a) => a.id === id) ?? { id, name: id, color: "#B9B3AA" }
  );
}
