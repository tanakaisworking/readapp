import { AnimatePresence, motion } from "motion/react";
import { Sparkles } from "lucide-react";

interface Props {
  voiceName: string | null;
  onClose: () => void;
}

export function PremiumSheet({ voiceName, onClose }: Props) {
  return (
    <AnimatePresence>
      {voiceName && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-foreground/20"
          />
          <motion.div
            initial={{ y: 48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            role="dialog"
            aria-label="プレミアムの案内"
            className="fixed inset-x-3 bottom-3 z-50 rounded-xl bg-card p-5 shadow-[0_8px_30px_rgba(41,39,45,0.14)]"
          >
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              {voiceName}はプレミアムの声です
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              月500円のプランで順次お届けします。今は準備中なので、まずはシステム音声でお試しください。
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-9 w-full rounded-md bg-surface-muted text-sm font-medium outline-none transition-colors hover:brightness-97 focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              とじる
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
