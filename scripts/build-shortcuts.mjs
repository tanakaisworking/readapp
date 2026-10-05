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

// MAS版用: 通知オートメーション (トリガー「通知」＋「readappで読み上げる」＋「通知」変数の接続済み)。
// 読み込んだオートメーションは最初オフなので、ユーザーがショートカットの一覧でオンにする。
// ショートカットの名前はファイル名になる。macOSのファイル名は濁点が分解形になり、
// 名前で探す時 (shortcuts list / shortcuts://open-shortcut) に一致しなくなるため、濁点・半濁点を含めない。
const automationDir = join(root, "src-tauri/resources/automation");
mkdirSync(automationDir, { recursive: true });
const READAPP = { BundleIdentifier: "com.hibachi.readapp", Name: "readapp", TeamIdentifier: "TYX92DB6TA" };

// 汎用: 通知元は readapp 自身だけ。ユーザーが「＋」で読み上げたいアプリを足す (想定外のアプリ用)。
// readappのテスト通知で、設定が一巡するかを確かめられる。
writeAutomation(join(automationDir, "readapp通知.shortcut"), [READAPP]);

// アプリ別: 通知元はそのアプリだけ (readappは入れない。テスト通知で全部が一斉に動かないように)。
// アプリ名はそのアプリの名前を固定で渡す (通知の「アプリ」は空で届く通知があるため)。
// カタログの mac が空のアプリ (カレンダー: 通知の中身がショートカットに渡らない) は作らない。
// 未インストールのアプリが入っていると、ショートカット側の表示が崩れ「＋」も効かなくなるため、
// バンドルIDごとに1ファイル作り、アプリ側で入っているものを選んで開く。
for (const app of catalog.apps) {
  for (const mac of app.mac ?? []) {
    const dir = join(automationDir, "apps", mac.bundleId);
    mkdirSync(dir, { recursive: true });
    writeAutomation(
      join(dir, `readapp通知-${app.id}.shortcut`),
      [{ BundleIdentifier: mac.bundleId, Name: app.name, TeamIdentifier: mac.teamId }],
      app.name,
    );
  }
}

/// appName を渡すとアプリ名は固定、省くと通知の「アプリ」をつなぐ (汎用のひな形)。
function writeAutomation(out, selectedApps, appName) {
  const automation = {
    WFWorkflowClientVersion: "3000",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowIcon: { WFWorkflowIconStartColor: 4274264319, WFWorkflowIconGlyphNumber: 59446 },
    WFWorkflowTypes: [],
    WFWorkflowInputContentItemClasses: ["WFStringContentItem"],
    WFWorkflowTriggers: [
      {
        WFTriggerIdentifier: "WFNotificationTrigger",
        WFTriggerUUID: randomUUID().toUpperCase(),
        WFTriggerSerializedParameters: {
          SelectedApps: selectedApps.length === 1 ? selectedApps[0] : selectedApps,
        },
      },
    ],
    WFWorkflowActions: [
      {
        WFWorkflowActionIdentifier: "com.hibachi.readapp.SpeakIntent",
        WFWorkflowActionParameters: {
          // テキストは通知の「タイトル・サブタイトル・本文」を改行でつなぐ。
          // 「通知」を丸ごと文字列にすると、カレンダー等では空になる (macOS 27.0.1 で確認)。
          // アプリ名には通知の「アプリ」をつなぐ。
          text: notificationText(["Title", "Subtitle", "Body"]),
          appName: appName ?? notificationText(["App"]),
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
  const json = `${out}.unsigned.json`;
  const unsigned = out.replace(/\.shortcut$/, ".unsigned.shortcut");
  writeFileSync(json, JSON.stringify(automation));
  execFileSync("plutil", ["-convert", "binary1", "-o", unsigned, json]);
  unlinkSync(json);
  signShortcut(unsigned, out);
}

/// トリガー「通知」の項目 (例: "Title", "App") を改行でつないだテキスト。
/// 形式は macOS 27 のショートカットで実際に設定して保存されたものと同じ
/// (WFTextTokenString。差し込み位置ごとに TriggerOutput＋PropertyName を置く)。
function notificationText(properties) {
  const attachmentsByRange = {};
  properties.forEach((property, i) => {
    // 「￼\n」の並びで、i番目の差し込み位置は 2*i
    attachmentsByRange[`{${2 * i}, 1}`] = {
      Type: "TriggerOutput",
      TriggerIdentifier: "WFNotificationTrigger",
      Aggrandizements: [{ Type: "WFPropertyVariableAggrandizement", PropertyName: property }],
    };
  });
  return {
    Value: { attachmentsByRange, string: properties.map(() => "\ufffc").join("\n") },
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
