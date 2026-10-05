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

/// 表示上のアプリ名を設定キーに寄せる。カタログ既知のものは既知IDへ、
/// 英数字名は小文字英数字へ (Slack→slack)、それ以外 (日本語名など) は名前のまま。
pub fn app_id_for(app_name: &str) -> String {
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
