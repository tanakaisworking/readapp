import { useEffect, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";

// 読み上げの音量。動かしている間は表示だけ変え、離した時に保存して試し読みする
// (動かすたびに読み上げると声が重なって続くため)。
// 100% 未満は書き出してから再生するので、読み始めが1〜2秒遅れる。

interface Props {
  value: number;
  onCommit: (v: number) => void | Promise<void>;
}

export function VolumeSlider({ value, onCommit }: Props) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) void onCommit(draft);
  };
  const Icon = draft === 0 ? VolumeX : draft < 50 ? Volume1 : Volume2;

  return (
    <div className="mt-3 rounded-lg bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(41,39,45,0.06)]">
      <div className="flex items-center justify-between">
        <label htmlFor="readapp-volume" className="text-sm font-medium">
          音量
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">{draft === 0 ? "消音" : `${draft}%`}</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id="readapp-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          value={draft}
          aria-valuetext={draft === 0 ? "消音" : `${draft}パーセント`}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="h-1.5 w-full cursor-pointer accent-primary"
        />
      </div>
      {draft > 0 && draft < 100 && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          100%より小さくすると、読み始めが1〜2秒ほど遅れます。
        </p>
      )}
    </div>
  );
}
