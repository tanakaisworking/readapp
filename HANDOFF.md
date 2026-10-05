# readapp 引き継ぎメモ

最終更新: 2026-10-05

## これは何か

PC通知をキャラ口調で読み上げる常駐アプリ (Tauri 2 + React + Rust)。
設計は README.md / DESIGN.md / UXVISION.md。

## 動かし方

```sh
npm install
npm run build:helper      # Swift変換ヘルパー (macOS)
npm run build:shortcuts   # 配布ショートカット生成＋署名 (要Apple IDサインイン)
npm run tauri dev         # 開発起動
npm run build:dmg         # リリースビルド (Tauriが署名するのでdmg内appもDeveloper ID署名)
npm run sign:local        # 再署名のみ
npm run build:win         # Windows用 (Windows上で完結、macOSでは検証のみ)
npm run package:mas       # MAS用 .pkg (要profile)。手元確認は -- --local (サンドボックス版をDeveloper ID署名)
```

検証: `cargo test` (15件) / `cargo check` / `npm run build`。
Windows型検査は別途 `/tmp/wcheck` 手順（このMacには残っていない。 Archived: windowsクレート+対象コードを別クレートにincludeして `cargo check --target x86_64-pc-windows-msvc`）。

## 動作確認済み

- URLスキーム受信→変換→発声 (macOS, 約2秒)
- 配布ショートカットの実行→発声 (macOS)
- 設定永続化、声の列挙・指名、キャラ一元化
- observerの両プロセス登録成功、Accessibility許可取得済み (Team TYX92DB6TA 署名)

- AX直接監視の実バナー取得→発声 (macOS 27.0.1、リマインダー・Spark実通知で確認。#1は解消)
  - バナーは NotificationCenter の AXSystemDialog 窓内 `AXNotificationCenterBanner/Alert(Stack)` 要素。0.7秒間隔で走査
  - 起動時に出ていた通知と、一度に3件以上現れた分 (通知センター履歴とみなす) は読まない

- 画面と挙動の一致: 未設定はカタログ (catalog.json) のアプリだけON、見つけたアプリは追加するまで読まない。
  設定キーは表示名から `notifications::app_id_for` で作る (NFC正規化済み、macOS/Windows共通)

- MAS版: ショートカットの部品「readappで読み上げる」(App Intents) とひな形オートメーションで、通知→読み上げをサンドボックス内で確認
  - ひな形の再生成は `npm run build:shortcuts` (要Apple IDサインイン)。部品の検証手順は poc/appintents/README.md
  - dmg版にも部品は入る。直接監視と二重に届いた同じ通知は20秒以内なら1回だけ読む

## 未解決 (Issue)

- #2 Windows実機検証
- #3 MAS配布の残作業
- #4 Shortcuts自動化の未確定2点
- #5 Premium音声バックエンド
- #6 デザイン調整リスト（指摘待ち）

## 注意

- 再ビルド後は `sign:local` を忘れずに（署名が変わるとアクセシビリティ許可が外れる）
- `src-tauri/binaries/` と `.unsigned.shortcut` は生成物（gitignore済み）
- 配布 `.shortcut` 6件は署名済みでコミット済み（再生成で署名し直し）
- レビュー修正ループはR1-R3対応済み、R4は手段空振りで中断（残課題は#1等へ移管）
