import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

// オートメーションのスイッチは、ショートカットの「オートメーション」一覧にしかない (編集画面では切り替えられない)。
// 一覧を直接開くURLは無く、サンドボックスからキー操作も送れないため、
// ショートカットを前面に出し、一覧へ切り替えるキー (表示 > オートメーション = ⌥⇧⌘A) を案内する。
// キーは macOS 27.0.1 のショートカットのメニューで確認 (2026-10-06)。

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-card px-1 font-sans text-[11px] font-medium text-foreground shadow-[0_1px_0_rgba(41,39,45,0.15)]">
      {children}
    </kbd>
  );
}

export function AutomationListHint() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="mt-2.5 rounded-md bg-surface-muted p-2.5 text-xs leading-relaxed text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void invoke("open_shortcuts_app")
              .then(() => setFailed(false))
              .catch(() => setFailed(true))
          }
        >
          <ExternalLink />
          ショートカットを開く
        </Button>
        <span className="inline-flex items-center gap-1" aria-label="開いたら option shift command A でオートメーション一覧へ">
          開いたら
          <Kbd>⌥</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>⌘</Kbd>
          <Kbd>A</Kbd>
          で一覧へ
        </span>
      </div>
      <p className="mt-1.5">
        編集画面ではオンにできません。メニューの「表示」→「オートメーション」でも一覧を開けます。
      </p>
      {failed && (
        <p className="mt-1" role="alert">
          開けませんでした。Launchpadから「ショートカット」を開いてください。
        </p>
      )}
    </div>
  );
}
