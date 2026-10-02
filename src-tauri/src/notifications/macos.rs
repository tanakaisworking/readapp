// macOS: Shortcuts Automation → カスタムURLスキーム経由で通知受信 (M3)。
//
// Shortcuts側は「URLを開く」で以下を呼ぶ:
//   readapp://notify?app=<通知元ID>&title=<タイトル>&body=<本文>
// (値はいずれもパーセントエンコード済み)

use url::Url;

pub struct MacosNotification {
    pub app_id: String,
    pub title: String,
    pub body: String,
}

pub fn parse_notify_url(url: &Url) -> Option<MacosNotification> {
    if url.scheme() != "readapp" {
        return None;
    }
    if url.host_str() != Some("notify") {
        return None;
    }
    let mut app_id: Option<String> = None;
    let mut title = String::new();
    let mut body = String::new();
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "app" => app_id = Some(value.into_owned()),
            "title" => title = value.into_owned(),
            "body" => body = value.into_owned(),
            _ => {}
        }
    }
    Some(MacosNotification {
        app_id: app_id?,
        title,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(query: &str) -> Option<MacosNotification> {
        parse_notify_url(&Url::parse(&format!("readapp://notify?{query}")).unwrap())
    }

    #[test]
    fn parses_all_fields_with_percent_encoding() {
        let n = parsed("app=slack&title=%E4%BC%9A%E8%AD%B0&body=%E7%B5%82%E4%BA%86").unwrap();
        assert_eq!(n.app_id, "slack");
        assert_eq!(n.title, "会議");
        assert_eq!(n.body, "終了");
    }

    #[test]
    fn title_and_body_are_optional() {
        let n = parsed("app=calendar").unwrap();
        assert_eq!(n.app_id, "calendar");
        assert!(n.title.is_empty() && n.body.is_empty());
    }

    #[test]
    fn rejects_wrong_scheme_host_and_missing_app() {
        assert!(parse_notify_url(&Url::parse("other://notify?app=x").unwrap()).is_none());
        assert!(parse_notify_url(&Url::parse("readapp://other?app=x").unwrap()).is_none());
        assert!(parsed("title=x").is_none());
    }
}
