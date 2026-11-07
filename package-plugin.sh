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
  zip -qr "$OUTPUT_DIR/$PACKAGE_NAME" .
)

echo "created: $OUTPUT_DIR/$PACKAGE_NAME"
