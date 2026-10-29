import Foundation
import FoundationModels

// readapp用ローカル変換ヘルパー。
// 使い方: fm-helper "<persona指示>" < 通知文.txt
// 変換文をstdoutへ。失敗時はstderrへERR:を出してexit 1 (Rust側は素文にフォールバック)。

@main
struct Helper {
    static func main() async {
        let args = CommandLine.arguments
        // Apple Intelligence を使えるか (設定画面で「オフなので、そのまま読んでいます」と知らせる用)
        if args.count >= 2 && args[1] == "--availability" {
            switch SystemLanguageModel.default.availability {
            case .available:
                print("available")
            case .unavailable(.appleIntelligenceNotEnabled):
                print("disabled")
            case .unavailable(.modelNotReady):
                print("not_ready")
            case .unavailable(.deviceNotEligible):
                print("unsupported")
            case .unavailable:
                print("unavailable")
            }
            exit(0)
        }
        guard args.count >= 2 else {
            fputs("ERR: missing instruction\n", stderr)
            exit(1)
        }
        let instruction = args[1]
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard let text = String(data: data, encoding: .utf8),
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            fputs("ERR: empty input\n", stderr)
            exit(1)
        }
        do {
            let session = LanguageModelSession(instructions: instruction)
            let prompt = "新しく届いた通知のデータ:\n\(text)\n\n何の通知が来たのか、指定されたキャラの口調でユーザーへ一言だけ知らせてください。分かる場合は通知元アプリ名も入れてください。"
            // 通知の事実を取り次ぐ用途なので、ランダムな言い足しを抑える。
            let response = try await session.respond(to: prompt, options: GenerationOptions(samplingMode: .greedy))
            print(response.content)
        } catch {
            fputs("ERR: " + String(describing: error) + "\n", stderr)
            exit(1)
        }
    }
}
