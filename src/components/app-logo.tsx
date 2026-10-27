import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface Props {
  size?: number;
  /** 話している間、ゆっくり呼吸する */
  speaking?: boolean;
  className?: string;
}

// アプリアイコンと同じロゴ画像 (public/logo.png)。
export function AppLogo({ size = 40, speaking = false, className }: Props) {
  const reduce = useReducedMotion();
  const breathe = speaking && !reduce;
  return (
    <motion.img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      className={cn("shrink-0 select-none drop-shadow-sm", className)}
      animate={breathe ? { scale: [1, 1.07, 1] } : { scale: 1 }}
      transition={breathe ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.15 }}
    />
  );
}
