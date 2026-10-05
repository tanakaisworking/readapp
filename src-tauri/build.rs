use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // direct_capture: macOSの直接監視 (Accessibility) を組み込むか。
    // MAS版 (feature "mas") はサンドボックスで使えないため外す。
    println!("cargo::rustc-check-cfg=cfg(direct_capture)");
    let macos = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    let mas = std::env::var_os("CARGO_FEATURE_MAS").is_some();
    if macos && !mas {
        println!("cargo::rustc-cfg=direct_capture");
    }
    if macos {
        build_app_intents();
    }
    tauri_build::build()
}

fn xcrun(args: &[&str]) -> Option<String> {
    let out = Command::new("xcrun").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// ショートカットの部品「readappで読み上げる」(intents/Intents.swift) を組み込む。
/// Xcodeプロジェクトを使わず、Xcodeと同じ手順を手で踏む (poc/appintents/README.md):
///   1. swiftcで静的ライブラリ化し、const valuesを出す
///   2. appintentsmetadataprocessorで登録情報 Metadata.appintents を作る (gen/intents に出力、バンドル時に同梱)
///   3. -force_load でリンク (Intent型はRustから参照されないため)
fn build_app_intents() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let src = manifest.join("intents/Intents.swift");
    let protocols = manifest.join("intents/protocols.json");
    println!("cargo:rerun-if-changed={}", src.display());
    println!("cargo:rerun-if-changed={}", protocols.display());

    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("intents");
    std::fs::create_dir_all(&out).unwrap();
    let sdk = xcrun(&["--show-sdk-path"]).expect("macOS SDK not found (xcode-select)");
    let swiftc = xcrun(&["--find", "swiftc"]).expect("swiftc not found");
    // 最低対応OSはtauri.conf.json (bundle.macOS.minimumSystemVersion) と揃える
    let target = "arm64-apple-macos15.0";
    let lib = out.join("libReadappIntents.a");

    let status = Command::new(&swiftc)
        .args(["-parse-as-library", "-module-name", "ReadappIntents", "-target", target, "-sdk", &sdk])
        .args(["-O", "-wmo", "-emit-library", "-static", "-emit-const-values"])
        .args(["-Xfrontend", "-const-gather-protocols-file", "-Xfrontend"])
        .arg(&protocols)
        .arg("-emit-module")
        .arg("-emit-module-path")
        .arg(out.join("ReadappIntents.swiftmodule"))
        .arg("-o")
        .arg(&lib)
        .arg(&src)
        .current_dir(&out)
        .status()
        .expect("failed to run swiftc");
    assert!(status.success(), "swiftc failed for intents/Intents.swift");

    generate_metadata(&manifest, &out, &src, &sdk, &swiftc, target);

    let toolchain_swift = Path::new(&swiftc)
        .ancestors()
        .nth(2)
        .map(|usr| usr.join("lib/swift/macosx"))
        .unwrap();
    println!("cargo:rustc-link-arg=-Wl,-force_load,{}", lib.display());
    println!("cargo:rustc-link-search=native={}", toolchain_swift.display());
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-link-lib=framework=AppIntents");
    println!("cargo:rustc-link-lib=framework=Foundation");
}

fn generate_metadata(manifest: &Path, out: &Path, src: &Path, sdk: &str, swiftc: &str, target: &str) {
    let consts = out.join("ReadappIntents.swiftconstvalues");
    let source_list = out.join("sources.txt");
    let const_list = out.join("consts.txt");
    std::fs::write(&source_list, format!("{}\n", src.display())).unwrap();
    std::fs::write(&const_list, format!("{}\n", consts.display())).unwrap();
    let toolchain = Path::new(swiftc).ancestors().nth(3).unwrap();
    // xcodebuild -version の2行目 "Build version 27A266a"
    let xcode_build = Command::new("xcodebuild")
        .arg("-version")
        .output()
        .ok()
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .find_map(|l| l.strip_prefix("Build version ").map(str::to_string))
        })
        .expect("xcodebuild -version failed (Xcode required for App Intents)");
    let meta_out = manifest.join("gen/intents");
    let _ = std::fs::remove_dir_all(&meta_out);
    std::fs::create_dir_all(&meta_out).unwrap();
    let status = Command::new("xcrun")
        .arg("appintentsmetadataprocessor")
        .arg("--output")
        .arg(&meta_out)
        .arg("--toolchain-dir")
        .arg(toolchain)
        .args(["--module-name", "ReadappIntents", "--sdk-root", sdk, "--xcode-version", &xcode_build])
        .args(["--platform-family", "macOS", "--deployment-target", "15.0", "--target-triple", target])
        .arg("--source-file-list")
        .arg(&source_list)
        .arg("--swift-const-vals-list")
        .arg(&const_list)
        .args(["--force", "--quiet-warnings"])
        .status()
        .expect("failed to run appintentsmetadataprocessor");
    assert!(
        status.success() && meta_out.join("Metadata.appintents/extract.actionsdata").is_file(),
        "App Intents metadata generation failed"
    );
}
