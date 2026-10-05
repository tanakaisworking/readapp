// readappがショートカットに提供する部品 (App Intents)。
// 通知オートメーション等から「readappで読み上げる」を呼ぶと、Rust側のパイプラインに渡す。
// ビルドは build.rs が行う (静的ライブラリ化＋登録情報 Metadata.appintents の生成)。
import AppIntents
import os

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
        readapp_intent_speak(appName ?? "", text)
        return .result()
    }
}
