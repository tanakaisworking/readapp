// macOS: Apple Foundation Models によるキャラ口調変換 (M4)。
//
// Swift製ヘルパー (src-tauri/helper-src/fm-helper.swift) を子プロセスで呼ぶ。
// helperは `npm run build:helper` で生成する。無い・失敗した場合は
// 呼び出し元が素文にフォールバックする。

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub fn transform(text: &str, instruction: &str, helper: &Path) -> Result<String, String> {
    let mut child = Command::new(helper)
        .arg(instruction)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    // 書き終えたらstdinを閉じてEOFを送る
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    let out = child
        .wait_with_output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("fm-helper failed".to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
