#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/dist}"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/windowtabs-utools.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

case "$OUTPUT_DIR" in
  /*) ;;
  *) OUTPUT_DIR="$ROOT_DIR/${OUTPUT_DIR#./}" ;;
esac

MARKET_DIR="$OUTPUT_DIR/market"
mkdir -p "$OUTPUT_DIR"
# Never remove a working market directory until every candidate check passes.
# Staging lives on the destination filesystem so rename does not cross volumes.
rm -rf "$STAGE_DIR"
STAGE_DIR="$(mktemp -d "$OUTPUT_DIR/.market-stage.XXXXXX")"

node "$ROOT_DIR/scripts/validate-helper.mjs" "$ROOT_DIR"

cp "$ROOT_DIR/plugin.json" "$ROOT_DIR/index.html" "$ROOT_DIR/renderer.js" \
  "$ROOT_DIR/styles.css" "$ROOT_DIR/preload.js" "$ROOT_DIR/logo.png" \
  "$ROOT_DIR/settings-model.js" "$ROOT_DIR/settings-schema.json" "$STAGE_DIR/"

# Only ship the active helper selected by current.json. Source code, old
# helper versions, tests, build scripts and documentation stay out of the
# uTools marketplace package.
mkdir -p "$STAGE_DIR/helper"
cp "$ROOT_DIR/helper/current.json" "$STAGE_DIR/helper/current.json"
HELPER_RELATIVE_PATH="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1], "utf8").replace(/^\\uFEFF/, "")); process.stdout.write(m.path || "");' "$ROOT_DIR/helper/current.json")"
case "$HELPER_RELATIVE_PATH" in
  ""|/*|../*|*/../*|*\\..\\*)
    echo "Invalid helper path in current.json: $HELPER_RELATIVE_PATH" >&2
    exit 1
    ;;
esac
HELPER_DIRECTORY="$(dirname "$HELPER_RELATIVE_PATH")"
if [ "$HELPER_DIRECTORY" = "." ] || [ ! -d "$ROOT_DIR/helper/$HELPER_DIRECTORY" ]; then
  echo "Active helper directory not found: $HELPER_DIRECTORY" >&2
  exit 1
fi
mkdir -p "$STAGE_DIR/helper/$HELPER_DIRECTORY"
cp "$ROOT_DIR/helper/$HELPER_RELATIVE_PATH" "$STAGE_DIR/helper/$HELPER_RELATIVE_PATH"
HELPER_ROOT="$ROOT_DIR/helper/$HELPER_DIRECTORY"
if [ -f "$HELPER_ROOT/WindowTabs.exe.config" ]; then
  cp "$HELPER_ROOT/WindowTabs.exe.config" "$STAGE_DIR/helper/$HELPER_DIRECTORY/"
fi
if [ -d "$HELPER_ROOT/Settings" ]; then
  cp -R "$HELPER_ROOT/Settings" "$STAGE_DIR/helper/$HELPER_DIRECTORY/"
fi

node "$ROOT_DIR/scripts/validate-helper.mjs" "$STAGE_DIR"
bash "$ROOT_DIR/scripts/validate-market-dir.sh" "$STAGE_DIR"
PREVIOUS="$OUTPUT_DIR/.market-previous"
if [ -e "$PREVIOUS" ]; then
  echo "Previous publication recovery directory exists: $PREVIOUS" >&2
  exit 1
fi
if [ -d "$MARKET_DIR" ]; then mv "$MARKET_DIR" "$PREVIOUS"; fi
if mv "$STAGE_DIR" "$MARKET_DIR"; then
  rm -rf "$PREVIOUS"
else
  if [ -d "$PREVIOUS" ]; then mv "$PREVIOUS" "$MARKET_DIR"; fi
  exit 1
fi
echo "Marketplace directory ready: $MARKET_DIR"
