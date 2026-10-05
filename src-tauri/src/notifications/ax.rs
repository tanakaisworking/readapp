//! macOS直接監視: Accessibility経由で通知バナーを取得する (dmg版)。
//!
//! Shortcuts迂回と違い、権限さえ渡せばすぐ使える。MAS版では使わず、
//! Shortcuts受け口 (macos.rs) と併存する。どちらも同じパイプラインへ流す。
//!
//! 実機 (macOS 27) で観測したバナーの構造:
//!   NotificationCenter
//!   └ AXWindow subrole=AXSystemDialog (画面全体サイズ。バナー表示中だけ現れる)
//!     └ … └ AXGroup subrole=AXNotificationCenterBanner / AXNotificationCenterAlert(Stack)
//!            AXDescription = "<アプリ名>、<タイトル>, <本文>…"
//!            AXIdentifier  = 通知ごとのUUID
//!            └ AXStaticText identifier=header/title/subtitle/body
//! 窓は使い回され、AXWindowCreatedも安定して届かないため、短い間隔の走査で拾う。

use std::collections::{HashSet, VecDeque};
use std::ffi::c_void;
use std::os::raw::c_int;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::string::{CFString, CFStringRef};
use tauri::{AppHandle, Manager};

use super::app_id_for;
use crate::{speak_notification, AppSettings};

type AXError = c_int;
type AXUIElementRef = *const c_void;

const KAX_ERROR_SUCCESS: AXError = 0;
/// 走査間隔。バナーは数秒出るので、これで取りこぼさない。
const POLL_INTERVAL: Duration = Duration::from_millis(700);
/// 既読キーの保持件数。常駐アラートが画面に残っても二度読みしない。
const SEEN_CAPACITY: usize = 512;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    fn AXUIElementCreateApplication(pid: c_int) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut *const c_void,
    ) -> AXError;
}

/// 許可済みか (ダイアログは出さない)。
pub fn trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// プロンプト付きで許可を要求する。初回はシステムダイアログが出る。
pub fn request_prompt() -> bool {
    unsafe {
        let key = CFString::new("AXTrustedCheckOptionPrompt");
        let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
    }
}

/// アクセシビリティ設定画面を開く。
pub fn open_settings() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .status();
    let _ = std::process::Command::new("open")
        .args(["-a", "System Settings"])
        .status();
}

/// AX要素。CFTypeで所有し、解放はDropに任せる (走査を繰り返すのでリークさせない)。
struct El(CFType);

impl El {
    fn app(pid: c_int) -> Option<El> {
        let raw = unsafe { AXUIElementCreateApplication(pid) };
        if raw.is_null() {
            return None;
        }
        // SAFETY: Create系の戻り値で、所有権を受け取る。
        Some(El(unsafe { CFType::wrap_under_create_rule(raw) }))
    }

    fn attr(&self, name: &str) -> Option<CFType> {
        let key = CFString::new(name);
        let mut value: *const c_void = std::ptr::null();
        let rc = unsafe {
            AXUIElementCopyAttributeValue(
                self.0.as_CFTypeRef(),
                key.as_concrete_TypeRef(),
                &mut value,
            )
        };
        if rc != KAX_ERROR_SUCCESS || value.is_null() {
            return None;
        }
        // SAFETY: Copy系の戻り値で、所有権を受け取る。
        Some(unsafe { CFType::wrap_under_create_rule(value) })
    }

    fn string(&self, name: &str) -> Option<String> {
        self.attr(name)?.downcast::<CFString>().map(|s| s.to_string())
    }

    fn elements(&self, name: &str) -> Vec<El> {
        let Some(arr) = self.attr(name).and_then(|v| v.downcast::<CFArray<*const c_void>>()) else {
            return Vec::new();
        };
        arr.get_all_values()
            .into_iter()
            .filter(|p| !p.is_null())
            // SAFETY: 配列内の要素は借用なので、保持する分だけretainする。
            .map(|p| El(unsafe { CFType::wrap_under_get_rule(p) }))
            .collect()
    }
}

/// 画面に出ている1件分の通知。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Banner {
    /// 通知要素のUUID (無ければ空)
    pub uid: String,
    /// 表示上のアプリ名 (例: "Slack", "カレンダー")
    pub app_name: String,
    pub title: String,
    pub subtitle: String,
    pub body: String,
}

impl Banner {
    /// 既読判定のキー。スタックは同じUUIDのまま中身が入れ替わるので中身も含める。
    fn key(&self) -> String {
        format!("{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}", self.uid, self.app_name, self.title, self.subtitle, self.body)
    }
}

/// AXDescriptionの先頭からアプリ名を取り出す。"Slack、田中, 本文" → "Slack"。
/// 英語環境の ", " 区切りにもフォールバックする。
pub fn app_name_from_description(desc: &str) -> String {
    // 本文側にも区切りが出うるので、最初に現れた区切りで切る
    let end = [desc.find('、'), desc.find(", ")]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(desc.len());
    desc[..end].trim().to_string()
}

/// 通知要素の中身 (説明文と識別子付きテキスト) からBannerを組み立てる。
/// 識別子が無い版にも備え、識別子なしのテキストは 先頭=タイトル・残り=本文 とみなす。
pub fn banner_from_parts(uid: &str, desc: &str, texts: &[(String, String)]) -> Option<Banner> {
    let mut title = String::new();
    let mut subtitle = String::new();
    let mut body = Vec::new();
    let mut loose = Vec::new();
    for (id, value) in texts {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match id.as_str() {
            "title" => title = value.to_string(),
            "subtitle" => subtitle = value.to_string(),
            "body" => body.push(value.to_string()),
            // header は「即時通知」等のラベルなので読まない
            "header" => {}
            _ => loose.push(value.to_string()),
        }
    }
    if title.is_empty() && body.is_empty() && !loose.is_empty() {
        title = loose.remove(0);
        body = loose;
    }
    if title.is_empty() && subtitle.is_empty() && body.is_empty() {
        return None;
    }
    Some(Banner {
        uid: uid.to_string(),
        app_name: app_name_from_description(desc),
        title,
        subtitle,
        body: body.join("\n"),
    })
}

/// 既読キーの集合 (古いものから捨てる)。
struct Seen {
    set: HashSet<String>,
    order: VecDeque<String>,
}

impl Seen {
    fn new() -> Self {
        Self { set: HashSet::new(), order: VecDeque::new() }
    }

    /// 未読なら true (かつ既読化する)。
    fn mark(&mut self, key: String) -> bool {
        if self.set.contains(&key) {
            return false;
        }
        if self.order.len() >= SEEN_CAPACITY {
            if let Some(old) = self.order.pop_front() {
                self.set.remove(&old);
            }
        }
        self.set.insert(key.clone());
        self.order.push_back(key);
        true
    }
}

fn notification_center_pid() -> Option<c_int> {
    let out = std::process::Command::new("pgrep")
        .args(["-x", "NotificationCenter"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).lines().next()?.trim().parse().ok()
}

fn process_alive(pid: c_int) -> bool {
    extern "C" {
        fn kill(pid: c_int, sig: c_int) -> c_int;
    }
    // シグナル0は送らずに存在だけ確かめる
    unsafe { kill(pid, 0) == 0 }
}

/// いま画面に出ている通知を集める。ウィジェット窓は対象外。
fn visible_banners(pid: c_int) -> Vec<Banner> {
    let Some(app) = El::app(pid) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for win in app.elements("AXWindows") {
        if win.string("AXSubrole").as_deref() != Some("AXSystemDialog") {
            continue;
        }
        find_alerts(&win, 0, &mut out);
    }
    out
}

/// 通知1件を表す要素か。バナー型・アラート型とそのスタックが該当する。
pub fn is_notification_subrole(subrole: &str) -> bool {
    subrole.starts_with("AXNotificationCenterBanner") || subrole.starts_with("AXNotificationCenterAlert")
}

fn find_alerts(el: &El, depth: u8, out: &mut Vec<Banner>) {
    if depth > 10 {
        return;
    }
    if el.string("AXSubrole").is_some_and(|s| is_notification_subrole(&s)) {
        let mut texts = Vec::new();
        collect_texts(el, 0, &mut texts);
        let uid = el.string("AXIdentifier").unwrap_or_default();
        let desc = el.string("AXDescription").unwrap_or_default();
        if let Some(b) = banner_from_parts(&uid, &desc, &texts) {
            out.push(b);
        }
        return;
    }
    for child in el.elements("AXChildren") {
        find_alerts(&child, depth + 1, out);
    }
}

fn collect_texts(el: &El, depth: u8, out: &mut Vec<(String, String)>) {
    if depth > 4 || out.len() > 12 {
        return;
    }
    if el.string("AXRole").as_deref() == Some("AXStaticText") {
        if let Some(v) = el.string("AXValue") {
            out.push((el.string("AXIdentifier").unwrap_or_default(), v));
        }
        return;
    }
    for child in el.elements("AXChildren") {
        collect_texts(&child, depth + 1, out);
    }
}

/// 監視が開始済みか (許可後に自動開始される)。
static STARTED: AtomicBool = AtomicBool::new(false);

pub fn watching() -> bool {
    STARTED.load(Ordering::SeqCst)
}

/// 許可済みなら監視を開始する。未許可なら許可されるまで待ち続ける
/// (設定画面で後から許可した場合も再起動なしで有効化するため)。
pub fn start_if_trusted(handle: AppHandle) {
    std::thread::spawn(move || {
        while !trusted() {
            std::thread::sleep(Duration::from_secs(2));
        }
        STARTED.store(true, Ordering::SeqCst);
        eprintln!("[readapp] ax capture: started");
        let tx = pipeline_worker(handle);
        watch_loop(tx);
    });
}

/// 変換 (最大数秒) を走査スレッドの外で順に処理する。走査は止めない。
fn pipeline_worker(handle: AppHandle) -> mpsc::Sender<Banner> {
    let (tx, rx) = mpsc::channel::<Banner>();
    std::thread::spawn(move || {
        for b in rx {
            let settings = handle.state::<AppSettings>();
            let app_id = app_id_for(&b.app_name);
            settings.observe_named(&app_id, &b.app_name);
            let title = if b.subtitle.is_empty() {
                b.title.clone()
            } else {
                format!("{}。{}", b.title, b.subtitle)
            };
            crate::record_received(&settings, &app_id, &title, &b.body);
            speak_notification(&settings, &app_id, &title, &b.body);
        }
    });
    tx
}

/// 1回の走査で新規がこれより多ければ、バナーではなく通知センターの履歴表示とみなす。
/// ponytail: 件数だけの判定。履歴を開いた時に2件以下の未読があれば読んでしまう。
const BURST_LIMIT: usize = 2;
/// pidを念のため引き直す間隔 (走査回数)。プロセス終了は毎回の生存確認で即検知する。
const PID_REFRESH_TICKS: u32 = 40;

/// 走査結果のうち読み上げるものを返す。全件を既読化する。
/// primed=false (起動直後) と、まとめて現れた分は読まない。
fn fresh_to_speak(seen: &mut Seen, banners: Vec<Banner>, primed: bool) -> Vec<Banner> {
    let fresh: Vec<Banner> = banners.into_iter().filter(|b| seen.mark(b.key())).collect();
    if !primed || fresh.len() > BURST_LIMIT {
        if primed {
            eprintln!("[readapp] ax: skipped {} notifications shown at once", fresh.len());
        }
        return Vec::new();
    }
    fresh
}

fn watch_loop(tx: mpsc::Sender<Banner>) {
    let mut seen = Seen::new();
    let mut pid: Option<c_int> = None;
    // 起動時に出ていたもの (置きっぱなしのアラート等) は読まない
    let mut primed = false;
    let mut ticks: u32 = 0;
    loop {
        if ticks % PID_REFRESH_TICKS == 0 || !pid.is_some_and(process_alive) {
            pid = notification_center_pid();
        }
        ticks = ticks.wrapping_add(1);
        if let Some(p) = pid {
            for b in fresh_to_speak(&mut seen, visible_banners(p), primed) {
                eprintln!("[readapp] ax banner: {:?}", b);
                if tx.send(b).is_err() {
                    return;
                }
            }
            primed = true;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(id: &str, v: &str) -> (String, String) {
        (id.to_string(), v.to_string())
    }

    #[test]
    fn app_name_from_japanese_description() {
        assert_eq!(
            app_name_from_description("リマインダー、readapp観測テスト3, 今日 16:42、スタック"),
            "リマインダー"
        );
    }

    #[test]
    fn app_name_from_english_description() {
        assert_eq!(app_name_from_description("Slack, Tanaka, hello"), "Slack");
    }

    #[test]
    fn app_name_uses_first_separator_when_mixed() {
        assert_eq!(app_name_from_description("Slack, 田中, 明日、確認してください"), "Slack");
        assert_eq!(app_name_from_description("Slack、田中, 明日"), "Slack");
        assert_eq!(app_name_from_description("Slack"), "Slack");
    }

    #[test]
    fn banner_uses_identified_texts_and_skips_header() {
        let b = banner_from_parts(
            "U1",
            "リマインダー、件名, 今日",
            &[t("header", "即時通知"), t("title", "件名"), t("body", "今日 16:42")],
        )
        .unwrap();
        assert_eq!(b.app_name, "リマインダー");
        assert_eq!(b.title, "件名");
        assert_eq!(b.body, "今日 16:42");
        assert!(b.subtitle.is_empty());
    }

    #[test]
    fn banner_without_identifiers_uses_first_as_title() {
        let b = banner_from_parts("", "Slack、a", &[t("", "田中"), t("", "資料できました")]).unwrap();
        assert_eq!(b.title, "田中");
        assert_eq!(b.body, "資料できました");
    }

    #[test]
    fn empty_banner_is_none() {
        assert!(banner_from_parts("U", "Slack", &[t("header", "即時通知")]).is_none());
    }

    #[test]
    fn seen_rejects_repeats_and_evicts_oldest() {
        let mut s = Seen::new();
        assert!(s.mark("a".into()));
        assert!(!s.mark("a".into()));
        for i in 0..SEEN_CAPACITY {
            s.mark(format!("k{i}"));
        }
        assert!(s.mark("a".into()));
    }

    #[test]
    fn banner_and_alert_subroles_are_notifications() {
        assert!(is_notification_subrole("AXNotificationCenterBanner"));
        assert!(is_notification_subrole("AXNotificationCenterAlert"));
        assert!(is_notification_subrole("AXNotificationCenterAlertStack"));
        assert!(!is_notification_subrole("AXHostingView"));
    }

    #[test]
    fn process_alive_detects_self_and_missing() {
        assert!(process_alive(std::process::id() as c_int));
        assert!(!process_alive(c_int::MAX));
    }

    #[test]
    fn nothing_is_spoken_before_priming() {
        let mut seen = Seen::new();
        let b = banner_from_parts("U", "Slack、x", &[t("title", "1")]).unwrap();
        assert!(fresh_to_speak(&mut seen, vec![b.clone()], false).is_empty());
        // 起動時に出ていたものは、その後も読まない
        assert!(fresh_to_speak(&mut seen, vec![b], true).is_empty());
    }

    #[test]
    fn single_new_banner_is_spoken_once() {
        let mut seen = Seen::new();
        let b = banner_from_parts("U", "Slack、x", &[t("title", "1")]).unwrap();
        assert_eq!(fresh_to_speak(&mut seen, vec![b.clone()], true).len(), 1);
        assert!(fresh_to_speak(&mut seen, vec![b], true).is_empty());
    }

    #[test]
    fn burst_of_history_is_not_spoken() {
        let mut seen = Seen::new();
        let many: Vec<Banner> = (0..=BURST_LIMIT)
            .map(|i| banner_from_parts(&format!("U{i}"), "Slack、x", &[t("title", "1")]).unwrap())
            .collect();
        assert!(fresh_to_speak(&mut seen, many, true).is_empty());
    }

    #[test]
    fn stack_with_new_content_is_new_key() {
        let a = banner_from_parts("U", "Slack、x", &[t("title", "1")]).unwrap();
        let b = banner_from_parts("U", "Slack、x", &[t("title", "2")]).unwrap();
        assert_ne!(a.key(), b.key());
    }
}
