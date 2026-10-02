// readapp用ショートカット (.shortcut) の生成スクリプト。
// アプリごとに通知本文→ readapp://notify URLを開くショートカットを作る。
// カタログの正本は src/lib/catalog.json (フロントと共有)。
//
// 使い方: npm run build:shortcuts
// 出力: src-tauri/resources/shortcuts/readapp-<id>.shortcut

import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { actionOutput, withVariables } = require("@joshfarrant/shortcuts-js");
const { buildShortcutTemplate } = require("@joshfarrant/shortcuts-js/build/utils/buildShortcutTemplate");
const { encodeShortcut } = require("@joshfarrant/shortcuts-js/build/utils/encodeShortcut");
const {
  getTextFromInput,
  URLEncode,
  text,
  openURLs,
} = require("@joshfarrant/shortcuts-js/actions");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "src/lib/catalog.json"), "utf8"));
const outDir = join(root, "src-tauri/resources/shortcuts");
mkdirSync(outDir, { recursive: true });

for (const app of catalog.apps) {
  const encoded = actionOutput();
  // withVariablesは変数だけを受け付けるため、静的部分は文字列配列で渡す
  const urlTemplate = withVariables([`readapp://notify?app=${app.id}&body=`, ""], encoded);
  const actions = [
    // 通知オートメーションからの入力本文を取り出す
    getTextFromInput({}),
    // URLに含められるようパーセントエンコード
    URLEncode({ encodeMode: "Encode" }, encoded),
    // readapp受け口のURLを組み立てる (app idは焼き込み)
    text({ text: urlTemplate }),
    // readappを開く
    openURLs(),
  ];
  const template = buildShortcutTemplate(
    actions,
    { icon: { color: 4274264319, glyph: 59446 }, showInWidget: true },
  );
  // 検出用に固定名を付ける (`shortcuts list` で突き合わせる)
  template.WFWorkflowName = `readapp-${app.id}`;
  const shortcut = encodeShortcut(template);
  const unsigned = join(outDir, `readapp-${app.id}.unsigned.shortcut`);
  const out = join(outDir, `readapp-${app.id}.shortcut`);
  writeFileSync(unsigned, shortcut);
  // 未署名ファイルは取り込めないため、その場で署名する (要Apple IDサインイン)。
  // Apple側の500エラーが出ることがあるため3回まで再試行する。
  let signed = false;
  for (let attempt = 1; attempt <= 3 && !signed; attempt++) {
    try {
      execFileSync("shortcuts", ["sign", "--mode", "anyone", "--input", unsigned, "--output", out]);
      signed = true;
    } catch (e) {
      if (attempt < 3) {
        execFileSync("sleep", ["5"]);
      }
    }
  }
  unlinkSync(unsigned);
  if (!signed) {
    console.error(`FAILED to sign readapp-${app.id}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`wrote ${out}`);
}
