#!/usr/bin/env bash
# Build the universal (arm64 + x86_64) version of the native AX watcher.
# Requires Xcode Command Line Tools: `xcrun swiftc`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/watchers/watcher.swift"
OUTPUT="$ROOT/watchers/chrome-allow-watcher"

ARM64="$(mktemp -t chrome-allow-arm64)"
X86_64="$(mktemp -t chrome-allow-x86_64)"

cleanup() {
  rm -f "$ARM64" "$X86_64"
}
trap cleanup EXIT

xcrun swiftc -O -target arm64-apple-macosx11.0 "$SOURCE" -o "$ARM64"
xcrun swiftc -O -target x86_64-apple-macosx11.0 "$SOURCE" -o "$X86_64"

lipo -create "$ARM64" "$X86_64" -output "$OUTPUT"
codesign --force --sign - "$OUTPUT" >/dev/null 2>&1 || true
chmod +x "$OUTPUT"

file "$OUTPUT"
