// readappがショートカットに提供する部品 (App Intents)。
// 通知オートメーション等から「readappで読み上げる」を呼ぶと、Rust側のパイプラインに渡す。
// ビルドは build.rs が行う (静的ライブラリ化＋登録情報 Metadata.appintents の生成)。
import AppIntents
import AppKit
import os
import ServiceManagement
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
        // 中身を渡さない通知 (例: カレンダー) は改行だけになるので読まない
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            log.notice("perform skipped: empty text")
            return .result()
        }
        log.notice("perform app=\(appName ?? "", privacy: .public) len=\(text.count)")
        readapp_intent_speak(appName ?? "", text)
        return .result()
    }
}

/// 指定したバンドルIDのアプリが入っているか (サンドボックス内でも使える)。
@_cdecl("readapp_app_installed")
public func readapp_app_installed(_ bundleId: UnsafePointer<CChar>) -> Bool {
    NSWorkspace.shared.urlForApplication(withBundleIdentifier: String(cString: bundleId)) != nil
}

/// アプリのアイコンを、指定した大きさ (px) のPNGで out に書く。書けたら (または足りなければ) PNGの長さを返し、
/// アプリが見つからなければ 0。バンドルIDを優先し、無ければ名前で /Applications などを探す (サンドボックス内でも使える)。
@_cdecl("readapp_app_icon_png")
public func readapp_app_icon_png(
    _ bundleId: UnsafePointer<CChar>,
    _ name: UnsafePointer<CChar>,
    _ px: Int32,
    _ out: UnsafeMutablePointer<UInt8>,
    _ cap: Int
) -> Int {
    let id = String(cString: bundleId)
    let appName = String(cString: name)
    var url: URL? = id.isEmpty ? nil : NSWorkspace.shared.urlForApplication(withBundleIdentifier: id)
    if url == nil, !appName.isEmpty, !appName.contains("/") {
        let dirs = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities", NSHomeDirectory() + "/Applications"]
        url = dirs
            .map { URL(fileURLWithPath: $0).appendingPathComponent(appName + ".app") }
            .first { FileManager.default.fileExists(atPath: $0.path) }
    }
    guard let url, px > 0 else { return 0 }
    let icon = NSWorkspace.shared.icon(forFile: url.path)
    let side = Int(px)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { return 0 }
    let size = NSSize(width: side, height: side)
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    icon.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return 0 }
    if png.count <= cap {
        png.copyBytes(to: out, count: png.count)
    }
    return png.count
}

// ---- ログイン時に起動 (macOSの「ログイン項目」。サンドボックスのMAS版でも使える) ----
// 状態: 0 = 未登録, 1 = 有効, 2 = システム設定で許可待ち, 3 = アプリが見つからない

@_cdecl("readapp_login_item_status")
public func readapp_login_item_status() -> Int32 {
    switch SMAppService.mainApp.status {
    case .enabled: return 1
    case .requiresApproval: return 2
    case .notFound: return 3
    default: return 0
    }
}

/// 登録・解除して、その後の状態を返す。失敗したら -1。
@_cdecl("readapp_login_item_set")
public func readapp_login_item_set(_ enabled: Bool) -> Int32 {
    do {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    } catch {
        log.error("login item \(enabled ? "register" : "unregister", privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
        return -1
    }
    return readapp_login_item_status()
}

@_cdecl("readapp_open_login_items_settings")
public func readapp_open_login_items_settings() {
    SMAppService.openSystemSettingsLoginItems()
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

/// 試し用の通知を出す (本文は呼び出し元が渡す)。同梱の汎用ひな形は通知元に readapp 自身を含むので、
/// オートメーションがオンなら「readappで読み上げる」まで一巡する。
/// 戻り値: 0=送った / 1=通知が許可されていない / 2=送れなかった。
/// 初回は許可の確認が出て、答えるまで待つ (呼び出し元はメインスレッド以外から呼ぶこと)。
@_cdecl("readapp_post_test_notification")
public func readapp_post_test_notification(_ body: UnsafePointer<CChar>) -> Int32 {
    let text = String(cString: body)
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
        // 本文だけにする (タイトルを付けると「readapp」まで読み上げられる)
        let content = UNMutableNotificationContent()
        content.body = text
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
