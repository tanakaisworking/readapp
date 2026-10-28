// 動くキャラのためのモーションエンジン (rossark-motion-skill の templates/react-native/motion.ts をWeb向けにしたもの)。
// 動くものはすべて1つの時計の時刻から計算する。値はキーフレームと少しの補助関数で作る。
// 使い方の決まりは src/components/MOTION.md。

/** CSS の cubic-bezier と同じ曲線 */
function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let s = p;
    for (let i = 0; i < 6; i++) {
      const d = slopeX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= (sampleX(s) - p) / d;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 20 && Math.abs(sampleX(s) - p) > 1e-5; i++) {
      if (sampleX(s) < p) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

/** 移動するもの (視線・傾き・まぶたが閉じる) */
export const EASE_IN_OUT = bezier(0.77, 0, 0.175, 1);
/** 開くもの・届くもの (口・まぶたが開く・現れる) */
export const EASE_OUT = bezier(0.23, 1, 0.32, 1);

/** キーフレーム: 時刻 (ms)、値、そこへ向かう区間の曲線 ('out' か、既定の ease-in-out) */
export type Key = readonly [number, number, "out"?];
export type Keys = readonly Key[];

/** キーフレームの値。各キーで止まるので、1つの動き (まばたき・口) に使う。ループは最後のキーを最初と同じにする */
export function track(t: number, keys: Keys): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t <= k1[0]) {
      const k0 = keys[i - 1];
      const span = k1[0] - k0[0];
      const p = span > 0 ? (t - k0[0]) / span : 1;
      return k0[1] + (k1[1] - k0[1]) * (k1[2] === "out" ? EASE_OUT(p) : EASE_IN_OUT(p));
    }
  }
  return keys[keys.length - 1][1];
}

/** 姿勢をつなぐ滑らかな線 (単調な3次補間)。キーで止まらず、行き過ぎもしない。演技 (体の傾き・視線の移り) に使う */
export function flow(t: number, k: readonly (readonly [number, number])[]): number {
  const n = k.length;
  if (t <= k[0][0]) return k[0][1];
  if (t >= k[n - 1][0]) return k[n - 1][1];
  let i = 0;
  while (k[i + 1][0] < t) i++;
  const slope = (j: number) => (k[j + 1][1] - k[j][1]) / (k[j + 1][0] - k[j][0]);
  const tangent = (j: number) => {
    if (j === 0 || j === n - 1) return 0;
    const a = slope(j - 1), b = slope(j);
    if (a * b <= 0) return 0;
    const h0 = k[j][0] - k[j - 1][0], h1 = k[j + 1][0] - k[j][0];
    const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
    return (w0 + w1) / (w0 / a + w1 / b);
  };
  const h = k[i + 1][0] - k[i][0];
  const s = (t - k[i][0]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * k[i][1] + (s3 - 2 * s2 + s) * h * tangent(i) + (-2 * s3 + 3 * s2) * k[i + 1][1] + (s3 - s2) * h * tangent(i + 1);
}

/** 時計の区間 [a, b] の中で 0 → 1 (前は0、後は1)。一度きりの動きの1拍 */
export function seg(t: number, a: number, b: number, curve: "out" | "inOut" = "out"): number {
  if (t <= a) return 0;
  if (t >= b) return 1;
  const p = (t - a) / (b - a);
  return curve === "out" ? EASE_OUT(p) : EASE_IN_OUT(p);
}

/** -1 から 1 の滑らかな往復。phase (0〜1) でずらす */
export function wave(t: number, period: number, phase = 0): number {
  return Math.sin((t / period + phase) * Math.PI * 2);
}

/** ループの進み具合 0〜1 */
export function loop(t: number, period: number, phase = 0): number {
  const p = (t / period + phase) % 1;
  return p < 0 ? p + 1 : p;
}

/** 両端で0、真ん中で1。現れて消えるもの */
export function bell(p: number): number {
  return Math.sin(Math.PI * Math.min(1, Math.max(0, p)));
}

/** 項目 i ごとに決まった 0〜1 の値 (毎回同じばらつき) */
export function seeded(i: number, salt = 0): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}
