import { Check, Plus } from "lucide-react";
import { CharacterImage } from "@/components/character-image";
import type { Character } from "@/lib/characters";
import { cn } from "@/lib/utils";

interface Props {
  characters: Character[];
  customs: Record<string, string | null | undefined>;
  onPick: (id: string) => void;
  /** 選んでいる1人 (枠と印を付ける) */
  selected?: string;
  /** キャラの画像の上に出す短い印 (例: 全体のキャラに「全体」) */
  badge?: (c: Character) => string | null;
  /** 押した時に何が起きるかの読み上げ用の言い方 */
  pickLabel?: (c: Character) => string;
  /** 渡すと、最後に「キャラを作る」を出す */
  onCreate?: () => void;
}

// キャラの画像の一覧。設定では作ったキャラ (押すと編集)、オンボーディングではひな形 (押すと選ぶ) に使う。
export function CharacterList({ characters, customs, onPick, selected, badge, pickLabel, onCreate }: Props) {
  return (
    <ul className="grid grid-cols-4 gap-2">
      {characters.map((c) => {
        const isSelected = c.id === selected;
        const mark = badge?.(c);
        return (
          <li key={c.id}>
            <button
              type="button"
              aria-pressed={selected === undefined ? undefined : isSelected}
              aria-label={pickLabel?.(c) ?? c.name}
              onClick={() => onPick(c.id)}
              className="group/tile block w-full text-left"
            >
              <span
                className={cn(
                  "relative block overflow-hidden rounded-box ring-offset-2 ring-offset-base-100 transition-all duration-150",
                  isSelected ? "ring-2 ring-primary" : "group-hover/tile:ring-2 group-hover/tile:ring-base-content/20",
                )}
              >
                <CharacterImage character={c} customs={customs} className="aspect-[3/4] w-full transition-transform duration-200 group-hover/tile:scale-[1.03]" />
                {isSelected && (
                  <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-content shadow-sm" aria-hidden="true">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
                {mark && (
                  <span className="badge badge-primary badge-xs absolute bottom-1 left-1 shadow-sm">{mark}</span>
                )}
              </span>
              <span className={cn("mt-1.5 line-clamp-2 text-center text-[11px] leading-snug", isSelected ? "font-semibold" : "font-medium text-muted")}>{c.name}</span>
            </button>
          </li>
        );
      })}
      {onCreate && (
        <li>
          <button
            type="button"
            onClick={onCreate}
            className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1.5 rounded-box border border-dashed border-base-content/25 text-muted transition-colors hover:border-primary hover:text-primary"
          >
            <Plus className="size-5" aria-hidden="true" />
            <span className="text-[11px] font-medium leading-tight">キャラを<br />作る</span>
          </button>
        </li>
      )}
    </ul>
  );
}
