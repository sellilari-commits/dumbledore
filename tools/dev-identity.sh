#!/bin/bash
# Creates "Dumbledore Dev", a self-signed code-signing identity, once per Mac, in its own keychain
# file (~/.dumbledore-dev/signing.keychain-db). install-app.sh signs every build with it, so macOS
# sees the same app after a rebuild and Accessibility / Screen Recording stay granted (an ad-hoc
# signature is tied to one exact build). The login keychain, the keychain search list and the
# system's trust settings are left as they are. Prints the identity's SHA-1.
#
#   bash tools/dev-identity.sh          create if missing, print the hash
#
# Remove it with: rm -rf ~/.dumbledore-dev   (the next install then asks macOS for the grants again)
set -euo pipefail
DIR="${DUMBLEDORE_DEV_DIR:-$HOME/.dumbledore-dev}"
KEYCHAIN="$DIR/signing.keychain-db"
# Only guards this local keychain file, which sits in a 0700 folder.
PASSWORD="dumbledore-dev"
NAME="Dumbledore Dev"

identity() {
  security find-identity -p codesigning "$KEYCHAIN" 2>/dev/null | awk -v n="\"$NAME\"" 'index($0, n) {print $2; exit}'
}

if [ -f "$KEYCHAIN" ]; then
  security unlock-keychain -p "$PASSWORD" "$KEYCHAIN"
  hash="$(identity)"
  if [ -n "$hash" ]; then
    echo "$hash"
    exit 0
  fi
  echo "dev-identity: $KEYCHAIN has no \"$NAME\" identity; remove the folder and run again" >&2
  exit 1
fi

mkdir -p "$DIR"
chmod 700 "$DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# macOS's LibreSSL: its PKCS#12 defaults are the ones `security import` reads.
/usr/bin/openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null
/usr/bin/openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
  -name "$NAME" -out "$tmp/id.p12" -passout "pass:$PASSWORD"

# create-keychain may add the new file to the search list: put the list back as it was.
search=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  search+=("${line//\"/}")
done < <(security list-keychains -d user)
security create-keychain -p "$PASSWORD" "$KEYCHAIN"
security list-keychains -d user -s "${search[@]}"

security set-keychain-settings "$KEYCHAIN" # no auto-lock
security unlock-keychain -p "$PASSWORD" "$KEYCHAIN"
security import "$tmp/id.p12" -k "$KEYCHAIN" -P "$PASSWORD" -T /usr/bin/codesign >/dev/null
# Let codesign use the key without a Keychain prompt.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASSWORD" "$KEYCHAIN" >/dev/null

hash="$(identity)"
[ -n "$hash" ] || { echo "dev-identity: import failed" >&2; exit 1; }
echo "$hash"
