pub mod macos;
#[cfg(target_os = "macos")]
pub mod ax;
#[cfg(target_os = "windows")]
pub mod windows;

/// トーストのテキスト群を「先頭=タイトル、残り=本文」に分ける約束。
/// Windowsトースト抽出と将来の他ソースで共有する。
pub fn split_title_body(parts: Vec<String>) -> (String, String) {
    let mut iter = parts.into_iter();
    let title = iter.next().unwrap_or_default();
    let body = iter.collect::<Vec<_>>().join("\n");
    (title, body)
}

/// 合成済み (NFC) に揃える。mdls等はファイル名由来の分解形 (NFD: タ+濁点) を返すため、
/// バナー側の名前と同じキーにならない。macOS標準のCFStringNormalizeを使う。
#[cfg(target_os = "macos")]
pub fn nfc(s: &str) -> String {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use std::ffi::c_void;
    extern "C" {
        fn CFStringCreateMutableCopy(alloc: *const c_void, max_length: isize, s: CFStringRef) -> CFStringRef;
        fn CFStringNormalize(s: CFStringRef, form: isize);
    }
    const NORMALIZATION_FORM_C: isize = 2;
    let src = CFString::new(s);
    unsafe {
        let copy = CFStringCreateMutableCopy(std::ptr::null(), 0, src.as_concrete_TypeRef());
        if copy.is_null() {
            return s.to_string();
        }
        CFStringNormalize(copy, NORMALIZATION_FORM_C);
        CFString::wrap_under_create_rule(copy).to_string()
    }
}

/// Windowsの表示名は合成済みで届く前提でそのまま使う。
#[cfg(not(target_os = "macos"))]
pub fn nfc(s: &str) -> String {
    s.to_string()
}

/// 表示上のアプリ名を設定キーに寄せる。カタログ既知のものは既知IDへ、
/// 英数字名は小文字英数字へ (Slack→slack)、それ以外 (日本語名など) は名前のまま。
pub fn app_id_for(app_name: &str) -> String {
    let app_name = &nfc(app_name);
    const KNOWN: [(&str, &str); 8] = [
        ("カレンダー", "calendar"),
        ("calendar", "calendar"),
        ("メール", "mail"),
        ("mail", "mail"),
        ("claude", "claude"),
        ("chatgpt", "chatgpt"),
        ("slack", "slack"),
        ("discord", "discord"),
    ];
    let lower = app_name.trim().to_lowercase();
    if let Some((_, id)) = KNOWN.iter().find(|(n, _)| *n == lower) {
        return id.to_string();
    }
    let ascii: String = lower.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if !ascii.is_empty() && lower.is_ascii() {
        return ascii;
    }
    if app_name.trim().is_empty() {
        "通知".to_string()
    } else {
        app_name.trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_ids_map_to_catalog() {
        assert_eq!(app_id_for("Slack"), "slack");
        assert_eq!(app_id_for("カレンダー"), "calendar");
        assert_eq!(app_id_for("ChatGPT"), "chatgpt");
        assert_eq!(app_id_for("Google Chrome"), "googlechrome");
        assert_eq!(app_id_for("リマインダー"), "リマインダー");
        assert_eq!(app_id_for(""), "通知");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn decomposed_names_map_like_composed() {
        // mdlsが返す分解形「カレンダー」(タ+U+3099)
        let nfd = "カレンタ\u{3099}ー";
        assert_eq!(nfc(nfd), "カレンダー");
        assert_eq!(app_id_for(nfd), "calendar");
        assert_eq!(app_id_for("リマインタ\u{3099}ー"), "リマインダー");
    }

    #[test]
    fn splits_first_as_title_rest_as_body() {
        let (t, b) = split_title_body(vec!["a".into(), "b".into(), "c".into()]);
        assert_eq!(t, "a");
        assert_eq!(b, "b\nc");
    }

    #[test]
    fn single_part_has_empty_body() {
        let (t, b) = split_title_body(vec!["a".into()]);
        assert_eq!(t, "a");
        assert!(b.is_empty());
    }

    #[test]
    fn empty_parts_give_empty_pair() {
        let (t, b) = split_title_body(vec![]);
        assert!(t.is_empty() && b.is_empty());
    }
}
