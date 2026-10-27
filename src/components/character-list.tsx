import { Check, Pencil, Plus } from "lucide-react";
import { CharacterImage } from "@/components/character-image";
import type { Character } from "@/lib/characters";
import { cn } from "@/lib/utils";

interface Props {
  characters: Character[];
  active: string;
  customs: Record<string, string | null | undefined>;
  onSelect: (id: string) => void;
  /** 渡すと、各キャラに編集のボタンを出す */
  onEdit?: (id: string) => void;
  /** 渡すと、最後に「キャラを作る」を出す */
  onCreate?: () => void;
  creating?: boolean;
}

// 作ったキャラの一覧。押すと「いま話すキャラ」になる。
export function CharacterList({ characters, active, customs, onSelect, onEdit, onCreate, creating = false }: Props) {
  return (
    <ul className="grid grid-cols-4 gap-2">
      {characters.map((c) => {
        const selected = c.id === active;
        return (
          <li key={c.id} className="relative">
            <button
              type="button"
              aria-pressed={selected}
              aria-label={c.name + (selected ? "（いま話すキャラ）" : "で話す")}
              onClick={() => onSelect(c.id)}
              className="group/tile block w-full text-left"
            >
              <span
                className={cn(
                  "relative block overflow-hidden rounded-box ring-offset-2 ring-offset-base-100 transition-all duration-150",
                  selected ? "ring-2 ring-primary" : "group-hover/tile:ring-2 group-hover/tile:ring-base-content/20",
                )}
              >
                <CharacterImage character={c} customs={customs} className="aspect-[3/4] w-full transition-transform duration-200 group-hover/tile:scale-[1.03]" />
                {selected && (
                  <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-content shadow-sm" aria-hidden="true">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className={cn("mt-1.5 line-clamp-2 text-center text-[11px] leading-snug", selected ? "font-semibold" : "font-medium text-muted")}>{c.name}</span>
            </button>
            {onEdit && (
              <button
                type="button"
                aria-label={c.name + "を編集"}
                title={c.name + "を編集"}
                onClick={() => onEdit(c.id)}
                className="btn btn-circle btn-xs absolute right-1 top-1 border-0 bg-base-100/90 shadow-sm backdrop-blur-sm hover:bg-base-100"
              >
                <Pencil className="size-3" aria-hidden="true" />
              </button>
            )}
          </li>
        );
      })}
      {onCreate && (
        <li>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 rounded-box border border-dashed border-base-content/25 text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {creating ? <span className="loading loading-dots loading-xs" aria-hidden="true" /> : <Plus className="size-5" aria-hidden="true" />}
            <span className="text-[11px] font-medium leading-tight">キャラを<br />作る</span>
          </button>
        </li>
      )}
    </ul>
  );
}
