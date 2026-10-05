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
import { randomUUID } from "node:crypto";

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
  writeFileSync(unsigned, shortcut);
  signShortcut(unsigned, join(outDir, `readapp-${app.id}.shortcut`));
}

// MAS版用: 通知オートメーションのひな形 (トリガー＋「readappで読み上げる」＋「通知」変数の接続済み)。
// 読み込んだ後にユーザーが「＋」で読み上げたいアプリを足し、オートメーションをオンにすれば使える。
// ショートカットの名前はファイル名になる。macOSのファイル名は濁点が分解形になり、
// 名前で探す時 (shortcuts list / shortcuts://open-shortcut) に一致しなくなるため、濁点・半濁点を含めない。
const automationDir = join(root, "src-tauri/resources/automation");
mkdirSync(automationDir, { recursive: true });
const automation = {
  WFWorkflowClientVersion: "3000",
  WFWorkflowMinimumClientVersion: 900,
  WFWorkflowIcon: { WFWorkflowIconStartColor: 4274264319, WFWorkflowIconGlyphNumber: 59446 },
  WFWorkflowTypes: [],
  WFWorkflowInputContentItemClasses: ["WFStringContentItem"],
  // 通知元には最初から readapp 自身を入れておく。readappのテスト通知で、設定が一巡するかを確かめられる。
  WFWorkflowTriggers: [
    {
      WFTriggerIdentifier: "WFNotificationTrigger",
      WFTriggerUUID: randomUUID().toUpperCase(),
      WFTriggerSerializedParameters: {
        SelectedApps: { BundleIdentifier: "com.hibachi.readapp", Name: "readapp", TeamIdentifier: "TYX92DB6TA" },
      },
    },
  ],
  WFWorkflowActions: [
    {
      WFWorkflowActionIdentifier: "com.hibachi.readapp.SpeakIntent",
      WFWorkflowActionParameters: {
        // 「通知」変数 (トリガーの出力) をテキストに、その「アプリ」をアプリ名につなぐ
        text: notificationVariable(),
        appName: notificationVariable("App"),
        AppIntentDescriptor: {
          BundleIdentifier: "com.hibachi.readapp",
          Name: "readapp",
          AppIntentIdentifier: "SpeakIntent",
          TeamIdentifier: "TYX92DB6TA",
        },
        UUID: randomUUID().toUpperCase(),
      },
    },
  ],
};
const automationJson = join(automationDir, "automation.unsigned.json");
const automationUnsigned = join(automationDir, "readapp通知.unsigned.shortcut");
writeFileSync(automationJson, JSON.stringify(automation));
execFileSync("plutil", ["-convert", "binary1", "-o", automationUnsigned, automationJson]);
unlinkSync(automationJson);
signShortcut(automationUnsigned, join(automationDir, "readapp通知.shortcut"));

/// トリガー「通知」の出力を差し込む変数。property を渡すとその項目だけ (例: "App")。
/// 形式は macOS 27 のショートカットで実際に設定して保存されたものと同じ。
function notificationVariable(property) {
  const attachment = { Type: "TriggerOutput", TriggerIdentifier: "WFNotificationTrigger" };
  if (property) {
    attachment.Aggrandizements = [{ Type: "WFPropertyVariableAggrandizement", PropertyName: property }];
  }
  return {
    Value: { attachmentsByRange: { "{0, 1}": attachment }, string: "\ufffc" },
    WFSerializationType: "WFTextTokenString",
  };
}

/// 未署名ファイルは取り込めないため、その場で署名する (要Apple IDサインイン)。
/// Apple側の500エラーが出ることがあるため3回まで再試行する。
function signShortcut(unsigned, out) {
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
    console.error(`FAILED to sign ${out}`);
    process.exitCode = 1;
    return;
  }
  console.log(`wrote ${out}`);
}
