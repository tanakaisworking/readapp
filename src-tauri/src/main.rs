// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // アプリ終了中のローカル設定用。値を引数・出力に出さずKeychainへ保存する。
    if std::env::args().any(|arg| arg == "--import-gemini-key") {
        let result = std::env::var("GEMINI_API_KEY")
            .map_err(|_| "GEMINI_API_KEYが設定されていません".to_owned())
            .and_then(|key| readapp_lib::speech::gemini_key::save(&key).map_err(str::to_owned));
        match result {
            Ok(()) => println!("Gemini APIキーをKeychainへ保存しました"),
            Err(message) => {
                eprintln!("{message}");
                std::process::exit(1);
            }
        }
        return;
    }
    if std::env::args().any(|arg| arg == "--provision-cloud-token") {
        match readapp_lib::speech::premium::provision_token() {
            Ok(hash) => println!("{hash}"),
            Err(message) => {
                eprintln!("{message}");
                std::process::exit(1);
            }
        }
        return;
    }
    readapp_lib::run()
}
