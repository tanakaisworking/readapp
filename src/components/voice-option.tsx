import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  note?: string;
  selected: boolean;
  premium?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

// 声の選択肢1行 (キャラの編集で使う)。
export function VoiceOption({ name, note, selected, premium = false, disabled = false, onSelect }: Props) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-field px-3 py-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
          selected ? "bg-primary/10" : "hover:bg-base-200",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{name}</span>
            {premium && (
              <span className="badge badge-soft badge-primary badge-xs gap-0.5 px-1.5">
                <Sparkles className="size-2.5" aria-hidden="true" />
                プレミアム
              </span>
            )}
          </span>
          {note && <span className="block truncate text-xs text-muted">{note}</span>}
        </span>
        <Check className={cn("size-4 shrink-0 text-primary transition-opacity", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
      </button>
    </li>
  );
}
