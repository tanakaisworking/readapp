import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { bell, flow, loop, seeded, track, wave, type Key } from "@/lib/motion";

// 動くキャラ「ふきだし」。アプリアイコンの、顔のあるふきだしと通知の点。体の色はテーマカラーに合わせる。
// 画像ではなくSVGで描き、1つの時計で動かす (決まりは src/components/MOTION.md)。
// - 待機: 呼吸、ゆっくり浮く、まばたき、ときどき横を見る、しっぽと通知の点が少し遅れてついてくる
// - 通知が届いた時 (notifyKey が変わった時): 点が2回ふくらみ、吹き出しの方へ目をやって少し傾く
// - 話している間 (speaking): 口を音節ごとに開け閉めする
// 見えていない間と「視差効果を減らす」の間は止まり、0フレーム目 (目を開けて笑っている絵) を見せる。

/** 調整用の数値。「もっとゆっくり」「小さく」はここを変える */
const T = {
  /** 待機のループ (ms)。下の周期はすべてこれを割り切る */
  period: 8000,
  breathe: { period: 4000, amount: 0.015 },
  float: { period: 8000 / 3, units: 2 },
  tilt: { period: 8000, deg: 2.2 },
  tail: { period: 4000, deg: 4, lag: -0.15 },
  dotGlow: { period: 2000, amount: 0.03 },
  /** 子の部品が親を追う遅れ (ms) と強さ */
  follow: { ms: 120, strength: 0.5 },
  /** 通知が届いた時の一度きりの動き (ms) */
  notify: 1500,
  /** 話し始め・話し終わりに口の動きが入る速さ (ms) */
  talkBlend: 90,
};

// 視線 (目の位置のずれ)。止まらずに移り、移った先で1秒以上とどまる
const LOOK_X: [number, number][] = [[0, 0], [1700, 0], [2200, -5], [3500, -5], [4000, 0], [5600, 0], [6100, 4.5], [7100, 4.5], [7600, 0], [8000, 0]];
const LOOK_Y: [number, number][] = [[0, 0], [1700, 0], [2200, 2], [3500, 2], [4000, 0], [8000, 0]];
// 通知が届いた時、吹き出しの方を見て戻る
const GLANCE: [number, number][] = [[0, 0], [350, 1], [1000, 1], [T.notify, 0]];

/** まばたき1回: 110msで閉じ、少し止まり、190msかけて開く (開く方がゆっくり) */
function blink(at: number): Key[] {
  return [[at, 0], [at + 110, 1], [at + 150, 1], [at + 340, 0, "out"]];
}
// 視線が移る時にまばたきする。最後は2回続けて
const LID: Key[] = [[0, 0], ...blink(2050), ...blink(4700), ...blink(7100), ...blink(7540), [8000, 0]];
const NOTIFY_LID: Key[] = blink(300);
// ときどき、うれしそうに目を細める
const CHEEK: Key[] = [[0, 0], [4950, 0], [5300, 1, "out"], [6000, 1], [6400, 0], [8000, 0]];

// 話す口。12音節を2つの句に分け、長さと開き方を少しずつ変える
const TALK: { keys: Key[]; period: number } = (() => {
  const keys: Key[] = [[0, 0]];
  let at = 0;
  for (let i = 0; i < 12; i++) {
    const d = 150 + seeded(i, 1) * 90;
    const amp = 0.45 + seeded(i, 2) * 0.55;
    keys.push([at + d * 0.4, amp, "out"], [at + d, 0.08]);
    at += d;
    if (i === 5) {
      keys.push([at + 120, 0]);
      at += 260;
    }
  }
  keys.push([at + 120, 0]);
  return { keys, period: at + 200 };
})();

// 背景にときどき光る粒 (位置と出るタイミングは粒ごとに決まっている)
const SPARKLES = [0, 1, 2].map((i) => ({
  x: [44, 292, 270][i] + seeded(i, 3) * 10,
  y: [96, 70, 214][i] + seeded(i, 4) * 10,
  size: 5 + seeded(i, 5) * 3,
  phase: seeded(i, 6),
}));

interface Pose {
  /** 待機の時計の時刻 (ms) */
  t: number;
  lift: number;
  tilt: number;
  sy: number;
  lookX: number;
  lookY: number;
  lid: number;
  cheek: number;
  mouth: number;
  tail: number;
  dotScale: number;
  dotTurn: number;
}

const glanceAt = (n: number) => (n >= 0 && n < T.notify ? flow(n, GLANCE) : 0);
const tiltAt = (t: number, n: number) => T.tilt.deg * wave(t, T.tilt.period) - 3 * glanceAt(n);

/** 時刻 t (ms)、通知からの経過 n (ms)、話している度合い talk (0〜1) と話している時間 talkT の姿勢 */
function pose(t: number, n: number, talk: number, talkT: number): Pose {
  const idle = t % T.period;
  const glance = glanceAt(n);
  const tilt = tiltAt(t, n);
  const mouth = talk * track(talkT % TALK.period, TALK.keys);
  const calm = 1 - 0.7 * talk; // 話している間は聞き手 (こちら) を見る
  const pulse = n >= 0 && n < T.notify ? bell(n / 300) + bell((n - 330) / 300) : 0;

  return {
    t,
    lift: T.float.units * (1 + wave(t, T.float.period, 0.1)),
    tilt,
    sy: 1 + T.breathe.amount * wave(t, T.breathe.period) + 0.012 * mouth,
    lookX: flow(idle, LOOK_X) * calm - 4 * glance,
    lookY: flow(idle, LOOK_Y) * calm + 5 * glance,
    lid: Math.max(track(idle, LID), n >= 0 && n < T.notify ? track(n, NOTIFY_LID) : 0),
    cheek: track(idle, CHEEK) * (1 - talk),
    mouth,
    tail: T.tail.deg * wave(t, T.tail.period, T.tail.lag),
    dotScale: 1 + T.dotGlow.amount * wave(t, T.dotGlow.period) + 0.15 * pulse,
    // 点は体の傾きを少し遅れて追う (遅れた分だけ逆に振れて、追いつく)
    dotTurn: T.follow.strength * (tiltAt(t - T.follow.ms, n - T.follow.ms) - tilt) * 2,
  };
}

const REST: Pose = pose(0, -1, 0, 0);

// 色はテーマカラーに合わせる (index.css の --fuki-body / --fuki-dot)。白や黒と混ぜて濃淡を作る
const BODY = "var(--fuki-body, #6b4ce6)";
const DOT = "var(--fuki-dot, #f6a019)";
const mix = (color: string, percent: number, other: string) => "color-mix(in oklab, " + color + " " + percent + "%, " + other + ")";
const INK = {
  sky: [mix(BODY, 10, "#ffffff"), mix(BODY, 14, "#ffffff"), mix(BODY, 8, "#fbe8ef")],
  body: [mix(BODY, 38, "#ffffff"), mix(BODY, 80, "#ffffff"), BODY, mix(BODY, 82, "#000000")],
  dot: [mix(DOT, 45, "#ffffff"), DOT, mix(DOT, 82, "#c24f00")],
  shadow: mix(BODY, 55, "#000000"),
};

/** 1つの時計。動かす時だけ requestAnimationFrame を回し、見えていない間は止める */
function usePose({ live, speaking, notifyKey }: { live: boolean; speaking: boolean; notifyKey: unknown }): Pose {
  const [, setFrame] = useState(0);
  const clock = useRef({ t: 0, last: 0, talk: 0, talkT: 0, notifyAt: -Infinity });
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // 通知が届いたら一度きりの動きを始める (最初の表示では動かさない)
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    clock.current.notifyAt = clock.current.t;
  }, [notifyKey]);

  const running = live && visible;
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    clock.current.last = performance.now();
    const tick = (now: number) => {
      const c = clock.current;
      const dt = Math.min(64, now - c.last);
      c.last = now;
      c.t += dt;
      // 口の動きは、話し始め・終わりで急に切り替えず、なめらかに入れて抜く
      c.talk += ((speakingRef.current ? 1 : 0) - c.talk) * (1 - Math.exp(-dt / T.talkBlend));
      if (c.talk > 0.001) c.talkT += dt;
      else c.talkT = 0;
      setFrame((f) => (f + 1) % 1_000_000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  if (!live) return REST;
  const c = clock.current;
  return pose(c.t, c.t - c.notifyAt, c.talk, c.talkT);
}

/** 背景の粒は、待機のループの中で1回ずつ、短い間だけ現れて消える */
function sparkle(t: number, phase: number): number {
  const q = loop(t, T.period, phase);
  return q < 0.18 ? bell(q / 0.18) : 0;
}

interface Props {
  /** scene: 小窓いっぱいの背景 / portrait: 一覧などの小さな枠 (キャラを中心に切り取る) */
  framing?: "scene" | "portrait";
  /** 話している間、口を動かす */
  speaking?: boolean;
  /** 変わるたびに「通知が届いた」動きをする */
  notifyKey?: unknown;
  /** 止まった絵にする (一覧のサムネイルなど、よく目に入る場所) */
  still?: boolean;
  className?: string;
}

export function LiveCharacter({ framing = "scene", speaking = false, notifyKey, still = false, className }: Props) {
  const reduce = useReducedMotion();
  const p = usePose({ live: !still && !reduce, speaking, notifyKey });
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => uid + "-" + name;
  const url = (name: string) => "url(#" + id(name) + ")";

  // 目は高さを縮めて閉じる。うれしい時は下から少し押し上げる
  const eye = (cx: number) => {
    const w = 13, h = 22;
    const sy = Math.max(0.1, (1 - 0.9 * p.lid) * (1 - 0.28 * p.cheek));
    const x = cx + p.lookX;
    const eh = h * sy;
    // 閉じる時は真ん中より少し下へ (下まぶたも少し上がる)。目を細める時は下だけ上がる。重なる時は混ぜる
    const anchor = (0.55 * p.lid + 0.15 * p.cheek) / (p.lid + p.cheek + 1e-6);
    const top = 81 + p.lookY + (h - eh) * anchor;
    return (
      <g key={cx}>
        <rect x={x - w / 2} y={top} width={w} height={eh} rx={Math.min(w / 2, eh / 2)} fill="#2a2340" />
        {p.lid < 0.6 && <circle cx={x - 2 - p.lookX * 0.15} cy={top + eh * 0.27} r={2.6 * (1 - p.lid)} fill="#fff" />}
      </g>
    );
  };

  // 口: 上の線は笑顔の弧のまま、下の線が下がって開く。閉じている時は2本が重なって1本の弧に見える
  const m = p.mouth;
  const mx = p.lookX * 0.7;
  const x1 = 87 + m * 2 + mx, x2 = 113 - m * 2 + mx, y0 = 112 + p.lookY * 0.5;
  const mouthPath = "M" + x1 + " " + y0 + "Q" + (100 + mx) + " " + (y0 + 8 - 3 * m) + " " + x2 + " " + y0 + "Q" + (100 + mx) + " " + (y0 + 8 + 15 * m) + " " + x1 + " " + y0 + "Z";

  // 体は下端の中央を支点に傾き、呼吸で縦に伸びた分だけ横を細める (体積を保つ)
  const kx = 1 / Math.pow(p.sy, 0.6);
  const body = "translate(0 " + -p.lift + ") rotate(" + p.tilt + " 100 160) translate(100 160) scale(" + kx + " " + p.sy + ") translate(-100 -160)";
  const shadow = 1 - p.lift / 220;
  const cheekR = 1 + 0.15 * p.cheek;

  return (
    <svg
      viewBox={framing === "scene" ? "0 0 340 500" : "35 10 270 270"}
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: INK.sky[0] }} />
          <stop offset="0.55" style={{ stopColor: INK.sky[1] }} />
          <stop offset="1" style={{ stopColor: INK.sky[2] }} />
        </linearGradient>
        <radialGradient id={id("halo")} cx="170" cy="140" r="150" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* 体としっぽは同じ座標のグラデーションにして、重なりの境目を見せない */}
        <radialGradient id={id("body")} cx="70" cy="58" r="160" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: INK.body[0] }} />
          <stop offset="0.42" style={{ stopColor: INK.body[1] }} />
          <stop offset="0.82" style={{ stopColor: INK.body[2] }} />
          <stop offset="1" style={{ stopColor: INK.body[3] }} />
        </radialGradient>
        <radialGradient id={id("gloss")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("dot")} cx="154" cy="27" r="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: INK.dot[0] }} />
          <stop offset="0.55" style={{ stopColor: INK.dot[1] }} />
          <stop offset="1" style={{ stopColor: INK.dot[2] }} />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="340" height="500" fill={url("sky")} />
      <circle cx="170" cy="140" r="150" fill={url("halo")} />
      {SPARKLES.map((s, i) => {
        const r = s.size * sparkle(p.t, s.phase);
        if (r <= 0.05) return null;
        return (
          <path
            key={i}
            d={"M" + s.x + " " + (s.y - r) + "Q" + s.x + " " + s.y + " " + (s.x + r) + " " + s.y + "Q" + s.x + " " + s.y + " " + s.x + " " + (s.y + r) + "Q" + s.x + " " + s.y + " " + (s.x - r) + " " + s.y + "Q" + s.x + " " + s.y + " " + s.x + " " + (s.y - r) + "Z"}
            fill="#ffffff"
          />
        );
      })}

      <g transform="translate(58 26) scale(1.12)">
        {/* 影は床に残り、浮いた分だけ小さくなる */}
        <ellipse cx="100" cy="190" rx={54 * shadow} ry={7 * shadow} style={{ fill: INK.shadow }} opacity="0.16" />
        <g transform={body}>
          {/* しっぽ: 根元を支点に、体より少し遅れて揺れる。体の下に描いて、つなぎ目を体で隠す */}
          <path d="M46 126C48 150 42 166 26 180C50 178 68 167 80 150Z" fill={url("body")} transform={"rotate(" + p.tail + " 62 140)"} />
          <path d="M100 30C157 30 176 46 176 94C176 142 157 158 100 158C43 158 24 142 24 94C24 46 43 30 100 30Z" fill={url("body")} />
          <ellipse cx="68" cy="56" rx="34" ry="17" fill={url("gloss")} transform="rotate(-18 68 56)" />
          {/* 顔は視線の向きへ少し寄る (頬は目より少なく) */}
          <ellipse cx={63 + p.lookX * 0.6} cy={110 + p.lookY * 0.5} rx={9 * cheekR} ry={5 * cheekR} fill="#ff8fbf" opacity="0.5" />
          <ellipse cx={137 + p.lookX * 0.6} cy={110 + p.lookY * 0.5} rx={9 * cheekR} ry={5 * cheekR} fill="#ff8fbf" opacity="0.5" />
          {eye(76)}
          {eye(124)}
          <path d={mouthPath} fill="#2a2340" stroke="#2a2340" strokeWidth="4.2" strokeLinejoin="round" strokeLinecap="round" />
          {/* 通知の点: 体の角について、傾きに少し遅れてついてくる */}
          <g transform={"rotate(" + p.dotTurn + " 150 48) translate(158 34) scale(" + p.dotScale + ") translate(-158 -34)"}>
            <circle cx="158" cy="34" r="17" fill={url("dot")} />
            <ellipse cx="152" cy="27" rx="6" ry="4" fill="#fff" opacity="0.6" transform="rotate(-30 152 27)" />
          </g>
        </g>
      </g>
    </svg>
  );
}
