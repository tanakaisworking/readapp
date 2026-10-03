#!/bin/bash
# MAS配布用パッケージング。
# 前提: Mac App Distribution provisioning profile (環境変数 MAS_PROFILE)
# 使い方: MAS_PROFILE=~/path/to/readapp.provisionprofile npm run package:mas
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${MAS_PROFILE:-}" ] || [ ! -f "$MAS_PROFILE" ]; then
  echo "error: MAS_PROFILE に provisioning profile を指定してください" >&2
  exit 1
fi

if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "3rd Party Mac Installer"; then
  echo "error: '3rd Party Mac Installer' 証明書がありません (Xcodeで発行してください)" >&2
  exit 1
fi

npx tauri build --config src-tauri/tauri.mas.conf.json

APP="src-tauri/target/release/bundle/macos/readapp.app"
cp "$MAS_PROFILE" "$APP/Contents/embedded.provisionprofile"

codesign --deep --force --verify \
  --sign "3rd Party Mac Developer Application: HIBACHI inc. (TYX92DB6TA)" \
  --entitlements src-tauri/entitlements/mas.plist \
  "$APP"

PKG="src-tauri/target/release/bundle/macos/readapp-mas.pkg"
productbuild --component "$APP" /Applications \
  --sign "3rd Party Mac Installer: HIBACHI inc. (TYX92DB6TA)" \
  "$PKG"
echo "built: $PKG"
