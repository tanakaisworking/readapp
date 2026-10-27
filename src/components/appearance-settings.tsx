import { useEffect, useState } from "react";
import { Check, SlidersVertical } from "lucide-react";
import { ACCENTS, loadAppearance, saveAppearance, type Appearance, type ThemeMode } from "@/lib/appearance";
import { openCompanion } from "@/lib/companion-window";
import { cn } from "@/lib/utils";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "システム" },
  { id: "light", label: "ライト" },
  { id: "dark", label: "ダーク" },
];

// 設定ウィンドウの「小窓と見た目」。テーマは選ぶとすぐ、設定ウィンドウと小窓の両方に反映する。
// 小窓の背景はキャラの画像。吹き出しの範囲は背景を見ながら決められるよう小窓のシートで変える (ここからはそのシートを開く)。
export function AppearanceSettings() {
  const [appearance, setAppearance] = useState(loadAppearance);
  // 見本の丸は、いま実際に使われる色 (ダークなら明るめ) で描く
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const dark = appearance.mode === "dark" || (appearance.mode === "system" && systemDark);
  const update = (next: Partial<Appearance>) => {
    const value = { ...appearance, ...next };
    setAppearance(value);
    saveAppearance(value);
  };
  const accentName = ACCENTS.find((a) => a.id === appearance.accent)?.name;

  return (
    <section aria-labelledby="home-appearance-heading">
      <h2 id="home-appearance-heading" className="section-label">小窓と見た目</h2>
      <div className="surface mt-2">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">小窓の吹き出しの範囲</p>
            <p className="text-xs leading-relaxed text-muted">キャラの顔が隠れないよう、吹き出しを出す高さを変えます。</p>
          </div>
          <button type="button" className="btn btn-sm shrink-0" onClick={() => void openCompanion(true)}>
            <SlidersVertical aria-hidden="true" />
            小窓で調整
          </button>
        </div>
        <div className="space-y-4 border-t border-base-200 p-4">
          <div>
            <p id="appearance-mode-label" className="text-[13px] font-medium">テーマ</p>
            <div role="radiogroup" aria-labelledby="appearance-mode-label" className="tabs tabs-box tabs-sm mt-2 flex-nowrap bg-base-200 p-1">
              {MODES.map((m) => (
                <input
                  key={m.id}
                  type="radio"
                  name="readapp-theme-mode"
                  className="tab flex-1 text-[13px]"
                  aria-label={m.label}
                  checked={appearance.mode === m.id}
                  onChange={() => update({ mode: m.id })}
                />
              ))}
            </div>
            {appearance.mode === "system" && <p className="mt-1.5 px-1 text-xs text-muted">Macのライト・ダークに合わせます。</p>}
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <p id="appearance-accent-label" className="text-[13px] font-medium">テーマカラー</p>
              <span className="text-xs text-muted">{accentName}</span>
            </div>
            <div role="radiogroup" aria-labelledby="appearance-accent-label" className="mt-2.5 flex flex-wrap gap-3 px-0.5">
              {ACCENTS.map((a) => {
                const selected = appearance.accent === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={a.name}
                    title={a.name}
                    onClick={() => update({ accent: a.id })}
                    style={{ backgroundColor: dark ? a.dark : a.light }}
                    className={cn(
                      "grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-base-100 transition-transform duration-150 hover:scale-110 active:scale-95",
                      selected ? "ring-2 ring-base-content/45" : "",
                    )}
                  >
                    <Check className={cn("size-4 transition-opacity", dark ? "text-[#222027]" : "text-white", selected ? "opacity-100" : "opacity-0")} strokeWidth={3} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
