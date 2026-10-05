fn main() {
    // direct_capture: macOSの直接監視 (Accessibility) を組み込むか。
    // MAS版 (feature "mas") はサンドボックスで使えないため外す。
    println!("cargo::rustc-check-cfg=cfg(direct_capture)");
    let macos = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    let mas = std::env::var_os("CARGO_FEATURE_MAS").is_some();
    if macos && !mas {
        println!("cargo::rustc-cfg=direct_capture");
    }
    tauri_build::build()
}
