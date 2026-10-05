import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

// 「試しに喋る」: 入力した文で readapp 自身が通知を出し、それを受け取って読み上げる。
// 通知 → (MAS: ショートカットの「readapp通知」/ dmg: 直接監視) → 変換 → 読み上げ の実経路をまるごと試す。
// 届かなければ理由を出し、直接喋らせることもできる。macOS以外は直接喋らせる。

const TEXT_KEY = "readapp.trySpeakText";
const DEFAULT_TEXT = "Claudeの作業が終わりました。";
/** 通知が一巡するのを待つ時間 (変換の初回は数秒かかることがある) */
const WAIT_MS = 10000;
/** 受け取った直後の送り直しを止める時間。同じ文が2秒以内に続くと重複として読まれないため */
const COOLDOWN_MS = 2500;

type Status = "idle" | "sending" | "waiting" | "received" | "missed";

function loadText(): string {
  try {
    return localStorage.getItem(TEXT_KEY) || DEFAULT_TEXT;
  } catch {
    return DEFAULT_TEXT;
  }
}

async function readappCount(): Promise<number> {
  const apps = await invoke<{ id: string; count: number }[]>("get_observed_apps").catch(() => []);
  return apps.find((a) => a.id === "readapp")?.count ?? 0;
}

interface Props {
  platform: string;
  edition: string;
  /** 通知を使わずに直接喋らせる */
  onDirect: (text: string) => void;
}

export function TrySpeak({ platform, edition, onDirect }: Props) {
  const [text, setText] = useState(loadText);
  const [status, setStatus] = useState<Status>("idle");
  const [cooling, setCooling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
    },
    [],
  );

  const change = (v: string) => {
    setText(v);
    try {
      localStorage.setItem(TEXT_KEY, v);
    } catch {
      /* 保存できなくても使える */
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy.current || cooling) return;
    // 通知の仕組みはmacOSのみ。ほかは直接喋らせる
    if (platform !== "macos") {
      onDirect(body);
      return;
    }
    busy.current = true; // 許可の確認待ちの間も二重に送らない
    setStatus("sending");
    setError(null);
    const before = await readappCount();
    try {
      await invoke("send_test_notification", { text: body });
    } catch (e) {
      busy.current = false;
      setStatus("idle");
      setError(
        e === "denied"
          ? "readappの通知がオフです。システム設定の「通知」で readapp を許可すると、通知として試せます。"
          : "通知を出せませんでした。",
      );
      return;
    }
    setStatus("waiting");
    const started = Date.now();
    const poll = async () => {
      // 送る前より受信回数が増えたら今回の通知が届いた (同じ秒の古い受信と取り違えない)
      const done = (await readappCount()) > before;
      if (done || Date.now() - started > WAIT_MS) {
        busy.current = false;
        setStatus(done ? "received" : "missed");
        if (done) {
          setCooling(true);
          timers.current.push(setTimeout(() => setCooling(false), COOLDOWN_MS));
        }
        return;
      }
      timers.current.push(setTimeout(() => void poll(), 500));
    };
    void poll();
  };

  const locked = status === "sending" || status === "waiting" || cooling;

  return (
    <div className="mt-3">
      <label className="block">
        <span className="text-xs text-muted-foreground">通知の文</span>
        <input
          value={text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void send()}
          maxLength={200}
          className="mt-1 h-9 w-full rounded-md bg-surface-muted px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50"
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={() => void send()} disabled={!text.trim() || locked}>
          <Play className="h-3.5 w-3.5" />
          試しに喋る
        </Button>
        <span className="text-xs text-muted-foreground" role="status">
          {status === "sending" && "通知を出しています…"}
          {status === "waiting" && "通知を出しました。届くのを待っています…"}
          {status === "received" && "通知が届きました。"}
        </span>
      </div>
      {(status === "missed" || error) && (
        <div className="mt-2 rounded-lg bg-surface-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground" role="alert">
          <p>
            {error ??
              (edition === "mas"
                ? "通知が readapp に届きませんでした。ショートカット「readapp通知」がオンか確かめてください。まだなら「読み上げるアプリ」の「ほかのアプリを読み上げる」から追加できます。"
                : "通知が readapp に届きませんでした。「直接監視」を許可しているか確かめてください。")}
          </p>
          <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => onDirect(text.trim())}>
            通知なしで喋らせる
          </Button>
        </div>
      )}
    </div>
  );
}
