use std::ffi::CStr;
use std::io::Write;
use std::os::raw::c_char;

/// Swift側 (App Intent) から呼ばれる。
#[no_mangle]
pub extern "C" fn proto_speak(app: *const c_char, text: *const c_char) {
    let app = unsafe { CStr::from_ptr(app) }.to_string_lossy().to_string();
    let text = unsafe { CStr::from_ptr(text) }.to_string_lossy().to_string();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/intentproto-called.log") {
        let _ = writeln!(f, "app={app} text={text}");
    }
    let _ = std::process::Command::new("say").arg("--").arg(&text).status();
}

extern "C" {
    fn proto_run_app();
}

fn main() {
    unsafe { proto_run_app() }
}
