import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 見た目 (ライト・ダークとテーマカラー)。設定ウィンドウで選び、小窓にもすぐ反映する。
// 色の値は index.css の data-accent にある。

export type ThemeMode = "system" | "light" | "dark";

export interface Appearance {
  mode: ThemeMode;
  accent: string;
}

/** 見本の色。ライト・ダークそれぞれの primary (index.css と同じ値) */
export const ACCENTS = [
  { id: "lavender", name: "ラベンダー", light: "#745de8", dark: "#a08ef2" },
  { id: "sakura", name: "さくら", light: "#c24a72", dark: "#f0a3bd" },
  { id: "sora", name: "そら", light: "#2f72c9", dark: "#8fbcf2" },
  { id: "mint", name: "ミント", light: "#23825f", dark: "#7fd3b0" },
  { id: "mikan", name: "みかん", light: "#b9581a", dark: "#f3b07c" },
  { id: "sumi", name: "すみ", light: "#4a4651", dark: "#d8d4dd" },
] as const;

const KEY = "readapp.appearance";
const EVENT = "appearance-changed";
const DEFAULT: Appearance = { mode: "system", accent: "lavender" };

export function loadAppearance(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Appearance> | null;
    const mode = saved?.mode === "light" || saved?.mode === "dark" ? saved.mode : "system";
    const accent = ACCENTS.some((a) => a.id === saved?.accent) ? (saved?.accent as string) : DEFAULT.accent;
    return { mode, accent };
  } catch {
    return DEFAULT;
  }
}

/** このウィンドウに当てる。システムに合わせる時はOSの外観に任せる */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  if (appearance.mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", appearance.mode === "dark" ? "readapp-dark" : "readapp");
  if (appearance.accent === DEFAULT.accent) root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", appearance.accent);
  // タイトルバーなどウィンドウの枠も合わせる
  getCurrentWindow().setTheme(appearance.mode === "system" ? null : appearance.mode).catch(() => {});
}

/** 保存して、開いている全ウィンドウに反映する */
export function saveAppearance(appearance: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance));
  } catch {
    /* 保存できなくても今は変わる */
  }
  applyAppearance(appearance);
  void emit(EVENT, appearance).catch(() => {});
}

/** 起動時に当て、ほかのウィンドウで変えられたら追従する */
export function startAppearanceSync() {
  applyAppearance(loadAppearance());
  void listen<Appearance>(EVENT, ({ payload }) => applyAppearance(payload)).catch(() => {});
}
