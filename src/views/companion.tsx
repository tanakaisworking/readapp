import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ArrowDown, Check, Pencil, Pin, Settings2, UsersRound, VolumeX, X } from "lucide-react";
import { knownApp } from "@/lib/apps";
import { useAppIcon } from "@/components/app-avatar";
import { LiveCharacter } from "@/components/live-character";
import { OPEN_PICKER_EVENT, OPEN_PICKER_KEY, openCharacterEditor } from "@/lib/companion-window";
import {
  IMAGE_EXTENSIONS,
  characterSrc,
  isLiveImage,
  migrateLegacyBackground,
  useCustomImages,
  type Character,
  type CharactersState,
} from "@/lib/characters";
import { cn } from "@/lib/utils";

// 普段見せる小窓。いま話すキャラの画像を背景に、読み上げた「ひとこと」を下から積み上げる。
// 設定はここに置かず、右上の歯車から設定ウィンドウを開く。

interface Line {
  id: number;
  app_id: string;
  app_name: string | null;
  text: string;
  at: number;
  state: "queued" | "speaking" | "done" | "silent";
  /** 押すと通知か送ってきたアプリを開ける */
  openable?: boolean;
}

const PIN_KEY = "readapp.companion.pinned";
/** 小窓でさかのぼれる件数 (Rust側 companion::FEED_LIMIT と同じ) */
const FEED_LIMIT = 100;
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

/** 吹き出しのアプリ名の横の印。入っているアプリは本物のアイコン、readapp自身はロゴ、ほかは色の点 */
function SourceMark({ line }: { line: Line }) {
  const own = line.app_id === "preview" || line.app_id === "readapp";
  const icon = useAppIcon(own ? undefined : line.app_id);
  const src = own ? "/logo.png" : icon;
  if (src) return <img src={src} alt="" aria-hidden="true" draggable={false} className="size-4 shrink-0 select-none object-contain" />;
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: lineColor(line) }} aria-hidden="true" />;
}

function clock(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString("ja-JP", { hour: "numeric", minute: "2-digit" });
  // 今日より前の通知は日付も出す (さかのぼった時に分かるように)
  return date.toDateString() === new Date().toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
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

function Bubble({ line, onOpen }: { line: Line; onOpen?: (line: Line) => void }) {
  const speaking = line.state === "speaking";
  const typed = useTyped(line.text, speaking);
  const card = "block w-full rounded-[18px] rounded-bl-[6px] bg-base-100/95 px-3.5 pb-2.5 pt-2 text-left shadow-[0_6px_20px_rgb(41_39_45/0.16)] backdrop-blur-sm";
  const content = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
        <SourceMark line={line} />
        <span className="truncate">{lineLabel(line)}</span>
        {speaking && <Bars />}
        {line.state === "silent" && <VolumeX className="size-3 shrink-0" aria-label="読み上げなし" />}
        <span className="ms-auto shrink-0 ps-3 font-medium tabular-nums">{clock(line.at)}</span>
      </span>
      <span className="relative mt-0.5 block whitespace-pre-line text-[15px] font-bold leading-snug">
        {line.state === "queued" ? (
          <span className="loading loading-dots loading-sm text-muted" aria-label="準備中" />
        ) : (
          <>
            <span className="invisible">{line.text}</span>
            <span className="absolute inset-0">{typed}</span>
          </>
        )}
      </span>
    </>
  );
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      style={{ transformOrigin: "left bottom" }}
      className="w-fit min-w-[11rem] max-w-[88%]"
    >
      {line.openable && onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(line)}
          title={`${lineLabel(line)}を開く`}
          className={cn(card, "cursor-pointer transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgb(41_39_45/0.2)] active:translate-y-0")}
        >
          {content}
        </button>
      ) : (
        <div className={card}>{content}</div>
      )}
    </motion.li>
  );
}

/** 読み上げたことの一覧。上へスクロールすると過去の通知をさかのぼれる */
/** フォーカスしていない時に吹き出しを収める範囲 (ウィンドウの下から何%)。プリセットは主役を上半分に置いている */
const BUBBLE_AREA_KEY = "readapp.companion.bubbleArea";
const BUBBLE_AREA = { min: 25, max: 75, step: 5, initial: 45 };

function loadBubbleArea(): number {
  try {
    const v = Number(localStorage.getItem(BUBBLE_AREA_KEY));
    return v >= BUBBLE_AREA.min && v <= BUBBLE_AREA.max ? v : BUBBLE_AREA.initial;
  } catch {
    return BUBBLE_AREA.initial;
  }
}

function Feed({ lines, onOpen, expanded, area }: { lines: Line[]; onOpen: (line: Line) => void; expanded: boolean; area: number }) {
  const reduce = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // いちばん下を見ている間だけ、新しい通知に合わせて下へついていく
  const atBottom = useRef(true);
  const [unread, setUnread] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const lastId = lines[lines.length - 1]?.id;

  // 最後にユーザーが自分でスクロールした時刻。吹き出しの出入りのアニメーションで起きたスクロールと区別する
  const userScrolledAt = useRef(0);
  const markUserScroll = () => {
    userScrolledAt.current = performance.now();
  };

  // いちばん下を見ている間は、吹き出しの出入りのアニメーションが落ち着くまで最下部に合わせ続ける
  const stickToBottom = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const until = performance.now() + 600;
    const tick = () => {
      if (!atBottom.current) return;
      el.scrollTop = el.scrollHeight;
      if (performance.now() < until) requestAnimationFrame(tick);
    };
    tick();
  }, []);

  useEffect(() => {
    const el = scroller.current;
    const ol = list.current;
    if (!el || !ol) return;
    const observer = new ResizeObserver(() => {
      stickToBottom();
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    });
    observer.observe(ol);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stickToBottom]);

  // さかのぼって読んでいる途中に届いたら、下へ戻さずに知らせるだけにする
  useEffect(() => {
    if (lastId !== undefined && !atBottom.current) setUnread(true);
  }, [lastId]);

  // 他のアプリを使っている間はキャラの顔を隠さないよう、最新の数件だけを下に出す
  useEffect(() => {
    if (expanded) return;
    atBottom.current = true;
    setUnread(false);
    stickToBottom();
  }, [expanded, area, stickToBottom]);

  const onScroll = () => {
    const el = scroller.current;
    // 自分でスクロールした時だけ「さかのぼっているか」を判定し直す
    if (!el || performance.now() - userScrolledAt.current > 400) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom.current) setUnread(false);
  };

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = true;
    setUnread(false);
    if (reduce) stickToBottom();
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <>
      <div
        ref={scroller}
        onScroll={onScroll}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
        onKeyDown={markUserScroll}
        onPointerDown={markUserScroll}
        tabIndex={0}
        aria-label="読み上げたこと。上へスクロールすると過去の通知を見られます"
        style={{ top: expanded ? "2.5rem" : `${100 - area}%` }}
        className={cn(
          // 最下部に合わせるのはこちらで行うので、ブラウザの自動調整 (スクロールアンカー) は切る
          "absolute inset-x-0 bottom-0 overscroll-contain px-3 pb-3 outline-none transition-[top] duration-300 ease-out [overflow-anchor:none] motion-reduce:transition-none [mask-image:linear-gradient(transparent,#000_36px)] [scrollbar-width:thin]",
          expanded ? "overflow-y-auto" : "overflow-hidden",
        )}
      >
        <ol ref={list} aria-live="polite" className="flex min-h-full flex-col justify-end gap-2 pt-9">
          {overflowing && expanded && (
            <li className="self-center rounded-full bg-base-100/80 px-3 py-1 text-[10px] font-medium text-muted backdrop-blur-sm">
              ここより前の通知はありません・アプリを終了すると消えます
            </li>
          )}
          <AnimatePresence initial={false}>
            {lines.length
              ? lines.map((line) => <Bubble key={line.id} line={line} onOpen={onOpen} />)
              : (
                  <Bubble
                    key="welcome"
                    line={{ id: 0, app_id: "preview", app_name: null, text: "通知が来たら、\nここで教えるね。", at: Date.now(), state: "done" }}
                  />
                )}
          </AnimatePresence>
        </ol>
      </div>
      <AnimatePresence>
        {unread && expanded && (
          <motion.button
            type="button"
            onClick={jumpToLatest}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="btn btn-primary btn-xs absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full shadow-md"
          >
            <ArrowDown aria-hidden="true" />
            新しい通知
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}

export function Companion() {
  const [lines, setLines] = useState<Line[]>([]);
  // 作ったキャラと、いま話すキャラ (背景はそのキャラの画像)
  const [cast, setCast] = useState<CharactersState | null>(null);
  const customs = useCustomImages(cast?.characters);
  // 新しく届いた通知の数 (動くキャラが「届いた」動きをする)。起動時に読み込んだ過去の通知では動かさない
  const [arrivals, setArrivals] = useState(0);
  const newestId = useRef(0);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  // 小窓を使っている間だけ吹き出しを上まで広げ、過去の通知をさかのぼれるようにする
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [area, setAreaState] = useState(loadBubbleArea);
  // 範囲を調整している間は、シートを縮めて範囲を暗く見せる
  const [adjusting, setAdjusting] = useState(false);
  const adjustTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginAdjust = () => {
    if (adjustTimer.current) clearTimeout(adjustTimer.current);
    setAdjusting(true);
  };
  const endAdjust = () => {
    if (adjustTimer.current) clearTimeout(adjustTimer.current);
    // 離した直後の結果も少し見せてから、シートを戻す
    adjustTimer.current = setTimeout(() => setAdjusting(false), 1000);
  };
  const setArea = (value: number) => {
    setAreaState(value);
    try { localStorage.setItem(BUBBLE_AREA_KEY, String(value)); } catch { /* 保存できなくても今は変わる */ }
  };
  useEffect(() => () => { if (adjustTimer.current) clearTimeout(adjustTimer.current); }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    const keep = (off: () => void) => (disposed ? off() : offs.push(off));
    listen<Line>("companion-line", ({ payload }) => {
      if (payload.id > newestId.current) {
        newestId.current = payload.id;
        setArrivals((n) => n + 1);
      }
      setLines((cur) => {
        const i = cur.findIndex((l) => l.id === payload.id);
        if (i < 0) return [...cur, payload].slice(-FEED_LIMIT);
        const next = [...cur];
        next[i] = payload;
        return next;
      });
    }).then(keep).catch(() => {});
    listen<Line[]>("companion-feed", ({ payload }) => setLines(payload)).then(keep).catch(() => {});
    // 設定の「背景と表示範囲」から開かれた時は、背景のシートも開く
    const openPicker = () => {
      try { localStorage.removeItem(OPEN_PICKER_KEY); } catch { /* 消せなくても開く */ }
      setPicking(true);
    };
    listen(OPEN_PICKER_EVENT, openPicker).then(keep).catch(() => {});
    try { if (localStorage.getItem(OPEN_PICKER_KEY) === "1") openPicker(); } catch { /* 読めなければ開かない */ }
    invoke<Line[]>("companion_feed")
      .then((feed) => {
        if (disposed) return;
        newestId.current = Math.max(newestId.current, ...feed.map((l) => l.id));
        setLines((cur) => (cur.length ? cur : feed));
      })
      .catch(() => {});
    let changed = false;
    listen<CharactersState>("characters-changed", ({ payload }) => {
      changed = true;
      setCast(payload);
    }).then(keep).catch(() => {});
    invoke<CharactersState & { migrated_from_legacy: boolean }>("get_state")
      .then((s) => {
        if (disposed) return;
        if (!changed) setCast({ characters: s.characters, active_character: s.active_character });
        void migrateLegacyBackground(s);
      })
      .catch(() => {});
    return () => { disposed = true; offs.forEach((off) => off()); };
  }, []);

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    let off: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then((f) => (disposed ? f() : (off = f)))
      .catch(() => {});
    return () => {
      disposed = true;
      off?.();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
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

  const active = cast?.characters.find((c) => c.id === cast.active_character) ?? cast?.characters[0];

  const applyImage = useCallback(async (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      setNotice("PNG・JPEG・WebP・GIFの画像を使えます");
      return;
    }
    if (!active) return;
    try {
      await invoke<string>("set_character_image", { id: active.id, path });
    } catch (e) {
      setNotice(e === "too_large" ? "20MBまでの画像を使えます" : "画像を読み込めませんでした");
    }
  }, [active]);

  // 画像をウィンドウへドラッグすると、いまのキャラの画像を差し替える
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

  // 吹き出しを押した時: 画面に残っている通知ならそれを、消えていれば送ってきたアプリを開く
  const openLine = useCallback((line: Line) => {
    invoke<string>("companion_open", { id: line.id }).catch(() => setNotice(`${lineLabel(line)}を開けませんでした`));
  }, []);

  // どこをつかんでも小窓を動かせる。吹き出しやボタンは、少し動かした時だけ動かす (そのまま離せば押せる)
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    dragFrom.current = null;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // シートの中 (スライダー・画像) と、スクロールバーの上は動かさない
    if (target.closest('input, textarea, select, [role="dialog"]')) return;
    if (target.clientWidth > 0 && e.nativeEvent.offsetX > target.clientWidth) return;
    if (target.closest("button")) {
      dragFrom.current = { x: e.clientX, y: e.clientY };
      return;
    }
    void getCurrentWindow().startDragging().catch(() => {});
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    if (!(e.buttons & 1)) {
      dragFrom.current = null;
      return;
    }
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < 4) return;
    dragFrom.current = null;
    void getCurrentWindow().startDragging().catch(() => {});
  };

  const live = cast ? isLiveImage(active?.image) : false;
  const background = cast && !live ? characterSrc(active, customs) : null;
  const speaking = lines.some((l) => l.state === "speaking");
  const choose = (id: string) => {
    setCast((cur) => (cur ? { ...cur, active_character: id } : cur));
    void invoke("set_active_character", { id }).catch(() => setNotice("キャラを切り替えられませんでした"));
  };

  return (
    <MotionConfig reducedMotion="user">
      <main
        className="group relative h-screen w-screen select-none overflow-hidden bg-base-300"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragFrom.current = null)}
        onPointerCancel={() => (dragFrom.current = null)}
      >
        <AnimatePresence initial={false}>
          {live && (
            <motion.div
              key="live"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0"
            >
              <LiveCharacter framing="scene" speaking={speaking} notifyKey={arrivals} className="block size-full" />
            </motion.div>
          )}
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

        <div className="absolute right-2.5 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          {[
            { label: "キャラを選ぶ", icon: <UsersRound aria-hidden="true" />, onClick: () => setPicking(true), pressed: undefined },
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

        {/* 範囲の調整中: 吹き出しを出す範囲を暗くして、境目を示す */}
        <AnimatePresence>
          {adjusting && (
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, height: `${area}%` }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ height: `${area}%` }}
              className="pointer-events-none absolute inset-x-0 bottom-0 border-t-2 border-dashed border-white/85 bg-[rgb(20_18_24/0.45)]"
            >
              <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-base-100/95 px-3 py-1 text-[11px] font-semibold text-base-content shadow-md">
                吹き出しはここまで
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <Feed lines={lines} onOpen={openLine} expanded={(focused || picking) && !adjusting} area={area} />

        {/* キャラを選ぶシート (吹き出しの範囲もここで変える) */}
        <AnimatePresence>
          {picking && (
            <>
              {!adjusting && <motion.button
                type="button"
                aria-label="キャラの選択を閉じる"
                tabIndex={-1}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPicking(false)}
                className="absolute inset-0 z-30 cursor-default bg-[rgb(41_39_45/0.18)]"
              />}
              <motion.section
                role="dialog"
                aria-label="キャラを選ぶ"
                tabIndex={-1}
                autoFocus
                layout
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className="absolute inset-x-0 bottom-0 z-30 rounded-t-[22px] bg-base-100 px-4 pb-4 pt-3 shadow-[0_-8px_30px_rgb(41_39_45/0.18)] outline-none"
              >
                {!adjusting && (
                  <div className="flex items-center">
                    <h2 className="text-[13px] font-semibold">キャラを選ぶ</h2>
                    <button type="button" aria-label="閉じる" onClick={() => setPicking(false)} className="btn btn-ghost btn-circle btn-xs ms-auto">
                      <X aria-hidden="true" />
                    </button>
                  </div>
                )}
                <div className={cn("flex items-center gap-3", !adjusting && "mt-2.5")}>
                  <label htmlFor="readapp-bubble-area" className="shrink-0 text-xs font-medium">吹き出しの範囲</label>
                  <input
                    id="readapp-bubble-area"
                    type="range"
                    min={BUBBLE_AREA.min}
                    max={BUBBLE_AREA.max}
                    step={BUBBLE_AREA.step}
                    value={area}
                    aria-valuetext={`下から${area}パーセント`}
                    onPointerDown={beginAdjust}
                    onPointerUp={endAdjust}
                    onPointerCancel={endAdjust}
                    onKeyDown={() => { beginAdjust(); endAdjust(); }}
                    onChange={(e) => setArea(Number(e.target.value))}
                    className="range range-primary range-xs min-w-0 flex-1"
                  />
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted">{area}%</span>
                </div>
                {!adjusting && (<>
                <ul className="mt-3 grid grid-cols-4 gap-2">
                  {cast?.characters.map((c) => (
                    <BackgroundTile key={c.id} character={c} name={c.name} src={characterSrc(c, customs)} selected={c.id === active?.id} onSelect={() => choose(c.id)} />
                  ))}
                </ul>
                {active && (
                  <div className="mt-3 flex items-center gap-2">
                    <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted">画像をこの窓にドロップすると、{active.name}の画像になります。</p>
                    <button type="button" className="btn btn-sm shrink-0" onClick={() => void openCharacterEditor(active.id)}>
                      <Pencil aria-hidden="true" />
                      編集
                    </button>
                  </div>
                )}
                </>)}
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
              <span className="rounded-full bg-base-100/95 px-4 py-2 text-[13px] font-semibold shadow-md">離すと{active?.name ?? "キャラ"}の画像になります</span>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </MotionConfig>
  );
}

function BackgroundTile({ character, name, src, selected, onSelect }: { character: Character; name: string; src: string | null; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" aria-pressed={selected} onClick={onSelect} className="group/tile block w-full text-left">
        <span
          className={cn(
            "relative block aspect-[3/4] overflow-hidden rounded-field ring-offset-2 ring-offset-base-100 transition-all duration-150",
            selected ? "ring-2 ring-primary" : "group-hover/tile:ring-2 group-hover/tile:ring-base-content/20",
          )}
        >
          {isLiveImage(character.image) ? (
            <LiveCharacter framing="portrait" still className="block size-full transition-transform duration-200 group-hover/tile:scale-105" />
          ) : src ? (
            <img src={src} alt="" draggable={false} className="size-full object-cover transition-transform duration-200 group-hover/tile:scale-105" />
          ) : (
            <span className="block size-full bg-base-300" />
          )}
          {selected && (
            <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-content" aria-hidden="true">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="mt-1 line-clamp-2 text-center text-[10px] font-medium leading-snug text-muted">{name}</span>
      </button>
    </li>
  );
}
