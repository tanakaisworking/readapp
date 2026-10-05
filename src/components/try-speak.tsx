import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

// 「試しに喋る」: 入力した文で readapp 自身が通知を出し、それを受け取って読み上げる。
// 通知 → (MAS: ショートカットの「readapp通知」/ dmg: 直接監視) → 変換 → 読み上げ の実経路をまるごと試す。
// 届かなければ理由を出し、直接喋らせることもできる。

const TEXT_KEY = "readapp.trySpeakText";
const DEFAULT_TEXT = "Claudeの作業が終わりました。";
/** 通知が一巡するのを待つ時間 (変換の初回は数秒かかることがある) */
const WAIT_MS = 10000;

type Status = "idle" | "waiting" | "received" | "missed";

function loadText(): string {
  try {
    return localStorage.getItem(TEXT_KEY) || DEFAULT_TEXT;
  } catch {
    return DEFAULT_TEXT;
  }
}

interface Props {
  edition: string;
  /** 通知を使わずに直接喋らせる */
  onDirect: (text: string) => void;
}

export function TrySpeak({ edition, onDirect }: Props) {
  const [text, setText] = useState(loadText);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

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
    if (!body || status === "waiting") return;
    setError(null);
    const sentAt = Math.floor(Date.now() / 1000);
    try {
      await invoke("send_test_notification", { text: body });
    } catch (e) {
      setStatus("idle");
      setError(
        e === "denied"
          ? "readappの通知がオフです。システム設定の「通知」で readapp を許可してください。"
          : "通知を出せませんでした。もう一度お試しください。",
      );
      return;
    }
    setStatus("waiting");
    const started = Date.now();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const apps = await invoke<{ id: string; at: number | null }[]>("get_observed_apps").catch(() => []);
      const at = apps.find((a) => a.id === "readapp")?.at;
      const done = at != null && at >= sentAt;
      if (done || Date.now() - started > WAIT_MS) {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setStatus(done ? "received" : "missed");
      }
    }, 500);
  };

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
        <Button size="sm" onClick={() => void send()} disabled={!text.trim() || status === "waiting"}>
          <Play className="h-3.5 w-3.5" />
          試しに喋る
        </Button>
        <span className="text-xs text-muted-foreground" role="status">
          {status === "waiting" && "通知を出しました。届くのを待っています…"}
          {status === "received" && "通知が届きました。"}
        </span>
      </div>
      {status === "missed" && (
        <div className="mt-2 rounded-lg bg-surface-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground" role="alert">
          <p>
            通知が readapp に届きませんでした。
            {edition === "mas"
              ? "「読み上げるアプリ」の「ほかのアプリを読み上げる」で、ショートカット「readapp通知」を追加してオンにすると届きます。"
              : "「直接監視」を許可しているか確かめてください。"}
          </p>
          <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => onDirect(text.trim())}>
            通知なしで喋らせる
          </Button>
        </div>
      )}
      {error && (
        <p className="mt-2 text-xs text-muted-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
