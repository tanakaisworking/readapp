# readapp 引き継ぎメモ

最終更新: 2026-10-04 / main: `afa138c`

## これは何か

PC通知をキャラ口調で読み上げる常駐アプリ (Tauri 2 + React + Rust)。
設計は README.md / DESIGN.md / UXVISION.md。

## 動かし方

```sh
npm install
npm run build:helper      # Swift変換ヘルパー (macOS)
npm run build:shortcuts   # 配布ショートカット生成＋署名 (要Apple IDサインイン)
npm run tauri dev         # 開発起動
npm run build:dmg         # リリースビルド＋Developer ID署名
npm run sign:local        # 再署名のみ
npm run build:win         # Windows用 (Windows上で完結、macOSでは検証のみ)
npm run package:mas       # MAS用 (要profile＋証明書)
```

検証: `cargo test` (15件) / `cargo check` / `npm run build`。
Windows型検査は別途 `/tmp/wcheck` 手順（このMacには残っていない。 Archived: windowsクレート+対象コードを別クレートにincludeして `cargo check --target x86_64-pc-windows-msvc`）。

## 動作確認済み

- URLスキーム受信→変換→発声 (macOS, 約2秒)
- 配布ショートカットの実行→発声 (macOS)
- 設定永続化、声の列挙・指名、キャラ一元化
- observerの両プロセス登録成功、Accessibility許可取得済み (Team TYX92DB6TA 署名)

## 未解決 (Issue)

- #1 AX直接監視が実バナーを拾えない（最優先・dmg核心）
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
