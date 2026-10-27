import { motion, useReducedMotion } from "motion/react";
import { characterSrc, type Character } from "@/lib/characters";
import { cn } from "@/lib/utils";

interface Props {
  character: Character | undefined;
  customs: Record<string, string | null | undefined>;
  className?: string;
  /** 話している間、ゆっくり呼吸する */
  speaking?: boolean;
}

// キャラの画像 (同梱か取り込んだ画像)。取り込んだ画像を読み込んでいる間は下地だけ見せる。
export function CharacterImage({ character, customs, className, speaking = false }: Props) {
  const reduce = useReducedMotion();
  const src = characterSrc(character, customs);
  const breathe = speaking && !reduce;
  return (
    <motion.span
      className={cn("block shrink-0 overflow-hidden bg-base-300", className)}
      animate={breathe ? { scale: [1, 1.05, 1] } : { scale: 1 }}
      transition={breathe ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.15 }}
    >
      {src && <img src={src} alt="" draggable={false} className="size-full object-cover" />}
    </motion.span>
  );
}
