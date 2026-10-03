#!/bin/bash
# Windows版ビルド。NSIS生成にWindowsが必要なため、
# macOS上では検証のみ行う。
set -euo pipefail
cd "$(dirname "$0")/.."

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    npx tauri build --config src-tauri/tauri.win.conf.json
    ;;
  *)
    echo "Windows専用のため、macOS上では検証のみ実行します"
    npm run build
    echo "Rust側のWindows型検査は別途Windows上で実施してください"
    ;;
esac
