import { cn } from "@/lib/utils";

// アプリの頭文字を、アプリの色で淡く塗った丸に置く。
export function AppAvatar({ name, color, large = false }: { name: string; color: string; large?: boolean }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-base-content",
        large ? "size-10 text-[15px]" : "size-8 text-[13px]",
      )}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 30%, var(--color-base-100))` }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  );
}
