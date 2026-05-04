#!/usr/bin/env bash
# Build a macOS .dmg containing the LibreNotebook.app bundle.
# Output: dist/LibreNotebook-<version>-macos-<arch>.dmg
#
# Bundle layout:
#   LibreNotebook.app/
#     Contents/
#       Info.plist
#       MacOS/
#         librenotebook              (launcher — bash)
#         librenotebook-server       (deno-compiled HTTP server)
#         librenotebook-window       (Neutralino native binary)
#       Resources/
#         icon.png
#         resources/                 (the static `resources/` tree)
#
# .dmg is produced via `hdiutil create` (macOS only). The user
# double-clicks the .dmg, sees a window with the .app and an
# "Applications" alias, and drags the .app to install — the
# canonical macOS install pattern.
#
# The bundle is unsigned. macOS Gatekeeper will quarantine it on
# first launch; users open via right-click → Open or
# `xattr -d com.apple.quarantine LibreNotebook.app`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build.sh"

DIST="$ROOT/dist"
STAGING="$DIST/staging"
. "$DIST/build.env"

if [ "${TARGET_OS:-}" != "macos" ]; then
  echo "build-macos.sh: TARGET_OS=${TARGET_OS:-?} — set LN_TARGET_OS=macos before calling" >&2
  exit 64
fi

APP_DIR="$DIST/LibreNotebook.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# Binaries → Contents/MacOS.
cp "$STAGING/bin/librenotebook-server" "$APP_DIR/Contents/MacOS/librenotebook-server"
chmod +x "$APP_DIR/Contents/MacOS/librenotebook-server"
if [ -e "$STAGING/bin/librenotebook-window" ]; then
  cp "$STAGING/bin/librenotebook-window" "$APP_DIR/Contents/MacOS/librenotebook-window"
  chmod +x "$APP_DIR/Contents/MacOS/librenotebook-window"
fi

# Resources tree + icon → Contents/Resources.
if [ -d "$STAGING/resources" ]; then
  cp -r "$STAGING/resources" "$APP_DIR/Contents/Resources/resources"
fi
if [ -e "$STAGING/icon.png" ]; then
  cp "$STAGING/icon.png" "$APP_DIR/Contents/Resources/icon.png"
fi

# Launcher script. Bash is present on macOS.
cat > "$APP_DIR/Contents/MacOS/librenotebook" <<'EOF'
#!/bin/bash
# LibreNotebook launcher (macOS .app).
#
#   librenotebook server [--port N]
#   librenotebook window [--port N]   (default when run from .app)
set -euo pipefail

self="$(cd "$(dirname "$0")" && pwd -P)"
HERE="$self"
RESOURCES="$(cd "$HERE/../Resources/resources" 2>/dev/null && pwd -P || true)"

SERVER="$HERE/librenotebook-server"
WINDOW="$HERE/librenotebook-window"

if [ ! -x "$SERVER" ]; then
  echo "librenotebook: server binary not found at $SERVER" >&2
  exit 1
fi

MODE="${1:-window}"
shift || true
PORT="${PORT:-5173}"
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2;;
    --port=*) PORT="${1#--port=}"; shift;;
    *) shift;;
  esac
done

start_server() {
  PORT="$PORT" "$SERVER" &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
  for _ in $(seq 1 120); do
    if curl -fs "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || \
       curl -fs "http://127.0.0.1:$PORT/onboarding" >/dev/null 2>&1; then
      return
    fi
    sleep 0.5
  done
  echo "librenotebook: server didn't come up on port $PORT" >&2
  exit 1
}

case "$MODE" in
  server)
    start_server
    echo "LibreNotebook running at http://localhost:$PORT"
    wait $SERVER_PID
    ;;
  window)
    # Window mode is single-user always (no .env $MULTI_USER override).
    export MULTI_USER=0
    if [ ! -x "$WINDOW" ]; then
      echo "librenotebook: native window binary not bundled — running headless." >&2
      MODE=server
      start_server
      echo "LibreNotebook running at http://localhost:$PORT"
      wait $SERVER_PID
    else
      start_server
      WIN_ARGS=(
        --url="http://localhost:$PORT"
        --window-title="LibreNotebook"
        --window-width=1200
        --window-height=800
        --enable-server
      )
      if [ -n "$RESOURCES" ]; then
        WIN_ARGS+=( --document-root="$RESOURCES" --load-dir-res )
      fi
      "$WINDOW" "${WIN_ARGS[@]}"
    fi
    ;;
  -h|--help|help)
    sed -n '1,12p' "$0"
    ;;
  *)
    echo "Usage: librenotebook [server|window] [--port N]" >&2
    exit 64
    ;;
esac
EOF
chmod +x "$APP_DIR/Contents/MacOS/librenotebook"

# Info.plist.
case "$TARGET_ARCH" in
  x86_64)  PLIST_ARCH="x86_64"; ARCHIVE_ARCH="x86_64" ;;
  aarch64) PLIST_ARCH="arm64";  ARCHIVE_ARCH="arm64"  ;;
esac

cat > "$APP_DIR/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>LibreNotebook</string>
  <key>CFBundleDisplayName</key>     <string>LibreNotebook</string>
  <key>CFBundleIdentifier</key>      <string>js.librenotebook.app</string>
  <key>CFBundleVersion</key>         <string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>CFBundleExecutable</key>      <string>librenotebook</string>
  <key>CFBundleIconFile</key>        <string>icon.png</string>
  <key>LSMinimumSystemVersion</key>  <string>10.15</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSArchitecturePriority</key>
  <array><string>$PLIST_ARCH</string></array>
  <key>NSHighResolutionCapable</key> <true/>
</dict>
</plist>
EOF

# Build the .dmg. We stage a folder containing the .app + an
# Applications symlink, so when the user mounts the .dmg they see
# the canonical "drag to Applications" view.
DMG_STAGE="$DIST/dmg-stage"
rm -rf "$DMG_STAGE"
mkdir -p "$DMG_STAGE"
cp -R "$APP_DIR" "$DMG_STAGE/LibreNotebook.app"
ln -s /Applications "$DMG_STAGE/Applications"

OUT="$DIST/LibreNotebook-${VERSION}-macos-${ARCHIVE_ARCH}.dmg"
rm -f "$OUT"

if command -v hdiutil >/dev/null 2>&1; then
  hdiutil create \
    -volname "LibreNotebook ${VERSION}" \
    -srcfolder "$DMG_STAGE" \
    -ov \
    -format UDZO \
    "$OUT"
elif command -v genisoimage >/dev/null 2>&1; then
  # Fallback for cross-build on Linux (image won't be a "real" Mac
  # DMG, but mounts on macOS as a UDF/ISO9660). Used for local
  # smoke-tests; CI runs on macOS where hdiutil is present.
  echo "WARN: hdiutil not found — building a UDF image as a stand-in." >&2
  genisoimage -V "LibreNotebook ${VERSION}" -udf -o "$OUT" "$DMG_STAGE"
else
  echo "build-macos.sh: neither hdiutil nor genisoimage available — cannot build .dmg." >&2
  echo "    Run on a macOS host (or install genisoimage on Linux)." >&2
  exit 1
fi

echo "==> $OUT"
echo "    .app bundle at $APP_DIR (unsigned — first-launch:"
echo "    right-click → Open, or: xattr -d com.apple.quarantine LibreNotebook.app)"
