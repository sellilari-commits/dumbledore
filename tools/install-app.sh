#!/bin/bash
# Builds Dumbledore.app (Swift helper + Electron app), signs it locally and installs it in
# /Applications, then starts it.
#
#   npm run install-app                 build, sign, install, start
#   npm run install-app -- --no-open    same, without starting it
#
# Signing: the helper runs as Dumbledore's child process, so the Accessibility / Screen Recording
# grants belong to Dumbledore.app, and macOS keeps them only while the signature stays the same
# app. So every build is signed with this Mac's "Dumbledore Dev" identity (tools/dev-identity.sh
# creates it on first use, in its own keychain). SIGN_IDENTITY overrides it: a Developer ID name,
# or "-" for ad hoc (tied to one build; macOS then needs the grants again after each install).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm run package   # builds the Swift helper too

ARCH_DIR="release/mac-$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )"
[ -d "$ARCH_DIR" ] || ARCH_DIR="release/mac"
APP="$ARCH_DIR/Dumbledore.app"
HELPER="$APP/Contents/Library/LoginItems/Dumbledore Helper.app"
KEYCHAIN_ARGS=()
if [ -n "${SIGN_IDENTITY:-}" ]; then
  IDENTITY="$SIGN_IDENTITY"
else
  IDENTITY="$(bash tools/dev-identity.sh)"
  DEV_KEYCHAIN="${DUMBLEDORE_DEV_DIR:-$HOME/.dumbledore-dev}/signing.keychain-db"
  KEYCHAIN_ARGS=(--keychain "$DEV_KEYCHAIN")
  # codesign only finds identities in the search list: add the dev keychain while signing, then
  # put the list back exactly as it was (also on failure).
  SEARCH=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    SEARCH+=("${line//\"/}")
  done < <(security list-keychains -d user)
  trap 'security list-keychains -d user -s "${SEARCH[@]}"' EXIT
  security list-keychains -d user -s "${SEARCH[@]}" "$DEV_KEYCHAIN"
fi
# (bash 3.2: an empty array under set -u needs the ${a[@]+…} form)
sign() { codesign --force ${KEYCHAIN_ARGS[@]+"${KEYCHAIN_ARGS[@]}"} --sign "$IDENTITY" "$@"; }

# Inside out: the whole bundle, then the helper with its own identifier, then the outer app again.
sign --deep "$APP"
sign --identifier org.stuhi.dumbledore.helper "$HELPER/Contents/MacOS/dumbledore-helper"
sign --identifier org.stuhi.dumbledore.helper "$HELPER"
sign "$APP"
codesign --verify --deep --strict "$APP"
codesign -dr - "$APP" 2>&1 | sed -n 's/^[# ]*designated => /Signed: /p'

osascript -e 'quit app "Dumbledore"' >/dev/null 2>&1 || true
sleep 1
pkill -f "/Applications/Dumbledore.app/Contents/MacOS/Dumbledore" >/dev/null 2>&1 || true
rm -rf /Applications/Dumbledore.app
ditto "$APP" /Applications/Dumbledore.app
echo "Installed /Applications/Dumbledore.app"

if [ "${1:-}" != "--no-open" ]; then
  open /Applications/Dumbledore.app
fi
