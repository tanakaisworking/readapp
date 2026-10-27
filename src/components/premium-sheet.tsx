import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

interface Props {
  voiceName: string | null;
  onClose: () => void;
}

// プレミアムの声を選んだ時だけ、下から小さく案内する。
export function PremiumSheet({ voiceName, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // 閉じるアニメーションの間も名前を残す
  const [shown, setShown] = useState(voiceName);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (voiceName) {
      setShown(voiceName);
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [voiceName]);

  return (
    <dialog ref={dialog} className="modal modal-bottom" aria-labelledby="premium-title" onClose={onClose}>
      {/* 開いた時は本体にフォーカスを置く (閉じるボタンに枠が出て重く見えないように) */}
      <div className="modal-box rounded-t-[22px] bg-base-100 px-5 pb-5 pt-6 outline-none" tabIndex={-1} autoFocus>
        <h3 id="premium-title" className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          {shown}はプレミアムの声です
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          月500円のプランで順次お届けします。今は準備中なので、まずはシステム音声でお試しください。
        </p>
        <form method="dialog" className="mt-5">
          <button className="btn btn-block">とじる</button>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button tabIndex={-1} aria-hidden="true">とじる</button>
      </form>
    </dialog>
  );
}
