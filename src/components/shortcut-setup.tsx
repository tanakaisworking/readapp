import { useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

// MAS版の通知の受け取り方: 同梱のひな形 (通知オートメーション＋「readappで読み上げる」) を
// ショートカットに追加し、対象アプリを選んでオンにする。
// 手順は macOS 27 のショートカットで実際に読み込んで確認した操作どおり (2026-10-06)。
const STEPS = [
  "「ショートカットに追加」を押し、「ショートカットを追加」を選ぶ",
  "追加された「readapp通知読み上げ」を開き、「アプリ」で読み上げたいアプリを選ぶ（「＋」で複数選べます）",
  "ショートカットの「オートメーション」で「readapp通知読み上げ」をオンにする",
];

export function ShortcutSetup() {
  const [error, setError] = useState<string | null>(null);
  const run = async (command: "add_notify_automation" | "open_shortcuts_app") => {
    try {
      await invoke(command);
      setError(null);
    } catch {
      setError(
        command === "add_notify_automation"
          ? "ひな形を開けませんでした。アプリを入れ直してください。"
          : "開けませんでした。Launchpadから「ショートカット」を開いてください。",
      );
    }
  };

  return (
    <div>
      <ol className="space-y-3 text-[13px] leading-relaxed">
        {STEPS.map((text, i) => (
          <li key={text} className="flex gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">
              {i + 1}
            </span>
            {text}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        あとは選んだアプリに通知が来るたびに、readappが読み上げます。
      </p>
      <Button className="mt-3 w-full" onClick={() => void run("add_notify_automation")}>
        <Plus className="h-4 w-4" />
        ショートカットに追加
      </Button>
      <Button className="mt-2 w-full" variant="outline" onClick={() => void run("open_shortcuts_app")}>
        <ExternalLink className="h-4 w-4" />
        ショートカットを開く
      </Button>
      {error && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
