// macOS: Apple Foundation Models によるキャラ口調変換 (M4)。
//
// Swift製ヘルパー (src-tauri/helper-src/fm-helper.swift) を子プロセスで呼ぶ。
// helperは `npm run build:helper` で生成する。無い・失敗した場合は
// 呼び出し元が素文にフォールバックする。

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Apple Intelligence の状態: "available" / "disabled" (オフ) / "not_ready" (準備中) / "unsupported" (非対応のMac) / "unavailable"
pub fn availability(helper: &Path) -> String {
    let out = Command::new(helper).arg("--availability").stdin(Stdio::null()).stderr(Stdio::null()).output();
    match out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if ["available", "disabled", "not_ready", "unsupported"].contains(&s.as_str()) { s } else { "unavailable".to_string() }
        }
        _ => "unavailable".to_string(),
    }
}

pub fn transform(text: &str, instruction: &str, helper: &Path) -> Result<String, String> {
    let mut child = Command::new(helper)
        .arg(instruction)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            eprintln!("[readapp] fm-helper spawn failed: {e}");
            e.to_string()
        })?;
    // 書き終えたらstdinを閉じてEOFを送る
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    let out = child
        .wait_with_output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        // 素文フォールバックの理由を残す (Apple Intelligence無効・サンドボックス等)
        eprintln!(
            "[readapp] fm-helper failed ({}): {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        );
        return Err("fm-helper failed".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
