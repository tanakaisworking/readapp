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

#[cfg(test)]
mod tests {
    use super::*;

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
