//! 製品ユーザーのBYOK。取得IPCは作らず、macOS Keychainにだけ保存する。
use std::sync::Mutex;

const SERVICE: &str = "com.hibachi.readapp.gemini-byok";
const ACCOUNT: &str = "api-key";
// 読取と変更を直列化。変更中に新しい世代が古いキーを読み込む競合を防ぐ。
static ACCESS: Mutex<()> = Mutex::new(());

pub fn supported() -> bool {
    cfg!(target_os = "macos")
}

pub fn valid(key: &str) -> bool {
    (20..=256).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\')
}

pub(super) fn get() -> Result<String, &'static str> {
    let _guard = ACCESS.lock().map_err(|_| "APIキーを読み込めませんでした")?;
    #[cfg(target_os = "macos")]
    {
        let bytes = security_framework::passwords::get_generic_password(SERVICE, ACCOUNT)
            .map_err(|_| "GeminiのAPIキーを登録してください")?;
        let key = String::from_utf8(bytes).map_err(|_| "APIキーを登録し直してください")?;
        if !valid(&key) {
            return Err("APIキーを登録し直してください");
        }
        Ok(key)
    }
    #[cfg(not(target_os = "macos"))]
    Err("Gemini APIキーの登録はMac版で利用できます")
}

pub fn configured() -> bool {
    get().is_ok()
}

pub fn save(key: &str) -> Result<(), &'static str> {
    let key = key.trim();
    if !valid(key) {
        return Err("APIキーの形式を確認してください");
    }
    let _guard = ACCESS.lock().map_err(|_| "APIキーを保存できませんでした")?;
    super::system::cancel_pending();
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::set_generic_password(SERVICE, ACCOUNT, key.as_bytes())
            .map_err(|_| "Keychainへ保存できませんでした。もう一度お試しください")?;
        super::system::clear_byok_issue();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err("Gemini APIキーの登録はMac版で利用できます")
}

pub fn delete() -> Result<(), &'static str> {
    let _guard = ACCESS.lock().map_err(|_| "APIキーを削除できませんでした")?;
    super::system::cancel_pending();
    #[cfg(target_os = "macos")]
    {
        match security_framework::passwords::delete_generic_password(SERVICE, ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(_) => Err("Keychainから削除できませんでした。もう一度お試しください"),
        }?;
        super::system::clear_byok_issue();
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err("Gemini APIキーの登録はMac版で利用できます")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_empty_short_oversized_and_header_injection() {
        assert!(valid("test-only-not-a-real-api-key-123"));
        // キー形式を特定の接頭辞に固定しない。ヘッダー注入だけ拒否する。
        assert!(valid("test-only:not-real/api-key=123"));
        for key in [
            "",
            "short",
            "abcdefghijklmnopqrst\nheader",
            "abcdefghijklmnopqrst\r",
            "abcdefghijklmnopqrst\"",
            "abcdefghijklmnopqrst\\",
            "abcdefghijklmnopqrst ",
        ] {
            assert!(!valid(key));
        }
        assert!(!valid(&"x".repeat(257)));
        assert!(!valid("日本語の文字を含むAPIキーは許可しません"));
    }
}
