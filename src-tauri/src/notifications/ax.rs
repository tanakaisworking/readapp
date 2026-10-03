//! macOS直接監視: Accessibility経由で通知バナーを取得する (dmg版)。
//!
//! Shortcuts迂回と違い、権限さえ渡せばすぐ使える。MAS版では使わず、
//! Shortcuts受け口 (macos.rs) と併存する。どちらも同じパイプラインへ流す。
//!
//! 方式: NotificationCenterプロセスの新規ウィンドウをAXObserverで監視し、
//! バナーらしい小窓のテキストを拾う。ウィジェット等の既存窓は対象外
//! (起動後に生まれた窓だけ見る)。判定は内容ベースで重複除去する。

use std::collections::HashMap;
use std::ffi::c_void;
use std::os::raw::{c_int, c_long};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock};
use std::time::{Duration, Instant};

use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::string::{CFString, CFStringRef};
use tauri::{AppHandle, Manager};

use crate::{speak_notification, AppSettings};

type AXError = c_int;
type AXUIElementRef = *mut c_void;
type AXObserverRef = *mut c_void;
type CFRunLoopRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopMode = *const c_void;

const KAX_ERROR_SUCCESS: AXError = 0;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;

    fn AXUIElementCreateApplication(pid: c_int) -> AXUIElementRef;
    fn AXObserverCreate(
        pid: c_int,
        callback: extern "C" fn(AXObserverRef, AXUIElementRef, CFStringRef, *mut c_void),
        out_observer: *mut AXObserverRef,
    ) -> AXError;
    fn AXObserverAddNotification(
        observer: AXObserverRef,
        element: AXUIElementRef,
        notification: CFStringRef,
        refcon: *mut c_void,
    ) -> AXError;
    fn AXObserverGetRunLoopSource(observer: AXObserverRef) -> CFRunLoopSourceRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut *const c_void,
    ) -> AXError;

    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
    fn CFRunLoopRun();
    fn CFGetTypeID(cf: *const c_void) -> c_long;
    fn CFStringGetTypeID() -> c_long;
}

/// AX定数は同名の文字列リテラルと等価 (公開仕様)。
/// 静的リンクでは解決できない環境があるため実行時に生成する。
fn ax_string(name: &str) -> CFString {
    CFString::new(name)
}

fn run_loop_mode() -> CFRunLoopMode {
    // 起動時に一度だけ使う定数。解放せず置いておく。
    let mode = CFString::new("kCFRunLoopDefaultMode");
    let ptr = mode.as_concrete_TypeRef() as CFRunLoopMode;
    std::mem::forget(mode);
    ptr
}

/// 許可済みか (ダイアログは出さない)。
pub fn trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// プロンプト付きで許可を要求する。初回はシステムダイアログが出る。
pub fn request_prompt() -> bool {
    unsafe {
        let key = ax_string("AXTrustedCheckOptionPrompt");
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

/// 読み上げ済み内容のハッシュ。複数経路の二重読み上げを防ぐ (TTL 120秒)。
fn seen_contents() -> &'static Mutex<HashMap<u64, Instant>> {
    static SEEN: OnceLock<Mutex<HashMap<u64, Instant>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 未読なら true (かつ既読化する)。
fn mark_fresh_content(texts: &[String]) -> bool {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    texts.hash(&mut h);
    let key = h.finish();
    let now = Instant::now();
    seen_contents()
        .lock()
        .map(|mut s| {
            s.retain(|_, t| now.duration_since(*t) < Duration::from_secs(120));
            if s.contains_key(&key) {
                false
            } else {
                s.insert(key, now);
                true
            }
        })
        .unwrap_or(true)
}

/// ウィンドウの矩形 (AXPosition/AXSize)。取れなければNone。
/// バナー判定に使う: 画面内の小さな窓だけを通す。
unsafe fn ax_bounds(element: AXUIElementRef) -> Option<(f64, f64, f64, f64)> {
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct CGSize {
        w: f64,
        h: f64,
    }
    extern "C" {
        fn AXValueGetValue(value: *const c_void, the_type: *const c_void, out: *mut c_void) -> bool;
    }
    let pos_attr = ax_string("AXPosition");
    let size_attr = ax_string("AXSize");
    let point_type = CFString::new("CGPoint");
    let size_type = CFString::new("CGSize");
    let mut pos_val: *const c_void = std::ptr::null();
    let mut size_val: *const c_void = std::ptr::null();
    if AXUIElementCopyAttributeValue(
        element,
        pos_attr.as_concrete_TypeRef(),
        &mut pos_val,
    ) != KAX_ERROR_SUCCESS
        || pos_val.is_null()
    {
        return None;
    }
    if AXUIElementCopyAttributeValue(
        element,
        size_attr.as_concrete_TypeRef(),
        &mut size_val,
    ) != KAX_ERROR_SUCCESS
        || size_val.is_null()
    {
        return None;
    }
    let mut p = CGPoint { x: 0.0, y: 0.0 };
    let mut s = CGSize { w: 0.0, h: 0.0 };
    let ok_p = AXValueGetValue(
        pos_val,
        point_type.as_concrete_TypeRef() as *const c_void,
        &mut p as *mut _ as *mut c_void,
    );
    let ok_s = AXValueGetValue(
        size_val,
        size_type.as_concrete_TypeRef() as *const c_void,
        &mut s as *mut _ as *mut c_void,
    );
    if !ok_p || !ok_s {
        return None;
    }
    Some((p.x, p.y, s.w, s.h))
}

/// バナーらしい窓か: 画面内で小さく、上部にあるもの。
/// ウィジェット (画面外) や通知センターパネル (巨大) を弾く。
fn is_banner_bounds(b: Option<(f64, f64, f64, f64)>) -> bool {
    match b {
        Some((x, y, w, h)) => x >= 0.0 && y >= 0.0 && y < 500.0 && w >= 250.0 && h > 0.0 && h <= 300.0,
        None => false,
    }
}
/// 既存窓の走査 (起動直後・定期)。バナーらしい窓だけ拾う。
/// observerと二重になってもmark_fresh_contentで弾く。
fn scan_once(handle: &AppHandle) {
    let texts_list = all_window_texts();
    let settings = handle.state::<AppSettings>();
    for (texts, bounds) in texts_list {
        if !is_banner_bounds(bounds) {
            continue;
        }
        if texts.is_empty() || texts.len() > 6 {
            continue;
        }
        if !mark_fresh_content(&texts) {
            continue;
        }
        eprintln!("[readapp] ax scan texts: {:?}", texts);
        let (app_id, title, body) = split_banner(&texts);
        if title.is_empty() && body.is_empty() {
            continue;
        }
        crate::record_received(&settings, &app_id, &title, &body);
        speak_notification(&settings, &app_id, &title, &body);
    }
}

/// NotificationCenter系プロセスの全窓テキストを集める (矩形付き)。
fn all_window_texts() -> Vec<(Vec<String>, Option<(f64, f64, f64, f64)>)> {
    let mut out = Vec::new();
    for proc in ["NotificationCenter", "UserNotificationCenter"] {
        let pid = match process_pid(proc) {
            Some(p) => p,
            None => continue,
        };
        unsafe {
            let app_el = AXUIElementCreateApplication(pid);
            if app_el.is_null() {
                continue;
            }
            for win in ax_windows(app_el) {
                let bounds = ax_bounds(win);
                let texts = collect_texts(win, 0);
                if !texts.is_empty() {
                    out.push((texts, bounds));
                }
            }
        }
    }
    out
}

/// アプリ要素の全ウィンドウ (AXWindows属性)。
unsafe fn ax_windows(app_el: AXUIElementRef) -> Vec<AXUIElementRef> {
    let attr = ax_string("AXWindows");
    let mut value: *const c_void = std::ptr::null();
    if AXUIElementCopyAttributeValue(app_el, attr.as_concrete_TypeRef(), &mut value) != KAX_ERROR_SUCCESS {
        return Vec::new();
    }
    if value.is_null() {
        return Vec::new();
    }
    let count = cf_array_count(value);
    (0..count)
        .map(|i| cf_array_value(value, i) as AXUIElementRef)
        .filter(|e| !e.is_null())
        .collect()
}

fn process_pid(name: &str) -> Option<c_int> {
    std::process::Command::new("pgrep")
        .arg("-x")
        .arg(name)
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()?
                .trim()
                .parse()
                .ok()
        })
}

/// 監視が開始済みか (許可後に自動開始される)。
static STARTED: AtomicBool = AtomicBool::new(false);

pub fn watching() -> bool {
    STARTED.load(Ordering::SeqCst)
}

/// 許可済みなら監視を開始する。未許可なら許可されるまで待ち続ける。
/// (設定画面で後から許可した場合や再起動なしで有効化するため)
/// observer (新着) + 5秒走査 (既存・取りこぼし) の二経路。
pub fn start_if_trusted(handle: AppHandle) {
    std::thread::spawn(move || loop {
        if !STARTED.load(Ordering::SeqCst) && trusted() {
            STARTED.store(true, Ordering::SeqCst);
            // 既存分をまず拾う
            scan_once(&handle);
            let poller = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(5));
                scan_once(&poller);
            });
            start_observer(handle.clone());
            return;
        }
        std::thread::sleep(Duration::from_secs(5));
    });
}

fn start_observer(handle: AppHandle) {
    let Some(pid) = process_pid("NotificationCenter")
        .or_else(|| process_pid("UserNotificationCenter"))
    else {
        eprintln!("[readapp] ax capture: NotificationCenter not found");
        return;
    };
    std::thread::spawn(move || unsafe {
        let app_el = AXUIElementCreateApplication(pid);
        if app_el.is_null() {
            return;
        }
        let mut observer: AXObserverRef = std::ptr::null_mut();
        if AXObserverCreate(pid, observer_callback, &mut observer) != KAX_ERROR_SUCCESS {
            return;
        }
        // AppHandleはアプリ終了まで生きるためBox化して預ける
        let boxed = Box::new(handle);
        let refcon = Box::into_raw(boxed) as *mut c_void;
        if AXObserverAddNotification(
            observer,
            app_el,
            ax_string("AXWindowCreated").as_concrete_TypeRef(),
            refcon,
        ) != KAX_ERROR_SUCCESS
        {
            return;
        }
        let source = AXObserverGetRunLoopSource(observer);
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, run_loop_mode());
        CFRunLoopRun();
    });
}

extern "C" fn observer_callback(
    _observer: AXObserverRef,
    element: AXUIElementRef,
    _notification: CFStringRef,
    refcon: *mut c_void,
) {
    if element.is_null() || refcon.is_null() {
        return;
    }
    // SAFETY: refconは起動時にBox化したAppHandleで、アプリ終了まで生きる。
    let handle = unsafe { &*(refcon as *const AppHandle) };
    let settings = handle.state::<AppSettings>();
    // SAFETY: elementは通知元プロセスの有効なAX要素。
    let bounds = unsafe { ax_bounds(element) };
    if !is_banner_bounds(bounds) {
        return;
    }
    // SAFETY: elementは通知元プロセスの有効なAX要素。
    let texts = unsafe { collect_texts(element, 0) };
    if texts.is_empty() || texts.len() > 6 {
        return;
    }
    if !mark_fresh_content(&texts) {
        return;
    }
    // 調整用に生テキストを残す (実バナー観測で精緻化する)
    eprintln!("[readapp] ax banner texts: {:?}", texts);
    let (app_id, title, body) = split_banner(&texts);
    // 空の受信は記録だけして喋らない
    if title.is_empty() && body.is_empty() {
        return;
    }
    crate::record_received(&settings, &app_id, &title, &body);
    speak_notification(&settings, &app_id, &title, &body);
}

/// AXツリーから表示テキストを順に集める (深さ4まで)。
unsafe fn collect_texts(element: AXUIElementRef, depth: u8) -> Vec<String> {
    let mut out = Vec::new();
    if element.is_null() || depth > 4 {
        return out;
    }
    if let Some(role) = attr_string(element, &ax_string("AXRole")) {
        if role == "AXStaticText" {
            if let Some(v) = attr_string(element, &ax_string("AXValue")) {
                let v = v.trim().to_string();
                if !v.is_empty() {
                    out.push(v);
                }
            }
            return out;
        }
    }
    for child in attr_children(element) {
        out.extend(collect_texts(child, depth + 1));
        if out.len() > 12 {
            break;
        }
    }
    out
}

/// バナーテキストの約束 (暫定): 先頭=アプリ名、次=タイトル、残り=本文。
/// アプリ名は設定キーに正規化する (Slack→slack)。未知はそのまま別アプリ扱い。
fn split_banner(texts: &[String]) -> (String, String, String) {
    let norm = |s: &str| {
        s.to_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
    };
    match texts {
        [] => ("通知".to_string(), String::new(), String::new()),
        [a] => {
            let id = norm(a);
            (if id.is_empty() { "通知".to_string() } else { id }, a.clone(), String::new())
        }
        [a, b, rest @ ..] => {
            let id = norm(a);
            (
                if id.is_empty() { "通知".to_string() } else { id },
                b.clone(),
                rest.join("\n"),
            )
        }
    }
}

unsafe fn attr_string(element: AXUIElementRef, attr: &CFString) -> Option<String> {
    let mut value: *const c_void = std::ptr::null();
    if AXUIElementCopyAttributeValue(element, attr.as_concrete_TypeRef(), &mut value) != KAX_ERROR_SUCCESS {
        return None;
    }
    if value.is_null() || CFGetTypeID(value) != CFStringGetTypeID() {
        return None;
    }
    let s: CFString = CFString::wrap_under_create_rule(value as CFStringRef);
    Some(s.to_string())
}

unsafe fn attr_children(element: AXUIElementRef) -> Vec<AXUIElementRef> {
    let children_attr = ax_string("AXChildren");
    let mut value: *const c_void = std::ptr::null();
    if AXUIElementCopyAttributeValue(element, children_attr.as_concrete_TypeRef(), &mut value) != KAX_ERROR_SUCCESS {
        return Vec::new();
    }
    if value.is_null() {
        return Vec::new();
    }
    // CFArrayの中身は借用 (解放しない)
    let count = cf_array_count(value);
    (0..count)
        .map(|i| cf_array_value(value, i) as AXUIElementRef)
        .filter(|e| !e.is_null())
        .collect()
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: *const c_void) -> c_long;
    fn CFArrayGetValueAtIndex(array: *const c_void, idx: c_long) -> *const c_void;
}

unsafe fn cf_array_count(array: *const c_void) -> c_long {
    CFArrayGetCount(array)
}

unsafe fn cf_array_value(array: *const c_void, idx: c_long) -> *const c_void {
    CFArrayGetValueAtIndex(array, idx)
}
