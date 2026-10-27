import { useEffect, useRef, useState } from "react";
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
  // 最後に保存へ回した値。保存の応答が操作中の値を巻き戻したり、同じ値を二重に保存したりしないよう、これと比べる
  const committed = useRef(value);
  useEffect(() => {
    if (value === committed.current) return; // 自分の保存の応答 (その間に動かしていても巻き戻さない)
    committed.current = value;
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft === committed.current) return;
    committed.current = draft;
    void onCommit(draft);
  };
  const Icon = draft === 0 ? VolumeX : draft < 50 ? Volume1 : Volume2;

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="readapp-volume" className="text-[13px] font-medium">
          音量
        </label>
        <span className="text-xs tabular-nums text-muted">{draft === 0 ? "消音" : `${draft}%`}</span>
      </div>
      <div className="mt-2 flex items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          id="readapp-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          value={draft}
          aria-valuetext={draft === 0 ? "消音" : `${draft}パーセント`}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft(v);
            // 消音だけはドラッグを離すのを待たず、その場で止める。
            if (v === 0 && committed.current !== 0) {
              committed.current = 0;
              void onCommit(0);
            }
          }}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="range range-primary range-xs w-full"
        />
      </div>
      {draft > 0 && draft < 100 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">100%より小さくすると、読み始めが1〜2秒ほど遅れます。</p>
      )}
    </div>
  );
}
