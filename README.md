# readapp — 通知読み上げ音声変更アプリ 実装方針

UI・デザインのガイドラインは [DESIGN.md](./DESIGN.md) にあります。実装時は必ず参照してください。

ビジネス判断とUX設計の方針は [UXVISION.md](./UXVISION.md) に分離しています。技術判断はこのファイル、プロダクトの方向性と体験設計はUXVISION.mdを参照してください。

最終更新: 2026-10-02 / Status: 設計ドキュメント（実装前）

## 概要

PC上の他アプリの通知を取得し、内容をローカルAIでキャラ口調に変換してTTSで読み上げる常駐アプリ。「PC上のイベントをキャラクターが喋るエンジン」を目標に、まずコア機能のMVPをTauriで作る。

## ここまでの会話で確定したこと

### 検証済み

- macOS 27環境で、Shortcuts Notification Automation → 通知読み上げの経路は動作確認済み（テスト通知「通知読み上げの実験です。作業が完了しました。」を正常に読み上げ確認）。
- AppleのNotification Automationは「特定アプリ単位」の指定のみで、「All apps」的なワイルドカード指定は現行仕様に存在しない。
- そのためmacOS側の転送対象はアプリごとのAutomation登録が前提になり、アプリ内UIから対象アプリを選択するオンボーディングが必要。

### macOS側の確定方針

通知の転送対象は「All apps」のような一括指定ができないため、以下のオンボーディングに固定する:

1. masコマンドでアプリインストール
2. アプリ内UIから対象アプリのショートカットをダウンロード（`npm run build:shortcuts` で生成、URL組み立て済み）
3. ダウンロードしたファイルをダブルクリックしてショートカットに登録
4. 通知オートメーションで「ショートカットを実行」を選ぶ（対象アプリごと）
5. 利用開始

- ショートカットの書き換え・生成はアプリ内から行わない。配布物をダウンロードして登録してもらう方式に固定。
- All apps指定がないことへの対処として、初回セットアップで主要アプリをまとめて案内し、以後のON/OFFはアプリ内設定で完結させる。

### 配信形態

| 形態 | 通知取得 | 用途 |
|---|---|---|
| macOS dmg版 | Accessibility経由の直接監視（許可後すぐ使える）＋ Shortcuts互換 | 自由配信。MAS審査なし |
| macOS MAS版 | Shortcuts Automation → App Intent | Store配信。オンボーディングはショートカットDL+有効化 |
| Windows版 | UserNotificationListener（公式API） | 本来あるべき完成形。権限1回で完結 |

Windowsは `Windows.UI.Notifications.Management`（UserNotificationListener）が公式capabilityで、アプリ識別・通知本文・リアルタイムイベントまで公開APIで取得できる。Macのdmg版はAX監視、MAS版はShortcuts経由で、同じUI/サービスに流す。

## 技術スタック

- フレームワーク: Tauri 2
- フロント: React + shadcn/ui（バニラ構成。余計なUIライブラリを積まずshadcn標準に寄せる）
- コア: Rust（OS差分はすべてRust側に隠す）
- ローカル変換: macOS版は Apple Foundation Models、Windows版は Aion Instruct / Phi Silica / Foundry Local
- TTS: OS標準音声（無料）、Premium音声はサーバー側API
- 課金: サーバー側。クライアントに課金判定を置かない

## アーキテクチャ

UIは設定画面中心で軽く、コア処理はネイティブ寄り。OS差分はRust側のモジュールに閉じ込める。

### フロント（src/）

- `UI/` — shadcn/ui ベースの設定画面
- `settings/` — アプリ別ON/OFF、音声設定
- `personas/` — キャラ定義
- `voices/` — 音声プリセット

### Rustコア（src-tauri/）

- `notifications/` — windows.rs（UserNotificationListener）/ macos.rs（Shortcuts Automation・App Intent受信）
- `transform/` — raw.rs（変換なし）/ apple_foundation_model.rs / windows_local_ai.rs
- `speech/` — system.rs（OS標準TTS）/ premium.rs（サーバー側Premium TTS）/ elevenlabs.rs（BYOK）
- `subscription/` — storekit.rs（MAS課金）/ microsoft_store.rs（Microsoft Store課金）

フロントから見たパイプラインは常に同じ:

```text
notification → shouldSpeak() → transform() → speak()
```

OS差分はRust側のnotifications/とtransform/に閉じ込める。フロントはOSを意識しない。

## MVPスコープ（コア機能）

1. 通知取得（Windows: UserNotificationListener / macOS: Shortcuts連携）
2. 通知元アプリ識別
3. アプリ別ON/OFF設定
4. テキスト変換（まずはローカルAIでのキャラ口調変換）
5. TTS読み上げ（OS標準音声）
6. 最小の設定UI（shadcn/ui）

Premium音声、課金、BYOK、クラウド同期はMVP後。構造上の置き場所は決めておくが、実装はしない。

## 事業方針（会話で確定済み）

- クライアントはOSS。課金価値はサーバー側のPremium音声に置く。
- 課金判定をクライアント側に置かないため、OSS化の収益リスクは小さい。
- 無料版: 通知読み上げ、アプリ別ON/OFF、ローカルキャラ化、OS標準音声、BYOK。
- 月額版: APIキー設定不要の高品質キャラ音声、最適モデル自動選択、音声プリセット、クラウド同期。
- ライセンスはMIT想定（forkして広まる前提）。
- Issue運用は最初からテンプレート化。OS・アプリバージョン・通知元・ログを集める形式。アプリ内に「問題を報告」ボタンを置く想定。

## 今後の背骨

このアプリを単体で作った後、以下をすべて `speak({ text, persona, voice })` に食わせる設計に拡張する:

- 通知（今回のMVP）
- 会議終了、タスク完了
- カレンダーイベント
- Rekiのイベント

エンジン部分（通知→変換→音声のパイプライン）は、アプリごとの差分をRust側のOS別モジュールに閉じ込めたまま、他のイベントソースにも差し替え可能な形を保つ。

## 未確定・要検証

- macOS 27のNotification Automationで1つのAutomationに複数アプリを選択できるか（UI確認が必要。できるならオンボーディングが大きく楽になる）。
- Shortcutsからの通知受け渡しは `readapp://notify?app=&title=&body=` に確定。タイトル/本文の分離はURL側で保証する。
- App Intentへの通知受け渡しのレイテンシと、常駐アプリ側での受信安定性。
- Windows側のPhi Silica → Aion Instruct移行の実運用での確認。
- Windows配布形態とUserNotificationListenerの権限: 公式手順はPackage.appxmanifestへのUser Notification Listener capability宣言が前提。TauriのNSIS/MSI（unpackaged）でリスナーが動くか、MSIX化が必要かをWindows実機で確認する。配布方式決定まで起動失敗はログに残す。
