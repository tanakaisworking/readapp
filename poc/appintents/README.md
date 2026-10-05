# App Intents 組み込み検証 (2026-10-05)

MAS版で「配布ショートカット＋URLスキーム」をやめ、ショートカットの部品「readappで読み上げる」を
アプリ自身が提供できるかの検証。**Xcodeプロジェクトなし (Tauri同様のRust実行ファイル) で成立した。**

## 結果
| 項目 | 結果 |
|---|---|
| 通知オートメーションが確認なしで動く | ○ 通知から73msで発火、裏で実行 |
| 1つのオートメーションで複数アプリ指定 | ○ アプリ欄の「＋」で追加できる |
| 通知の中身を変数で渡す | ○ 「通知」変数をそのまま使える |
| Rust実行ファイル＋Swift静的ライブラリでApp Intentsを提供 | ○ ショートカットに部品登録、実行でRust関数が呼ばれた |
| フォーカスを奪わない | ○ 前面アプリは変わらない (URLスキーム方式は前面に出る) |
| アプリ停止中 | ○ 裏で自動起動して実行 |
| 初回の許可 | △ 「<ショートカット>が<アプリ>からアクションを実行することを許可しますか？」が初回だけ出る |

## 手順 (Tauriへ組み込む時もこの流れ)
1. Swift (`Intents.swift`) を静的ライブラリ化し、同時に const values を出す
   ```
   swiftc -parse-as-library -module-name ReadappIntents -target arm64-apple-macos15.0 -sdk $(xcrun --show-sdk-path) \
     -O -wmo -emit-library -static -o libReadappIntents.a Intents.swift \
     -emit-const-values -Xfrontend -const-gather-protocols-file -Xfrontend protocols.json \
     -emit-module -emit-module-path ReadappIntents.swiftmodule
   ```
2. 登録情報 (Metadata.appintents) を生成する
   ```
   xcrun appintentsmetadataprocessor --output <out> \
     --toolchain-dir /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain \
     --module-name ReadappIntents --sdk-root $(xcrun --show-sdk-path) --xcode-version 27A266a \
     --platform-family macOS --deployment-target 15.0 --target-triple arm64-apple-macos15.0 \
     --source-file-list <Intents.swiftのパス一覧> --swift-const-vals-list <ReadappIntents.swiftconstvalues一覧> --force
   ```
3. Rust側は `build.rs` で `-force_load` リンク、`main.rs` の `proto_speak` をSwiftから呼ぶ
4. `.app/Contents/Resources/Metadata.appintents` に置いて署名
5. ショートカットに登録されるには、一時フォルダではなく `/Applications` や `~/Applications` に置く必要があった

## 注意
- 本番ではTauri (tao) が NSApplication を回すので、`proto_run_app` は不要。Intent→Rustの橋渡し関数だけ残す
- Intentの `perform` はアプリのプロセス内で動く。発声を待たずに返すこと (試作は `say` を待っている)
