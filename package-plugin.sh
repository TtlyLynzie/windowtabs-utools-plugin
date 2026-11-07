#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/dist}"
PACKAGE_NAME="windowtabs-utools-plugin.upx"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/windowtabs-utools.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

case "$OUTPUT_DIR" in
  /*) ;;
  *) OUTPUT_DIR="$ROOT_DIR/${OUTPUT_DIR#./}" ;;
esac

mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR/$PACKAGE_NAME"

cp "$ROOT_DIR/plugin.json" "$ROOT_DIR/index.html" "$ROOT_DIR/renderer.js" \
  "$ROOT_DIR/styles.css" "$ROOT_DIR/preload.js" "$ROOT_DIR/logo.png" "$STAGE_DIR/"
cp -R "$ROOT_DIR/helper" "$STAGE_DIR/helper"

(
  cd "$STAGE_DIR"
  if command -v zip >/dev/null 2>&1; then
    zip -qr "$OUTPUT_DIR/$PACKAGE_NAME" .
  elif command -v 7z >/dev/null 2>&1; then
    7z a -tzip -bd -y "$OUTPUT_DIR/$PACKAGE_NAME" . >/dev/null
  elif [ -x "/c/Program Files/7-Zip/7z.exe" ]; then
    "/c/Program Files/7-Zip/7z.exe" a -tzip -bd -y "$OUTPUT_DIR/$PACKAGE_NAME" . >/dev/null
  else
    echo "Neither zip nor 7-Zip is available" >&2
    exit 127
  fi
)

echo "created: $OUTPUT_DIR/$PACKAGE_NAME"
