import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";

/** 小窓が開いた時に背景のシートも開くための印 (小窓を作り直した場合は、読み込み時にこれを見る) */
export const OPEN_PICKER_KEY = "readapp.companionOpenPicker";
export const OPEN_PICKER_EVENT = "companion-open-picker";

/** 設定ウィンドウから小窓を開く。picker なら背景と表示範囲のシートも開く */
export async function openCompanion(picker = false): Promise<void> {
  if (picker) {
    try { localStorage.setItem(OPEN_PICKER_KEY, "1"); } catch { /* 印が残せなくても小窓は開く */ }
  }
  await invoke("show_companion").catch(() => {});
  if (picker) await emitTo("companion", OPEN_PICKER_EVENT).catch(() => {});
}

/** 小窓から設定ウィンドウのキャラの編集を開くための印と知らせ */
export const OPEN_CHARACTER_KEY = "readapp.settingsOpenCharacter";
export const OPEN_CHARACTER_EVENT = "settings-open-character";

/** 小窓から、設定ウィンドウでキャラの編集を開く */
export async function openCharacterEditor(id: string): Promise<void> {
  try { localStorage.setItem(OPEN_CHARACTER_KEY, id); } catch { /* 印が残せなくても設定は開く */ }
  await invoke("show_settings").catch(() => {});
  await emitTo("main", OPEN_CHARACTER_EVENT, id).catch(() => {});
}
