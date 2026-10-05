import AppIntents
import AppKit

@_silgen_name("proto_speak")
func proto_speak(_ app: UnsafePointer<CChar>, _ text: UnsafePointer<CChar>)

struct SpeakNotificationIntent: AppIntent {
    static let title: LocalizedStringResource = "readappで読み上げる"
    static let description = IntentDescription("通知をキャラの声で読み上げます")
    static let openAppWhenRun: Bool = false

    @Parameter(title: "テキスト")
    var text: String

    @Parameter(title: "アプリ名")
    var appName: String?

    func perform() async throws -> some IntentResult {
        proto_speak(appName ?? "", text)
        return .result()
    }
}

@_cdecl("proto_run_app")
public func proto_run_app() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.run()
}
