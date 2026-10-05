// readappがショートカットに提供する部品 (App Intents)。
// 通知オートメーション等から「readappで読み上げる」を呼ぶと、Rust側のパイプラインに渡す。
// ビルドは build.rs が行う (静的ライブラリ化＋登録情報 Metadata.appintents の生成)。
import AppIntents
import os
import UserNotifications

private let log = Logger(subsystem: "com.hibachi.readapp", category: "intent")

@_silgen_name("readapp_intent_speak")
func readapp_intent_speak(_ app: UnsafePointer<CChar>, _ text: UnsafePointer<CChar>)

struct SpeakIntent: AppIntent {
    static let title: LocalizedStringResource = "readappで読み上げる"
    static let description = IntentDescription("通知などのテキストを、readappのキャラと声で読み上げます。")
    // 前面に出さずに裏で処理する
    static let openAppWhenRun: Bool = false

    // 任意にしておく。必須だと空のまま呼ばれた時に裏で入力待ちになり、
    // オートメーションが止まり続ける (Shortcuts側のレート制限とエラー通知を招く)。
    // 通知オートメーションでは同梱のひな形が「通知」変数をつないでいる。
    @Parameter(title: "テキスト", inputConnectionBehavior: .connectToPreviousIntentResult)
    var text: String?

    // 指定するとアプリ別のオン・オフに従う。空なら必ず読む。
    @Parameter(title: "アプリ名")
    var appName: String?

    static var parameterSummary: some ParameterSummary {
        Summary("readappで\(\.$text)を読み上げる") {
            \.$appName
        }
    }

    func perform() async throws -> some IntentResult {
        guard let text, !text.isEmpty else {
            log.notice("perform skipped: empty text")
            return .result()
        }
        log.notice("perform app=\(appName ?? "", privacy: .public) len=\(text.count)")
        readapp_intent_speak(appName ?? "", text)
        return .result()
    }
}

/// readappが前面にいる時もテスト通知をバナー表示する (既定では前面アプリの通知は出ない)。
private final class ForegroundPresenter: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}

private let presenter = ForegroundPresenter()

/// 設定確認用のテスト通知を出す。同梱のひな形は通知元に readapp 自身を含むので、
/// オートメーションがオンなら「readappで読み上げる」まで一巡する。
/// 戻り値: 0=送った / 1=通知が許可されていない / 2=送れなかった。
/// 初回は許可の確認が出て、答えるまで待つ (呼び出し元はメインスレッド以外から呼ぶこと)。
@_cdecl("readapp_post_test_notification")
public func readapp_post_test_notification() -> Int32 {
    let center = UNUserNotificationCenter.current()
    center.delegate = presenter
    let done = DispatchSemaphore(value: 0)
    var result: Int32 = 2
    center.requestAuthorization(options: [.alert, .sound]) { granted, error in
        guard granted else {
            log.notice("test notification not granted: \(String(describing: error), privacy: .public)")
            result = 1
            done.signal()
            return
        }
        let content = UNMutableNotificationContent()
        content.title = "readapp"
        content.body = "テスト通知です。読み上げの設定ができました。"
        let req = UNNotificationRequest(identifier: "readapp-test-\(UUID().uuidString)", content: content, trigger: nil)
        center.add(req) { err in
            if let err { log.notice("test notification failed: \(String(describing: err), privacy: .public)") }
            result = err == nil ? 0 : 2
            done.signal()
        }
    }
    // 許可の確認に答えてもらう時間を見込む
    if done.wait(timeout: .now() + 120) == .timedOut {
        return 2
    }
    return result
}
