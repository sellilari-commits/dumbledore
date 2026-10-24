#!/bin/bash
# Builds the Dumbledore helper with Command Line Tools only (no Xcode).
#
#   native/helper/build.sh [release|debug]   → build/dumbledore-helper + build/Dumbledore Helper.app
#   native/helper/build.sh fixtures          → regenerates tests/fixtures/screens (OCR test images)
#
# Env: SIGN_IDENTITY (default "-" = ad-hoc). With a stable certificate, macOS keeps the app's
# Accessibility / Screen Recording grants across rebuilds; ad-hoc signatures change every build.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MODE="${1:-release}"
SDK="$(xcrun --show-sdk-path)"
ARCH="$(uname -m)"
TARGET="${ARCH}-apple-macos15.0"
CACHE="$HERE/.cache/modcache"
OUT="$HERE/build"
mkdir -p "$CACHE" "$OUT"

if [ "$MODE" = fixtures ]; then
  swiftc -O -swift-version 5 -target "$TARGET" -sdk "$SDK" -module-cache-path "$CACHE" \
    -o "$OUT/render-fixtures" "$HERE/tools/RenderFixtures.swift" -framework AppKit
  "$OUT/render-fixtures" --out "$ROOT/tests/fixtures/screens"
  exit 0
fi

if [ "$MODE" = release ]; then OPT=(-O); else OPT=(-Onone -g); fi
BIN="$OUT/dumbledore-helper"
swiftc "${OPT[@]}" -swift-version 6 -target "$TARGET" -sdk "$SDK" -module-cache-path "$CACHE" \
  -module-name DumbledoreHelper -o "$BIN" "$HERE"/Sources/DumbledoreHelper/*.swift \
  -framework AppKit -framework Vision -framework ScreenCaptureKit -framework ApplicationServices \
  -framework CoreGraphics -framework Carbon -framework PDFKit $( [ -d "$SDK/System/Library/Frameworks/FoundationModels.framework" ] && echo "-Xlinker -weak_framework -Xlinker FoundationModels" )

APP="$OUT/Dumbledore Helper.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/dumbledore-helper"
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

IDENTITY="${SIGN_IDENTITY:--}"
codesign --force --sign "$IDENTITY" --identifier org.stuhi.dumbledore.helper "$BIN"
codesign --force --sign "$IDENTITY" --identifier org.stuhi.dumbledore.helper "$APP"
codesign --verify --strict "$APP"
echo "built $BIN"
echo "built $APP"
