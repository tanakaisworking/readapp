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

// アプリアイコンのキャラ（顔のある吹き出し）を22pt格子の距離関数で描く。負の値が図形の内側。
fn rounded_rect(x: f32, y: f32) -> f32 {
    let (half_w, half_h, radius) = (8.6, 6.6, 5.6);
    let qx = (x - 11.0).abs() - (half_w - radius);
    let qy = (y - 10.2).abs() - (half_h - radius);
    qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - radius
}

fn triangle(x: f32, y: f32, [a, b, c]: [(f32, f32); 3]) -> f32 {
    let edges = [(a, b), (b, c), (c, a)];
    let orientation = ((b.0 - a.0) * (a.1 - c.1) - (b.1 - a.1) * (a.0 - c.0)).signum();
    let mut distance = f32::MAX;
    let mut inside = true;
    for (start, end) in edges {
        let (ex, ey) = (end.0 - start.0, end.1 - start.1);
        let (vx, vy) = (x - start.0, y - start.1);
        let t = ((vx * ex + vy * ey) / (ex * ex + ey * ey)).clamp(0.0, 1.0);
        distance = distance.min((vx - ex * t).hypot(vy - ey * t));
        inside &= orientation * (vx * ey - vy * ex) > 0.0;
    }
    if inside {
        -distance
    } else {
        distance
    }
}

/// 本体と左下のしっぽをなめらかにつないだ吹き出し。
fn bubble(x: f32, y: f32) -> f32 {
    let body = rounded_rect(x, y);
    let tail = triangle(x, y, [(3.4, 12.0), (10.0, 15.2), (2.6, 20.2)]);
    let blend = 1.6;
    let h = (blend - (body - tail).abs()).max(0.0) / blend;
    body.min(tail) - h * h * blend * 0.25
}

fn ellipse(x: f32, y: f32, cx: f32, cy: f32, rx: f32, ry: f32) -> bool {
    ((x - cx) / rx).powi(2) + ((y - cy) / ry).powi(2) <= 1.0
}

fn ink(x: f32, y: f32, audible: bool) -> bool {
    const DOT: (f32, f32) = (18.4, 4.6);
    let dot = (x - DOT.0).hypot(y - DOT.1);
    if audible {
        // 塗りの吹き出しから目と口を抜き、右上に通知の点を置く。
        if dot <= 2.6 {
            return true;
        }
        let eye = ellipse(x, y, 7.9, 9.3, 1.05, 1.45) || ellipse(x, y, 14.1, 9.3, 1.05, 1.45);
        let smile = ((x - 11.0).hypot(y - 10.3) - 2.5).abs() <= 0.55 && y - 10.3 >= 1.1;
        bubble(x, y).max(4.1 - dot) <= 0.0 && !eye && !smile
    } else {
        // 線だけの吹き出しに閉じた目。
        let outline = (-1.5..=0.0).contains(&bubble(x, y));
        let closed_eye =
            |left: f32| (x - left - (x - left).clamp(0.0, 2.2)).hypot(y - 10.0) <= 0.55;
        outline || closed_eye(6.9) || closed_eye(13.1)
    }
}

/// テンプレート画像。読み上げ中は塗りの笑顔、停止・消音中は線と閉じた目で区別し、明暗テーマはOSに任せる。
fn icon(audible: bool) -> Image<'static> {
    const SIZE: u32 = 44;
    const SAMPLES: u32 = 4;
    let scale = 22.0 / SIZE as f32;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let mut covered = 0;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let x_pos = (x as f32 + (sx as f32 + 0.5) / SAMPLES as f32) * scale;
                    let y_pos = (y as f32 + (sy as f32 + 0.5) / SAMPLES as f32) * scale;
                    covered += u32::from(ink(x_pos, y_pos, audible));
                }
            }
            let samples = SAMPLES * SAMPLES;
            rgba[((y * SIZE + x) * 4 + 3) as usize] =
                ((covered * 255 + samples / 2) / samples) as u8;
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
