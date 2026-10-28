import { useState } from "react";
import { ChevronLeft, PenLine } from "lucide-react";
import { CharacterImage } from "@/components/character-image";
import type { SettingsApi } from "@/hooks/useSettings";
import type { Persona } from "@/lib/apps";
import { styleLabel, styleSample } from "@/lib/characters";

interface Props {
  api: SettingsApi;
  personas: Persona[];
  onBack: () => void;
  /** 作ったら、そのキャラの編集を開く */
  onCreated: (id: string) => void;
}

// キャラを作る。ひな形から選ぶか、一から作る。作ったあと名前・画像・話し方・声を変えられる。
export function CharacterCreate({ api, personas, onBack, onCreated }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (preset?: string) => {
    setBusy(preset ?? "blank");
    setError(null);
    try {
      const c = await api.createCharacter(preset);
      onCreated(c.id);
    } catch (e) {
      setError(e === "too_many" ? "これ以上キャラを作れません。使わないキャラを削除してください。" : "キャラを作れませんでした。もう一度お試しください。");
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 px-4 pb-6 pt-3">
      <header className="flex items-center gap-1.5">
        <button type="button" onClick={onBack} aria-label="もどる" className="btn btn-ghost btn-sm btn-circle -ms-1">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <h1 className="truncate text-base font-semibold">キャラを作る</h1>
      </header>

      <section aria-labelledby="create-presets-heading">
        <h2 id="create-presets-heading" className="section-label">ひな形から作る</h2>
        <p className="mt-1 px-1 text-xs leading-relaxed text-muted">画像と話し方が決まった状態で作ります。名前や声はあとで変えられます。</p>
        <ul className="surface mt-2 space-y-0.5 p-1.5">
          {api.presets.map((p) => {
            const sample = styleSample(p.style);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void create(p.id)}
                  disabled={busy !== null}
                  className="flex w-full items-center gap-3 rounded-field px-2.5 py-2 text-left transition-colors duration-150 hover:bg-base-200 disabled:opacity-60"
                >
                  <CharacterImage character={p} customs={{}} className="aspect-[3/4] w-12 rounded-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{styleLabel(p.style, personas)}</span>
                    {sample && <span className="block truncate text-xs text-muted">「{sample.replace(/\n/g, "")}」</span>}
                  </span>
                  {busy === p.id && <span className="loading loading-dots loading-xs" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="一から作る">
        <button type="button" className="btn btn-block" onClick={() => void create()} disabled={busy !== null}>
          {busy === "blank" ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <PenLine aria-hidden="true" />}
          一から作る
        </button>
        {error && <p className="mt-2 px-1 text-xs text-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
