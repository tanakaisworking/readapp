import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

// 取り出したアイコン (アプリIDごとに1度だけ聞く。入っていないアプリは null)
const icons = new Map<string, Promise<string | null>>();

function loadIcon(id: string): Promise<string | null> {
  let icon = icons.get(id);
  if (!icon) {
    icon = invoke<string | null>("app_icon", { appId: id }).catch(() => null);
    icons.set(id, icon);
  }
  return icon;
}

/** このMacに入っているアプリのアイコン (読み込み中・見つからない時は null) */
export function useAppIcon(id: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let disposed = false;
    setSrc(null);
    void loadIcon(id).then((url) => { if (!disposed) setSrc(url); });
    return () => { disposed = true; };
  }, [id]);
  return src;
}

// アプリのアイコン。入っていて取り出せればアプリの本物のアイコン、無ければ頭文字をアプリの色で淡く塗った丸。
export function AppAvatar({ id, name, color, large = false }: { id?: string; name: string; color: string; large?: boolean }) {
  const icon = useAppIcon(id);
  const size = large ? "size-10" : "size-8";
  if (icon) {
    return <img src={icon} alt="" aria-hidden="true" draggable={false} className={cn("shrink-0 select-none object-contain", size)} />;
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-base-content",
        size,
        large ? "text-[15px]" : "text-[13px]",
      )}
      style={{ backgroundColor: "color-mix(in oklab, " + color + " 30%, var(--color-base-100))" }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  );
}
