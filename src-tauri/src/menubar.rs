//! macOSの日常操作はメニューバー、詳細設定は既存ウィンドウに置く。
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager,
};

use crate::AppSettings;

struct Menubar {
    icon: TrayIcon,
    toggle: MenuItem<tauri::Wry>,
    status: MenuItem<tauri::Wry>,
}

fn labels(enabled: bool, volume: u8) -> (&'static str, &'static str) {
    let toggle = if enabled {
        "読み上げを停止"
    } else {
        "読み上げを再開"
    };
    let status = if !enabled {
        "読み上げ停止中"
    } else if volume == 0 {
        "消音中（音量0%）"
    } else {
        "通知の読み上げが有効"
    };
    (toggle, status)
}

/// テンプレート画像。波形／×で状態を区別し、明暗テーマはOSに任せる。
fn icon(audible: bool) -> Image<'static> {
    const SIZE: u32 = 44;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let x_pos = (x as f32 + 0.5) / 2.0;
            let y_pos = (y as f32 + 0.5) / 2.0;
            let speaker = (3.0..=7.0).contains(&x_pos) && (8.0..=14.0).contains(&y_pos)
                || (7.0..=12.0).contains(&x_pos)
                    && y_pos >= 8.0 - (x_pos - 7.0) * 0.8
                    && y_pos <= 14.0 + (x_pos - 7.0) * 0.8;
            let mark = if audible {
                let radius = ((x_pos - 10.0).powi(2) + (y_pos - 11.0).powi(2)).sqrt();
                x_pos > 13.0 && ((radius - 5.0).abs() < 0.6 || (radius - 8.0).abs() < 0.6)
            } else {
                (14.0..=20.0).contains(&x_pos)
                    && (8.0..=14.0).contains(&y_pos)
                    && ((x_pos - 17.0 - (y_pos - 11.0)).abs() < 0.7
                        || (x_pos - 17.0 + (y_pos - 11.0)).abs() < 0.7)
            };
            if speaker || mark {
                rgba[((y * SIZE + x) * 4 + 3) as usize] = 255;
            }
        }
    }
    Image::new_owned(rgba, SIZE, SIZE)
}

pub(crate) fn install(app: &AppHandle) -> tauri::Result<()> {
    let settings = app.state::<AppSettings>();
    let enabled = settings.speech_enabled();
    let volume = settings.volume();
    let (toggle_text, status_text) = labels(enabled, volume);
    let toggle = MenuItem::with_id(
        app,
        "readapp-speech-toggle",
        toggle_text,
        true,
        None::<&str>,
    )?;
    let status = MenuItem::with_id(
        app,
        "readapp-speech-status",
        status_text,
        false,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let settings_item =
        MenuItem::with_id(app, "readapp-settings", "設定を開く…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "readapp-quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &status, &separator, &settings_item, &quit])?;
    let tray = TrayIconBuilder::with_id("readapp-menubar")
        .icon(icon(enabled && volume > 0))
        .icon_as_template(true)
        .tooltip(format!("readapp — {status_text}"))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "readapp-speech-toggle" => {
                let settings = app.state::<AppSettings>();
                settings.change_speech_enabled(!settings.speech_enabled());
            }
            "readapp-settings" => show_settings(app),
            "readapp-quit" => {
                crate::speech::system::set_enabled(false);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    app.manage(Menubar {
        icon: tray,
        toggle,
        status,
    });
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    Ok(())
}

pub(crate) fn sync(app: &AppHandle, enabled: bool, volume: u8) {
    let Some(menu) = app.try_state::<Menubar>() else {
        return;
    };
    let (toggle, status) = labels(enabled, volume);
    menu.toggle.set_text(toggle).ok();
    menu.status.set_text(status).ok();
    menu.icon
        .set_icon_with_as_template(Some(icon(enabled && volume > 0)), true)
        .ok();
    menu.icon
        .set_tooltip(Some(format!("readapp — {status}")))
        .ok();
}

pub(crate) fn show_settings(app: &AppHandle) {
    let result = (|| -> tauri::Result<()> {
        let window = match app.get_webview_window("main") {
            Some(window) => window,
            None => {
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|w| w.label == "main")
                    .ok_or(tauri::Error::WindowNotFound)?;
                tauri::WebviewWindowBuilder::from_config(app, config)?.build()?
            }
        };
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("設定画面を開けませんでした: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_distinguishes_disabled_muted_and_enabled() {
        assert_eq!(labels(false, 55), ("読み上げを再開", "読み上げ停止中"));
        assert_eq!(labels(false, 0), ("読み上げを再開", "読み上げ停止中"));
        assert_eq!(labels(true, 0), ("読み上げを停止", "消音中（音量0%）"));
        assert_eq!(labels(true, 55), ("読み上げを停止", "通知の読み上げが有効"));
    }

    #[test]
    fn icons_are_distinct_monochrome_templates() {
        let on = icon(true);
        let off = icon(false);
        assert_ne!(on.rgba(), off.rgba());
        for image in [on, off] {
            assert_eq!(
                image.rgba().len(),
                (image.width() * image.height() * 4) as usize
            );
            assert!(image
                .rgba()
                .chunks_exact(4)
                .all(|pixel| pixel[..3] == [0, 0, 0]));
            assert!(image.rgba().chunks_exact(4).any(|pixel| pixel[3] == 255));
            assert!(image.rgba().chunks_exact(4).any(|pixel| pixel[3] == 0));
        }
    }
}
