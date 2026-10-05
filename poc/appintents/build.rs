// 検証用 (2026-10-05)。Swift静的ライブラリ (../swift/libReadappIntents.a) をRust実行ファイルにリンクする。
fn main() {
    let swift_dir = std::env::var("SWIFT_LIB_DIR").expect("SWIFT_LIB_DIR=libReadappIntents.a のあるディレクトリ");
    let tc = "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx";
    println!("cargo:rustc-link-search=native={swift_dir}");
    // Intent型はRustから参照されないので、丸ごと取り込んで消されないようにする
    println!("cargo:rustc-link-arg=-Wl,-force_load,{swift_dir}/libReadappIntents.a");
    println!("cargo:rustc-link-search=native={tc}");
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    for f in ["AppIntents", "AppKit", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={f}");
    }
}
