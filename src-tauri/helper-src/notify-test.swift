import Foundation
import UserNotifications

// readapp用テスト通知ヘルパー。自分宛てにバナーを出す自己テスト用。
// 使い方: notify-test "<タイトル>" "<本文>"
// 初回は通知の許可ダイアログが出る (許可はバイナリの署名に紐づくため署名必須)。

@main
struct NotifyTest {
    static func main() async {
        let args = CommandLine.arguments
        let title = args.count > 1 ? args[1] : "テスト通知"
        let body = args.count > 2 ? args[2] : "これはreadappのテスト通知です"
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound])
            if !granted {
                fputs("ERR: notification not granted\n", stderr)
                exit(1)
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            let req = UNNotificationRequest(
                identifier: UUID().uuidString, content: content, trigger: nil)
            try await center.add(req)
        } catch {
            fputs("ERR: " + String(describing: error) + "\n", stderr)
            exit(1)
        }
    }
}
