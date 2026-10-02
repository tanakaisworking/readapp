import Foundation
import FoundationModels

// readapp用ローカル変換ヘルパー。
// 使い方: fm-helper "<persona指示>" < 通知文.txt
// 変換文をstdoutへ。失敗時はstderrへERR:を出してexit 1 (Rust側は素文にフォールバック)。

@main
struct Helper {
    static func main() async {
        let args = CommandLine.arguments
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
            let response = try await session.respond(to: text)
            print(response.content)
        } catch {
            fputs("ERR: " + String(describing: error) + "\n", stderr)
            exit(1)
        }
    }
}
