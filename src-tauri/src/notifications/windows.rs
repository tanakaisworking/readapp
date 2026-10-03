//! Windows: UserNotificationListener 経由で通知取得 (M2)。
//!
//! 公式capability (`Windows.UI.Notifications.Management`) を使う完成形。
//! 権限ダイアログ1回で、アプリ識別・本文・リアルタイムイベントまで取れる。
//!
//! 注意: このファイルは `cfg(windows)` のため、このMacではコンパイル確認のみ。
//! Windows実機で `cargo check --target x86_64-pc-windows-msvc` と実動作の確認が必要。
//! API名は Microsoft Learn の WinRT リファレンスに準拠。

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};
use windows::{
    ApplicationModel::AppInfo,
    Foundation::TypedEventHandler,
    UI::Notifications::{
        Management::{UserNotificationListener, UserNotificationListenerAccessStatus},
        KnownNotificationBindings, NotificationKinds, UserNotification,
        UserNotificationChangedEventArgs,
    },
    core::Ref,
};

use super::split_title_body;
use crate::{speak_notification, AppSettings};

#[derive(Debug, Clone)]
pub struct WindowsNotification {
    /// 通知ID。初期一覧とイベントの重複除去に使う。
    pub id: u32,
    /// ON/OFFキーにする識別子 (例: Microsoft.Slack_xxx!App)
    pub app_id: String,
    /// 表示名 (取れなければ app_id と同じ)
    pub app_name: String,
    pub title: String,
    pub body: String,
}

/// 読み上げ済み通知ID。初期一覧とイベントの両経路で二重読み上げを防ぐ。
fn seen_ids() -> &'static Mutex<HashSet<u32>> {
    static SEEN: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 未読なら true (かつ既読化する)。二重読み上げ防止用。
fn mark_fresh(id: u32) -> bool {
    seen_ids()
        .lock()
        .map(|mut s| s.insert(id))
        .unwrap_or(true)
}

/// 権限要求の開始はUIスレッドで行い (OSの要請)、完了待ちとリスナー開始は
/// バックグラウンドで行う。setupを止めない。
/// 初回はOSの同意ダイアログが出る。拒否・失敗はログに残す。
pub fn begin_start(handle: AppHandle) {
    let listener = match UserNotificationListener::Current() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[readapp] windows listener unavailable: {e}");
            return;
        }
    };
    let op = match listener.RequestAccessAsync() {
        Ok(op) => op,
        Err(e) => {
            eprintln!("[readapp] windows access request failed: {e}");
            return;
        }
    };
    std::thread::spawn(move || match op.join() {
        Ok(status) if status == UserNotificationListenerAccessStatus::Allowed => {
            start_listener(handle);
        }
        Ok(_) => eprintln!("[readapp] windows notification access denied"),
        Err(e) => eprintln!("[readapp] windows access request failed: {e}"),
    });
}

/// アクショセンター滞留分のトーストを一括取得。
pub fn get_notifications() -> windows::core::Result<Vec<WindowsNotification>> {
    let listener = UserNotificationListener::Current()?;
    let view = listener
        .GetNotificationsAsync(NotificationKinds::Toast)?
        .join()?;
    let mut out = Vec::new();
    let size = view.Size()?;
    for i in 0..size {
        let n = view.GetAt(i)?;
        if let Some(parsed) = extract(&n) {
            out.push(parsed);
        }
    }
    Ok(out)
}

/// 変更監視を開始し、以後は追加のたびにパイプラインへ流す。
/// ハンドラは通知元 (OS側) が保持するため、トークン破棄後も生き続ける。
/// イベント登録を先に行い、初期一覧との取りこぼし・二重読み上げをIDで防ぐ。
/// 登録・取得の失敗はログに残して続行する (片方だけでも動く形にする)。
pub fn start_listener(handle: AppHandle) {
    let listener = match UserNotificationListener::Current() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[readapp] windows listener unavailable: {e}");
            return;
        }
    };
    let moved = handle.clone();
    if let Err(e) = listener.NotificationChanged(&TypedEventHandler::new(
        move |_sender: Ref<UserNotificationListener>, args: Ref<UserNotificationChangedEventArgs>| {
            let Some(a) = args.as_ref() else {
                return Ok(());
            };
            let Ok(id) = a.UserNotificationId() else {
                return Ok(());
            };
            let Ok(listener) = UserNotificationListener::Current() else {
                return Ok(());
            };
            let Ok(n) = listener.GetNotification(id) else {
                return Ok(());
            };
            // 取得成功後に既読化する。失敗時は初期一覧側に任せて取りこぼさない。
            let Some(parsed) = extract(&n) else {
                return Ok(());
            };
            if !mark_fresh(id) {
                return Ok(());
            }
            let settings = moved.state::<AppSettings>();
            settings.observe(&parsed.app_id);
            speak_notification(&settings, &parsed.app_id, &parsed.title, &parsed.body);
            Ok(())
        },
    )) {
        eprintln!("[readapp] windows event registration failed: {e}");
    }
    // 登録後に初期一覧を取得。イベント側で先に拾った分は mark_fresh で弾く。
    match get_notifications() {
        Ok(list) => {
            for n in list {
                if !mark_fresh(n.id) {
                    continue;
                }
                let settings = handle.state::<AppSettings>();
                settings.observe(&n.app_id);
                speak_notification(&settings, &n.app_id, &n.title, &n.body);
            }
        }
        Err(e) => eprintln!("[readapp] windows initial fetch failed: {e}"),
    }
}

/// UserNotification → 自前の形。トースト以外 (bindingなし) は None で捨てる。
fn extract(n: &UserNotification) -> Option<WindowsNotification> {
    let id = n.Id().ok()?;
    let appinfo: AppInfo = n.AppInfo().ok()?;
    let app_id = appinfo.AppUserModelId().ok()?.to_string();
    let app_name = appinfo
        .DisplayInfo()
        .and_then(|d| d.DisplayName())
        .map(|s| s.to_string())
        .unwrap_or_else(|_| app_id.clone());
    let toast = n.Notification().ok()?;
    let visual = toast.Visual().ok()?;
    let binding = visual
        .GetBinding(&KnownNotificationBindings::ToastGeneric().ok()?)
        .ok()?;
    let texts = binding.GetTextElements().ok()?;
    let mut parts = Vec::new();
    let size = texts.Size().ok()?;
    for i in 0..size {
        let t = texts.GetAt(i).ok()?;
        let s = t.Text().ok()?.to_string();
        if !s.trim().is_empty() {
            parts.push(s);
        }
    }
    let (title, body) = split_title_body(parts);
    Some(WindowsNotification {
        id,
        app_id,
        app_name,
        title,
        body,
    })
}
