import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

// オートメーションのスイッチは、ショートカットの「オートメーション」一覧にしかない (編集画面では切り替えられない)。
// 一覧を直接開くURLは無く、サンドボックスからキー操作も送れないため、
// ショートカットを前面に出し、一覧へ切り替えるキーを案内する。
// 編集画面が前面だと「表示 > オートメーション」(⌥⇧⌘A) は無効なので、先に「ウインドウ > ライブラリ」(⌘0) でメインの画面へ戻す。
// キーと有効・無効は macOS 27.0.1 のショートカットで確認 (2026-10-06)。

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="kbd kbd-xs">
      {children}
    </kbd>
  );
}

export function AutomationListHint() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="mt-2.5 rounded-field bg-base-200 p-2.5 text-xs leading-relaxed text-muted">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            void invoke("open_shortcuts_app")
              .then(() => setFailed(false))
              .catch(() => setFailed(true))
          }
        >
          <ExternalLink />
          ショートカットを開く
        </button>
        <span
          className="inline-flex flex-wrap items-center gap-1"
          aria-label="開いたら command 0 を押してから option shift command A でオートメーション一覧へ"
        >
          開いたら
          <Kbd>⌘</Kbd>
          <Kbd>0</Kbd>
          →
          <Kbd>⌥</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>⌘</Kbd>
          <Kbd>A</Kbd>
          で一覧へ
        </span>
      </div>
      <p className="mt-1.5">
        編集画面ではオンにできません。⌘0 でメインの画面に戻り、⌥⇧⌘A（メニューの「表示」→「オートメーション」）で一覧を開きます。
      </p>
      {failed && (
        <p className="mt-1" role="alert">
          開けませんでした。Launchpadから「ショートカット」を開いてください。
        </p>
      )}
    </div>
  );
}
