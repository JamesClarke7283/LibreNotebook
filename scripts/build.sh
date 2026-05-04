#!/usr/bin/env bash
# Builds an AppDir at dist/AppDir containing:
#   usr/bin/librenotebook-server   (deno-compiled HTTP server binary)
#   usr/bin/librenotebook-window   (Neutralino native binary)
#   usr/bin/librenotebook          (the unified launcher script)
#   usr/share/applications/librenotebook.desktop
#   usr/share/icons/hicolor/256x256/apps/librenotebook.png
#   AppRun, librenotebook.desktop, librenotebook.png  (AppImage shape)
#
# Used as the source layer for both the .deb and AppImage builders.
#
# Requires:  deno, rsvg-convert
# Optional:  yt-dlp (only at runtime, not build-time)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DIST="$ROOT/dist"
APPDIR="$DIST/AppDir"

VERSION="$(grep -oP '"version"\s*:\s*"\K[^"]+' neutralino.config.json | head -1)"
ARCH_DEB="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
ARCH_APPIMAGE="x86_64"

echo "==> cleaning $DIST"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" \
         "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/256x256/apps"

# 1. Vite build (produces _fresh/server.js + _fresh/static/...)
echo "==> deno task build (vite)"
deno task build

# 2. deno compile the server
echo "==> deno compile (server)"
COMPILE_INCLUDES=( --include _fresh --include static )
if [ -d resources ]; then COMPILE_INCLUDES+=( --include resources ); fi
if [ -e node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs ]; then
  COMPILE_INCLUDES+=( --include node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs )
fi
deno compile \
  --allow-all \
  --no-check \
  "${COMPILE_INCLUDES[@]}" \
  --output "$APPDIR/usr/bin/librenotebook-server" \
  scripts/server-entry.ts

# 3. Bundle the Neutralino native binary for windowed mode.
echo "==> bundling neutralino native binary"
if [ -e bin/neutralino-linux_x64 ]; then
  cp bin/neutralino-linux_x64 "$APPDIR/usr/bin/librenotebook-window"
  chmod +x "$APPDIR/usr/bin/librenotebook-window"
else
  echo "WARN: bin/neutralino-linux_x64 not found — windowed mode will be unavailable in the bundle." >&2
fi
# Ship the resources/ tree alongside (Neutralino's --document-root needs it).
if [ -d resources ]; then
  mkdir -p "$APPDIR/usr/share/librenotebook/"
  cp -r resources "$APPDIR/usr/share/librenotebook/resources"
fi

# 4. Icon + desktop entry.
echo "==> rendering icon"
if command -v rsvg-convert >/dev/null 2>&1 && [ -e static/icon.svg ]; then
  rsvg-convert -w 256 -h 256 static/icon.svg \
    -o "$APPDIR/usr/share/icons/hicolor/256x256/apps/librenotebook.png"
  cp "$APPDIR/usr/share/icons/hicolor/256x256/apps/librenotebook.png" \
     "$APPDIR/librenotebook.png"
fi

cat > "$APPDIR/librenotebook.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=LibreNotebook
GenericName=AI Notebook
Comment=Open-source NotebookLM (offline-first AI notebook)
Exec=librenotebook
Icon=librenotebook
Terminal=false
Categories=Office;Education;Utility;
StartupWMClass=LibreNotebook
EOF
cp "$APPDIR/librenotebook.desktop" \
   "$APPDIR/usr/share/applications/librenotebook.desktop"

# 5. Unified launcher.
cat > "$APPDIR/usr/bin/librenotebook" <<'EOF'
#!/usr/bin/env bash
# LibreNotebook launcher.
#
#   librenotebook server [--port N]   # headless, attaches to terminal
#   librenotebook window [--port N]   # opens the desktop window
#
# Honours $PORT (default 5173) and $YT_DLP_PATH (auto-detected if unset).
set -euo pipefail

# Resolve the directory of THIS script (not symlinks).
self="$(readlink -f "$0")"
HERE="$(dirname "$self")"

# When installed via .deb, binaries live under /usr/lib/librenotebook;
# in an AppDir/AppImage, they sit alongside this script. Pick the
# first hit.
SERVER=""
WINDOW=""
RESOURCES=""
for cand in \
  "$HERE/librenotebook-server" \
  "$(dirname "$HERE")/lib/librenotebook/librenotebook-server" \
  "/usr/lib/librenotebook/librenotebook-server"; do
  [ -x "$cand" ] && SERVER="$cand" && break
done
for cand in \
  "$HERE/librenotebook-window" \
  "$(dirname "$HERE")/lib/librenotebook/librenotebook-window" \
  "/usr/lib/librenotebook/librenotebook-window"; do
  [ -x "$cand" ] && WINDOW="$cand" && break
done
for cand in \
  "$(dirname "$HERE")/share/librenotebook/resources" \
  "/usr/share/librenotebook/resources"; do
  [ -d "$cand" ] && RESOURCES="$cand" && break
done

if [ -z "$SERVER" ]; then
  echo "librenotebook: server binary not found near $HERE" >&2
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
    if [ -z "$WINDOW" ]; then
      echo "librenotebook: windowed mode unavailable (no native binary bundled)." >&2
      echo "Falling back to server mode." >&2
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
    sed -n '1,20p' "$self"
    ;;
  *)
    echo "Usage: librenotebook [server|window] [--port N]" >&2
    exit 64
    ;;
esac
EOF
chmod +x "$APPDIR/usr/bin/librenotebook"

# 6. AppImage AppRun (the entry point an AppImage runs).
cat > "$APPDIR/AppRun" <<'EOF'
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/librenotebook" "$@"
EOF
chmod +x "$APPDIR/AppRun"

# 7. Stash version + arch for downstream packagers.
echo "VERSION=$VERSION" > "$DIST/build.env"
echo "ARCH_DEB=$ARCH_DEB" >> "$DIST/build.env"
echo "ARCH_APPIMAGE=$ARCH_APPIMAGE" >> "$DIST/build.env"

echo "==> done. AppDir at $APPDIR (version=$VERSION)"
