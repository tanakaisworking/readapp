#!/bin/bash
# MAS配布用パッケージング (サンドボックス版。通知はショートカット経由のみ)。
#
# 使い方:
#   MAS_PROFILE=~/path/to/readapp.provisionprofile npm run package:mas   # 提出用 .pkg
#   npm run package:mas -- --local                                      # 手元確認用 (Developer ID署名のサンドボックス版)
#
# 提出用の前提: Mac App Store用 provisioning profile (App ID: com.hibachi.readapp)、
#   "3rd Party Mac Developer Application/Installer" 証明書。
set -euo pipefail
cd "$(dirname "$0")/.."

TEAM="TYX92DB6TA"
BUNDLE_ID="com.hibachi.readapp"
ENT="src-tauri/entitlements/mas.plist"
HELPER_ENT="src-tauri/entitlements/mas-helper.plist"
APP="src-tauri/target/release/bundle/macos/Readapp.app"
HELPER="$APP/Contents/Resources/binaries/fm-helper-aarch64-apple-darwin"

LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

if [ "$LOCAL" = 1 ]; then
  APP_ID_NAME="Developer ID Application: HIBACHI inc. ($TEAM)"
else
  if [ -z "${MAS_PROFILE:-}" ] || [ ! -f "$MAS_PROFILE" ]; then
    echo "error: MAS_PROFILE に Mac App Store用 provisioning profile を指定してください" >&2
    echo "       (手元確認だけなら: npm run package:mas -- --local)" >&2
    exit 1
  fi
  if ! security find-identity -v 2>/dev/null | grep -q "3rd Party Mac Developer Installer: HIBACHI inc."; then
    echo "error: '3rd Party Mac Developer Installer' 証明書がありません" >&2
    exit 1
  fi
  APP_ID_NAME="3rd Party Mac Developer Application: HIBACHI inc. ($TEAM)"
fi

# 直接監視 (Accessibility) と、Geminiの声・サーバー経由の声 (cloud-voices) を外したビルド
npx tauri build --config src-tauri/tauri.mas.conf.json --features mas --bundles app

# 内側から署名する (--deep はヘルパーにアプリ用entitlementsを付けてしまうので使わない)
codesign --force --options runtime --entitlements "$HELPER_ENT" --sign "$APP_ID_NAME" "$HELPER"

if [ "$LOCAL" = 1 ]; then
  codesign --force --options runtime --entitlements "$ENT" --sign "$APP_ID_NAME" "$APP"
  codesign --verify --strict "$APP"
  echo "built (local sandbox test): $APP"
  exit 0
fi

cp "$MAS_PROFILE" "$APP/Contents/embedded.provisionprofile"
# 提出版はアプリ識別子をentitlementsに含める (profileと一致させる)
STORE_ENT="$(mktemp -t readapp-mas).plist"
cp "$ENT" "$STORE_ENT"
/usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string $TEAM.$BUNDLE_ID" "$STORE_ENT"
/usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $TEAM" "$STORE_ENT"
codesign --force --options runtime --entitlements "$STORE_ENT" --sign "$APP_ID_NAME" "$APP"
rm -f "$STORE_ENT"
codesign --verify --strict "$APP"

PKG="src-tauri/target/release/bundle/macos/Readapp-mas.pkg"
productbuild --component "$APP" /Applications \
  --sign "3rd Party Mac Developer Installer: HIBACHI inc. ($TEAM)" \
  "$PKG"
echo "built: $PKG"
