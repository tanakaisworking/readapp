import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface Props {
  /** キャラの色 */
  accent: string;
  size?: number;
  /** 話している間、ゆっくり呼吸する */
  speaking?: boolean;
  /** 「そのまま読む」時は顔を出さない */
  raw?: boolean;
  /** アプリアイコンと同じ、右上の通知の点 */
  dot?: boolean;
  className?: string;
}

// アプリアイコンと同じ「顔のある吹き出し」。キャラごとの色で塗る。
export function PersonaAvatar({ accent, size = 40, speaking = false, raw = false, dot = false, className }: Props) {
  const reduce = useReducedMotion();
  const breathe = speaking && !reduce;
  const fill = raw ? "var(--color-base-300)" : accent;
  return (
    <motion.svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
      animate={breathe ? { scale: [1, 1.07, 1] } : { scale: 1 }}
      transition={breathe ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.15 }}
    >
      <g style={{ fill, stroke: fill }}>
        <rect x="2.5" y="4.5" width="27" height="20" rx="10" strokeWidth="0" />
        <path d="M8 21 L5.6 28.6 L15 23.4 Z" strokeWidth="1.6" strokeLinejoin="round" />
      </g>
      {raw ? (
        <g className="fill-base-content/55">
          <circle cx="10.5" cy="14.5" r="1.6" />
          <circle cx="16" cy="14.5" r="1.6" />
          <circle cx="21.5" cy="14.5" r="1.6" />
        </g>
      ) : (
        <g fill="#29272d">
          <ellipse cx="12.2" cy="13.2" rx="1.3" ry="1.75" />
          <ellipse cx="19.8" cy="13.2" rx="1.3" ry="1.75" />
          <path d="M13.4 17 Q16 19.4 18.6 17" fill="none" stroke="#29272d" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      )}
      {dot && <circle cx="27" cy="5.5" r="3.4" className="fill-accent stroke-base-100" strokeWidth="1.6" />}
    </motion.svg>
  );
}
