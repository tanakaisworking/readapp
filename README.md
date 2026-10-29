# readapp — 通知読み上げ音声変更アプリ 実装方針

UI・デザインのガイドラインは [DESIGN.md](./DESIGN.md) にあります。実装時は必ず参照してください。

ビジネス判断とUX設計の方針は [UXVISION.md](./UXVISION.md) に分離しています。技術判断はこのファイル、プロダクトの方向性と体験設計はUXVISION.mdを参照してください。

最終更新: 2026-10-02 / Status: 設計ドキュメント（実装前）

## 概要

PC上の他アプリの通知を取得し、ローカルAIがキャラの口調で「通知が来たことと用件」を短くユーザーへ知らせる常駐アプリ。「PC上のイベントをキャラクターが喋るエンジン」を目標に、まずコア機能のMVPをTauriで作る。

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

| 形態 | 通知取得 | ビルド | 実行場所 |
|---|---|---|---|
| macOS dmg版 | Accessibility経由の直接監視（許可後すぐ使える）＋ Shortcuts互換 | `npm run build:dmg` | このMac |
| macOS MAS版 | Shortcutsの通知オートメーション＋アプリ提供の部品「readappで読み上げる」（App Intents。サンドボックスでは直接監視不可） | `npm run package:mas`（要profile＋証明書）／手元確認は `npm run package:mas -- --local` | このMac |
| Windows版 | UserNotificationListener（公式API） | `npm run build:win` | Windows上 |

コードは1つで、OS差分はRustモジュール、版差分は署名・entitlements・
バンドル設定とCargo feature `mas` で吸収する。MAS版は直接監視 (Accessibility) を外す
（2026-10-05 実測: サンドボックス内ではプロセス探索が拒否され動かない。審査上も他アプリの画面読み取りは避ける）。
サンドボックス内でも、読み上げ・キャラ変換・`shortcuts list/run`・ダウンロード保存は動作確認済み。

MAS版の通知の受け取り方 (2026-10-06 実装・実機確認):
- アプリがショートカットの部品「readappで読み上げる」を提供する (`src-tauri/intents/Intents.swift`、build.rsがXcodeなしで組み込む)
- 同梱のひな形 `resources/automation/readapp通知.shortcut` (通知トリガー＋部品＋「通知」変数の接続済み) をアプリから追加する
- ユーザーはショートカット側で対象アプリを選び (複数可)、オートメーションをオンにするだけ。URLスキーム方式と違い前面に出ない
- 読み込んだオートメーションは最初オフ。対象アプリはショートカット側で選ぶ (MAS版はアプリ別ON/OFFを画面に出さない。ショートカット経由の通知は明示OFFでない限り読む)
- ホームの「読み上げるアプリ」: 入っている有名アプリ (catalog.json の mac) ごとに、そのアプリだけが通知元のショートカット
  (`resources/automation/apps/<bundleId>/readapp通知-<id>.shortcut`) を1クリックで追加する。オンにした後、そのアプリの通知が届くと「受け取っています」
- 一覧にないアプリは汎用ひな形 `readapp通知` (通知元は readapp 自身) に「＋」で足す。readappのテスト通知で一巡を確かめる
- 部品には通知の Title/Subtitle/Body を改行でつないだテキストと、アプリ名 (アプリ別は固定名、汎用は通知の App) を渡す
- 未インストールのアプリを通知元に入れると、ショートカット側で別アプリ名に化けて表示され「＋」も効かなくなる (macOS 27.0.1 で確認)。そのためアプリ別に分けている
- カレンダーの通知は中身 (タイトル・本文・アプリ) がショートカットに渡らないため対象外。予定の読み上げは EventKit で別途
- 部品は `/Applications` か `~/Applications` に置いたアプリからしか登録されない (一時フォルダは対象外)

MAS配布の手順と残作業 (2026-10-29 時点):

- 最初の配布版には、Geminiの声 (自分のAPIキー) とサーバー経由の声を入れない。Cargo feature `cloud-voices` を付けない限り、画面にも出さず、選んでいたキャラもMacの標準の声で読む
- 証明書 (3rd Party Mac Developer Application/Installer) は発行済み
- 残り (Apple のアカウントで行う): App ID `com.hibachi.readapp` の登録、Mac App Store用 provisioning profile の発行、App Store Connect にアプリを作る
- 提出用の .pkg: `MAS_PROFILE=<profileのパス> npm run package:mas` → `src-tauri/target/release/bundle/macos/Readapp-mas.pkg`。手元確認は `npm run package:mas -- --local`
- 提出時に用意するもの: スクリーンショット、説明文、サポートURL、プライバシーポリシーのURL、App Privacy の申告 (読み上げログを PostHog へ送る。本文は送らない)、審査メモ (ショートカットの通知オートメーションの設定手順)

Windowsは `Windows.UI.Notifications.Management`（UserNotificationListener）が公式capabilityで、アプリ識別・通知本文・リアルタイムイベントまで公開APIで取得できる。Macのdmg版はAX監視、MAS版はShortcuts経由で、同じUI/サービスに流す。

## 技術スタック

- フレームワーク: Tauri 2
- フロント: React + Tailwind CSS + daisyUI（独自テーマ `readapp`。見た目の方針は DESIGN.md）
- コア: Rust（OS差分はすべてRust側に隠す）
- ローカル変換: macOS版は Apple Foundation Models、Windows版は Aion Instruct / Phi Silica / Foundry Local
- TTS: OS標準音声（無料）、Premium音声はサーバー側API
- 課金: サーバー側。クライアントに課金判定を置かない

## アーキテクチャ

UIは設定画面中心で軽く、コア処理はネイティブ寄り。OS差分はRust側のモジュールに閉じ込める。

### フロント（src/）

- `UI/` — daisyUI ベースの設定画面
- 普段見せる小窓（`src/views/companion.tsx`）と設定ウィンドウ（`src/App.tsx`）を、同じフロントをウィンドウ名で切り替えて出す。読み上げた文は `src-tauri/src/companion.rs` が直近分だけメモリに持ち、`companion-line` イベントで小窓へ送る
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
6. 最小の設定UI（daisyUI）

ホーム先頭の「読み上げ」をオフにすると、再生中の音声を即時停止し、待機中・変換中の読み上げも破棄する。再びオンにしても停止前の通知は再生しない。音量を0にした場合も同じ停止処理を行う。全体のオン・オフは保存され、アプリ再起動後も維持する。通話中の自動停止は未実装。

「キャラで話す」は通知本文の語尾を変えて読むのではなく、キャラが届いた通知を取り次ぐ声かけにする。通知元と重要な用件を短い一文、目安60文字以内で知らせる。例えばSlackの田中さんから「資料を作成しました。確認お願いします」が届いた場合、Mioなら「Slackに田中さんから、資料確認のお願いが来たよ。」のように伝える。元の差出人の「私」や「作成しました」をキャラ自身の発言にせず、必要な日時・固有名詞を保つ。依頼や予定変更を優先し、完了通知に新しい催促を足さない。ローカルAIの生成はgreedy samplingでランダムな言い足しを抑える。AIが利用できない場合は従来どおり元の通知文にフォールバックする。

macOS通常版・MAS版はメニューバーに常駐する。メニュー先頭から読み上げを停止・再開でき、「設定を開く…」でウィンドウを表示する。ウィンドウを閉じても常駐は続き、メニューの「終了」でアプリを終了する。初回のオンボーディングは表示し、設定完了後は次の起動からウィンドウを出さない。設定画面は必要になるまで生成せず、通知・AppIntent・再オープンからの起動では作業中アプリのフォーカスを奪わない。Finderから再オープンした場合も設定はメニューバーから開く。Windowsのウィンドウ動作は従来どおり。

通知の重複判定はAI変換の待ち行列へ入れる前に行う。直接監視とショートカット経由の同じアプリ・同じ文は20秒以内、同じ経路では2秒以内を重複とみなし、判定記録を消さずに3経路以上の重複も抑える。通常の通知バナーは通知IDで既読判定し、本文の表示更新で読み直さない。通知スタックは同じIDのまま別の通知へ入れ替わるため、内容も照合する。

Gemini 3.8 Flash TTSの本人向け試用接続を実装。クラウドの声を選ぶと、読み上げる文章をCloudflare Worker経由でGoogleへ送信し、返されたWAVを再生する。端末セッションはlogin Keychain、GoogleキーはWorker Secretに保存する。停止・消音はHTTP取得と音声再生の両方を中止し、失敗時は画面へ理由を出してOS音声へ切り替える。音声一時ファイルは0600で作り、再生・キャンセル後に削除する。バックエンドは別の非公開ローカルrepo `../readapp-premium-api` に置く。1回1000文字、JST日次5000文字、1分10件。

Mac通常配布版・MAS版ではGeminiのBYOKにも対応。「声を変更」でユーザー自身のAPIキーを登録し、Kore / Aoede / Puck / Charonを選ぶ。キーはアプリ自身のlogin Keychain項目に保存し、設定JSON・取得IPC・ログ・コマンド引数へ出さない。`gemini:` の声はGoogleへ直接接続し、`cloud:` の本人向けWorker接続とは別経路。API料金と上限はユーザーのGoogleプロジェクトに紐づく。APIキーの更新・削除は取得中・再生中・変換待ちの要求を取り消す。キー削除やAPIエラー時はOS音声に切り替え、Workerへ自動転送しない。アプリごとの声の上書きにも対応。WindowsのBYOK用秘匿ストアは未対応。

クラウド音声の使用上限・キー/接続・課金の失敗は、ホームのお知らせと声の設定に表示する。お知らせを閉じても実行中は状態を保持し、同じ接続先での成功やBYOKキーの更新・削除で解除する。同じ失敗を繰り返し通知せず、システム音声への変更とGoogle AI Studioでの利用状況確認を案内する。上限の回数や解除時刻は推測して表示しない。

サブスク販売、会員ログイン、複数端末管理、クラウド同期は未実装。端末接続は署名済みバイナリの `--provision-cloud-token` が生成し、出力されるハッシュだけをWorkerの `DEVICE_TOKEN_SHA256` に登録する。Googleキーと端末トークンをソースやバンドルへ入れない。

## 読み上げログ（PostHog）

通常配布版・MAS版はRustの読み上げワーカーから `readapp_speech` を送信する。
対象はHIBACHIの既存Default project（405771 / US Cloud）、`product = readapp` で他アプリと区別する。
[読み上げログ一覧](https://us.posthog.com/project/405771/insights/jMPDgRyX) は日本時間で最新200件を表示する。
記録は実行開始時刻（UTC）・`source_app_id`・`requested_model` / `requested_provider`・
実際に試みた音声の `model` / `provider`・`outcome`・`error_kind`・生成と再生の合計時間 `elapsed_ms`。
`trigger` は `direct` / `shortcut` / `preview`。App Intentが元アプリを渡さない経路では
`source_app_id = shortcut` とし、元アプリを推測しない。
`outcome = completed` / `fallback_completed` だけが再生完了。停止は `cancelled`、
失敗は `failed` / `fallback_failed`。停止前にキューから捨てた要求は記録しない。
OS音声の内部モデル名は公開されていないので `macos-say` / `windows-system-speech` と記録する。

通知タイトル・本文・変換後の文章・音声・APIキー・Googleの応答・自由入力のアプリ表示名は送らない。
匿名のランダムなインストールIDだけをアプリデータ内に保存し、person profile生成・GeoIPを無効化、
端末IPの自動補完を防ぐため `$ip` を固定の `0.0.0.0` に置き換える。
画面の自動収集・セッションリプレイは使用しない。
送信は別スレッドの上限128件のメモリキューで行い、通信失敗・キュー満杯でも発声を待たせない。
イベントはディスクへ保存せず再送しないため、オフラインや終了時には欠落する場合がある。

ビルド時に環境変数 `READAPP_POSTHOG_PROJECT_TOKEN` へPostHogの公開project tokenを渡す。
個人APIキーをアプリへ渡さない。token未指定のビルドは警告を出して収集を無効にする。
公開tokenをソース・`.env`・ドキュメントへ保存しない。パッケージを作る際も同じ環境変数が必要。
送信API: [PostHog Capture API](https://posthog.com/docs/api/capture)。

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
