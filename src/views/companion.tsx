import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, ImagePlus, Pin, Settings2, X } from "lucide-react";
import { knownApp } from "@/lib/apps";
import { cn } from "@/lib/utils";

// 普段見せる小窓。好きな画像を背景に、読み上げた「ひとこと」を下から積み上げる。
// 設定はここに置かず、右上の歯車から設定ウィンドウを開く。

interface Line {
  id: number;
  app_id: string;
  app_name: string | null;
  text: string;
  at: number;
  state: "queued" | "speaking" | "done";
}

const PIN_KEY = "readapp.companion.pinned";
/** 背景の選択。"preset:<id>" か、取り込んだ画像の "custom" */
const BACKGROUND_KEY = "readapp.companion.background";

/** 同梱の背景 (public/companion/)。下4割はカードが重なるので、主役が上半分にいる画像にする */
const PRESETS = [
  { id: "cat", name: "ねこ" },
  { id: "shiba", name: "柴犬" },
  { id: "bunny", name: "うさぎ" },
  { id: "buncho", name: "文鳥" },
  { id: "girl", name: "女の子" },
  { id: "boy", name: "男の子" },
].map((p) => ({ ...p, src: `/companion/${p.id}.webp` }));
const DEFAULT_PRESET = PRESETS[0];

function loadChoice(): string | null {
  try { return localStorage.getItem(BACKGROUND_KEY); } catch { return null; }
}
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];
/** 話している間に文字を流す速さ (1秒あたりの文字数)。声より少し先に出し切る */
const CHARS_PER_SECOND = 9;

function lineLabel(line: Line): string {
  if (line.app_name) return line.app_name;
  if (line.app_id === "preview") return "readapp";
  return "通知";
}

function lineColor(line: Line): string {
  if (line.app_id === "preview" || line.app_id === "readapp") return "var(--color-primary)";
  return knownApp(line.app_id).color;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("ja-JP", { hour: "numeric", minute: "2-digit" });
}

function Bars() {
  const reduce = useReducedMotion();
  return (
    <span className="inline-flex h-3 items-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3].map((k) => (
        <motion.span
          key={k}
          className="w-[3px] rounded-full bg-primary"
          animate={reduce ? { height: 7 } : { height: [4, 12, 6, 10, 4] }}
          transition={reduce ? undefined : { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: k * 0.12 }}
        />
      ))}
    </span>
  );
}

/** 話している間だけ、声に合わせて文字を流す */
function useTyped(text: string, speaking: boolean): string {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(speaking && !reduce ? 0 : text.length);
  useEffect(() => {
    if (!speaking || reduce) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const started = performance.now();
    let frame = 0;
    const tick = () => {
      const n = Math.min(text.length, Math.ceil(((performance.now() - started) / 1000) * CHARS_PER_SECOND));
      setShown(n);
      if (n < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, speaking, reduce]);
  return text.slice(0, shown);
}

function Bubble({ line }: { line: Line }) {
  const speaking = line.state === "speaking";
  const typed = useTyped(line.text, speaking);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      style={{ transformOrigin: "left bottom" }}
      className="w-fit min-w-[11rem] max-w-[88%] rounded-[18px] rounded-bl-[6px] bg-base-100/95 px-3.5 pb-2.5 pt-2 shadow-[0_6px_20px_rgb(41_39_45/0.16)] backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: lineColor(line) }} aria-hidden="true" />
        <span className="truncate">{lineLabel(line)}</span>
        {speaking && <Bars />}
        <span className="ms-auto shrink-0 ps-3 font-medium tabular-nums">{clock(line.at)}</span>
      </div>
      <p className="relative mt-0.5 whitespace-pre-line text-[15px] font-bold leading-snug">
        {line.state === "queued" ? (
          <span className="loading loading-dots loading-sm text-muted" aria-label="準備中" />
        ) : (
          <>
            <span className="invisible">{line.text}</span>
            <span className="absolute inset-0">{typed}</span>
          </>
        )}
      </p>
    </motion.li>
  );
}

export function Companion() {
  const [lines, setLines] = useState<Line[]>([]);
  // 取り込んだ画像 (undefined = 確認中, null = 無し)
  const [custom, setCustom] = useState<string | null | undefined>(undefined);
  const [choice, setChoiceState] = useState<string | null>(loadChoice);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; }
  });

  const setChoice = useCallback((value: string) => {
    setChoiceState(value);
    try { localStorage.setItem(BACKGROUND_KEY, value); } catch { /* 保存できなくても今は変わる */ }
  }, []);

  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    const keep = (off: () => void) => (disposed ? off() : offs.push(off));
    listen<Line>("companion-line", ({ payload }) => {
      setLines((cur) => {
        const i = cur.findIndex((l) => l.id === payload.id);
        if (i < 0) return [...cur, payload].slice(-30);
        const next = [...cur];
        next[i] = payload;
        return next;
      });
    }).then(keep).catch(() => {});
    listen<Line[]>("companion-feed", ({ payload }) => setLines(payload)).then(keep).catch(() => {});
    invoke<Line[]>("companion_feed").then((feed) => !disposed && setLines((cur) => (cur.length ? cur : feed))).catch(() => {});
    invoke<string | null>("companion_image").then((url) => !disposed && setCustom(url)).catch(() => setCustom(null));
    return () => { disposed = true; offs.forEach((off) => off()); };
  }, []);

  useEffect(() => {
    getCurrentWindow().setAlwaysOnTop(pinned).catch(() => {});
    try { localStorage.setItem(PIN_KEY, pinned ? "1" : "0"); } catch { /* 保存できなくても使える */ }
  }, [pinned]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicking(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  const applyImage = useCallback(async (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      setNotice("PNG・JPEG・WebP・GIFの画像を使えます");
      return;
    }
    try {
      setCustom(await invoke<string>("set_companion_image", { path }));
      setChoice("custom");
    } catch (e) {
      setNotice(e === "too_large" ? "20MBまでの画像を使えます" : "画像を読み込めませんでした");
    }
  }, [setChoice]);

  // 画像をウィンドウへドラッグすると背景を差し替える
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter" || payload.type === "over") setDragging(true);
        else if (payload.type === "leave") setDragging(false);
        else if (payload.type === "drop") {
          setDragging(false);
          const path = payload.paths[0];
          if (path) void applyImage(path);
        }
      })
      .then((f) => (disposed ? f() : (off = f)))
      .catch(() => {});
    return () => { disposed = true; off?.(); };
  }, [applyImage]);

  const pickFile = async () => {
    const picked = await open({ multiple: false, directory: false, filters: [{ name: "画像", extensions: IMAGE_EXTENSIONS }] }).catch(() => null);
    if (typeof picked === "string") await applyImage(picked);
  };

  // 何も選んでいなければ、取り込んだ画像 (以前の版で設定したもの) か、最初のプリセット
  const preset = PRESETS.find((p) => choice === `preset:${p.id}`);
  const background = preset
    ? preset.src
    : choice === "custom" || choice === null
      ? custom === undefined ? null : custom ?? DEFAULT_PRESET.src
      : DEFAULT_PRESET.src;
  const selected = preset ? preset.id : background === custom && custom ? "custom" : DEFAULT_PRESET.id;

  return (
    <MotionConfig reducedMotion="user">
      <main className="group relative h-screen w-screen select-none overflow-hidden bg-base-300">
        <AnimatePresence initial={false}>
          {background && (
            <motion.img
              key={background.length + background.slice(-24)}
              src={background}
              alt=""
              draggable={false}
              initial={{ opacity: 0, scale: 1.08 }}
              animate={{ opacity: 1, scale: 1.02 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 size-full object-cover"
            />
          )}
        </AnimatePresence>

        {/* 文字を読みやすくする下側の陰り */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-[rgb(41_39_45/0.28)] to-transparent" />

        {/* 上の帯: ウィンドウをつかんで動かす (左上は閉じるボタン類) */}
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-11" />

        <div className="absolute right-2.5 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          {[
            { label: "背景を選ぶ", icon: <ImagePlus aria-hidden="true" />, onClick: () => setPicking(true), pressed: undefined },
            { label: pinned ? "手前に固定をやめる" : "手前に固定", icon: <Pin aria-hidden="true" />, onClick: () => setPinned(!pinned), pressed: pinned },
            { label: "設定を開く", icon: <Settings2 aria-hidden="true" />, onClick: () => void invoke("show_settings").catch(() => {}), pressed: undefined },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              aria-label={b.label}
              title={b.label}
              aria-pressed={b.pressed}
              onClick={b.onClick}
              className={cn(
                "btn btn-circle btn-xs border-0 shadow-sm backdrop-blur",
                b.pressed ? "bg-primary text-primary-content" : "bg-base-100/85 text-base-content hover:bg-base-100",
              )}
            >
              {b.icon}
            </button>
          ))}
        </div>
        {pinned && (
          <span className="pointer-events-none absolute right-3 top-3 z-10 grid size-4 place-items-center rounded-full bg-primary text-primary-content transition-opacity group-hover:opacity-0" aria-hidden="true">
            <Pin className="size-2.5" />
          </span>
        )}

        <AnimatePresence>
          {notice && (
            <motion.div
              role="status"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute inset-x-0 top-11 z-40 flex justify-center px-4"
            >
              <span className="rounded-full bg-base-100/95 px-3.5 py-1.5 text-xs font-semibold shadow-md">{notice}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <ol
          aria-label="読み上げたこと"
          aria-live="polite"
          className="absolute inset-x-3 bottom-3 top-12 flex flex-col justify-end gap-2 overflow-hidden [mask-image:linear-gradient(transparent,#000_18%)]"
        >
          <AnimatePresence initial={false}>
            {lines.length
              ? lines.map((line) => <Bubble key={line.id} line={line} />)
              : (
                  <Bubble
                    key="welcome"
                    line={{ id: 0, app_id: "preview", app_name: null, text: "通知が来たら、\nここで教えるね。", at: Date.now(), state: "done" }}
                  />
                )}
          </AnimatePresence>
        </ol>

        {/* 背景を選ぶシート */}
        <AnimatePresence>
          {picking && (
            <>
              <motion.button
                type="button"
                aria-label="背景の選択を閉じる"
                tabIndex={-1}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPicking(false)}
                className="absolute inset-0 z-30 cursor-default bg-[rgb(41_39_45/0.18)]"
              />
              <motion.section
                role="dialog"
                aria-label="背景を選ぶ"
                tabIndex={-1}
                autoFocus
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className="absolute inset-x-0 bottom-0 z-30 rounded-t-[22px] bg-base-100 px-4 pb-4 pt-3 shadow-[0_-8px_30px_rgb(41_39_45/0.18)] outline-none"
              >
                <div className="flex items-center">
                  <h2 className="text-[13px] font-semibold">背景を選ぶ</h2>
                  <button type="button" aria-label="閉じる" onClick={() => setPicking(false)} className="btn btn-ghost btn-circle btn-xs ms-auto">
                    <X aria-hidden="true" />
                  </button>
                </div>
                <ul className="mt-2.5 grid grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <BackgroundTile key={p.id} name={p.name} src={p.src} selected={selected === p.id} onSelect={() => setChoice(`preset:${p.id}`)} />
                  ))}
                  {custom ? (
                    <BackgroundTile name="自分の画像" src={custom} selected={selected === "custom"} onSelect={() => setChoice("custom")} />
                  ) : null}
                  <li>
                    <button
                      type="button"
                      onClick={() => void pickFile()}
                      className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-field border border-dashed border-base-content/25 text-muted transition-colors hover:border-primary hover:text-primary"
                    >
                      <ImagePlus className="size-4" aria-hidden="true" />
                      <span className="text-[10px] font-medium leading-tight">画像を<br />選ぶ</span>
                    </button>
                  </li>
                </ul>
                <p className="mt-2.5 text-[11px] text-muted">好きな画像を、この窓にドロップしても変えられます。</p>
              </motion.section>
            </>
          )}
        </AnimatePresence>

        {/* 画像を重ねている間の受け皿 */}
        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/15 shadow-[inset_0_0_0_4px_var(--color-primary)]"
            >
              <span className="rounded-full bg-base-100/95 px-4 py-2 text-[13px] font-semibold shadow-md">離すと背景になります</span>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}

function BackgroundTile({ name, src, selected, onSelect }: { name: string; src: string; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" aria-pressed={selected} onClick={onSelect} className="group/tile block w-full text-left">
        <span
          className={cn(
            "relative block aspect-[3/4] overflow-hidden rounded-field ring-offset-2 ring-offset-base-100 transition-all duration-150",
            selected ? "ring-2 ring-primary" : "group-hover/tile:ring-2 group-hover/tile:ring-base-content/20",
          )}
        >
          <img src={src} alt="" draggable={false} className="size-full object-cover transition-transform duration-200 group-hover/tile:scale-105" />
          {selected && (
            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-content" aria-hidden="true">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="mt-1 block truncate text-center text-[10px] font-medium text-muted">{name}</span>
      </button>
    </li>
  );
}
