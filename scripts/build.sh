#!/usr/bin/env bash
# Common build step for every platform. Produces:
#
#   dist/staging/
#     bin/librenotebook-server[.exe]   # deno-compiled HTTP server binary
#     bin/librenotebook-window[.exe]   # Neutralino native binary (if present)
#     resources/                        # the static `resources/` tree
#     icon.png                          # 256x256 app icon (rendered from static/icon.svg)
#
#   dist/build.env                     # VERSION, TARGET_OS, TARGET_ARCH, ARCH_DEB, etc.
#
# Plus, when targeting Linux, the legacy AppDir at dist/AppDir/ that
# the .deb / .rpm / AppImage packagers consume.
#
# Target selection:
#   LN_TARGET_OS    linux | macos | windows   (defaults: detected from host)
#   LN_TARGET_ARCH  x86_64 | aarch64          (defaults: detected from host)
#
# When the target differs from the host, deno compile is invoked with
# --target=<triple>. Note that npm packages with native addons (e.g.
# better-sqlite3) ship prebuilt .node files for the *current* npm
# install's host — cross-compiling Linux x86_64 → macOS arm64 from a
# single machine without running `npm install` for that target won't
# produce a working binary. The release CI sidesteps this by running
# each platform on its own native runner.
#
# Requires: deno, rsvg-convert (optional for icon)
# Optional at runtime: yt-dlp

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DIST="$ROOT/dist"
STAGING="$DIST/staging"
APPDIR="$DIST/AppDir"

# Portable version extraction: works on GNU and BSD awk (macOS).
# `grep -oP` would be cleaner but isn't available on BSD grep.
VERSION="$(awk -F\" '/"version"[[:space:]]*:/ { print $4; exit }' neutralino.config.json)"

# ---------------------------------------------------------------- target

# Detect host.
HOST_OS=""; HOST_ARCH=""
case "$(uname -s)" in
  Linux*)   HOST_OS="linux"   ;;
  Darwin*)  HOST_OS="macos"   ;;
  MINGW*|MSYS*|CYGWIN*) HOST_OS="windows" ;;
  *)        HOST_OS="linux"   ;;
esac
case "$(uname -m)" in
  x86_64|amd64) HOST_ARCH="x86_64" ;;
  arm64|aarch64) HOST_ARCH="aarch64" ;;
  *) HOST_ARCH="$(uname -m)" ;;
esac

TARGET_OS="${LN_TARGET_OS:-$HOST_OS}"
TARGET_ARCH="${LN_TARGET_ARCH:-$HOST_ARCH}"

# Map (os, arch) → deno target triple, neutralino binary name, exec suffix.
DENO_TARGET=""; NEU_BIN=""; EXE_SUFFIX=""
case "$TARGET_OS:$TARGET_ARCH" in
  linux:x86_64)
    DENO_TARGET="x86_64-unknown-linux-gnu"
    NEU_BIN="neutralino-linux_x64"
    ;;
  linux:aarch64)
    DENO_TARGET="aarch64-unknown-linux-gnu"
    NEU_BIN="neutralino-linux_arm64"
    ;;
  macos:x86_64)
    DENO_TARGET="x86_64-apple-darwin"
    NEU_BIN="neutralino-mac_x64"
    ;;
  macos:aarch64)
    DENO_TARGET="aarch64-apple-darwin"
    NEU_BIN="neutralino-mac_arm64"
    ;;
  windows:x86_64)
    DENO_TARGET="x86_64-pc-windows-msvc"
    NEU_BIN="neutralino-win_x64.exe"
    EXE_SUFFIX=".exe"
    ;;
  *)
    echo "unsupported target: ${TARGET_OS}-${TARGET_ARCH}" >&2
    echo "supported: linux-x86_64, linux-aarch64, macos-x86_64, macos-aarch64, windows-x86_64" >&2
    exit 64
    ;;
esac

# Per-target arch aliases used by the Linux packagers.
case "$TARGET_ARCH" in
  x86_64)  ARCH_DEB="amd64";  RPM_ARCH="x86_64";  ARCH_APPIMAGE="x86_64"  ;;
  aarch64) ARCH_DEB="arm64";  RPM_ARCH="aarch64"; ARCH_APPIMAGE="aarch64" ;;
esac

echo "==> target: ${TARGET_OS}-${TARGET_ARCH}  (deno: ${DENO_TARGET})"

# ---------------------------------------------------------------- prep

echo "==> cleaning $DIST/{staging,AppDir}"
rm -rf "$STAGING" "$APPDIR"
mkdir -p "$STAGING/bin" "$STAGING/resources"

# 1. Vite build (produces _fresh/server.js + _fresh/static/...). Output is
#    plain JS so it's identical for every target.
echo "==> deno task build (vite)"
deno task build

# 2. deno compile the server for the target.
echo "==> deno compile (server, target=$DENO_TARGET)"
COMPILE_INCLUDES=( --include _fresh --include static )
if [ -d resources ]; then COMPILE_INCLUDES+=( --include resources ); fi
if [ -e node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs ]; then
  COMPILE_INCLUDES+=( --include node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs )
fi
deno compile \
  --allow-all \
  --no-check \
  --target "$DENO_TARGET" \
  "${COMPILE_INCLUDES[@]}" \
  --output "$STAGING/bin/librenotebook-server${EXE_SUFFIX}" \
  scripts/server-entry.ts

# 3. Neutralino native binary for windowed mode.
echo "==> bundling neutralino native binary ($NEU_BIN)"
if [ -e "bin/$NEU_BIN" ]; then
  cp "bin/$NEU_BIN" "$STAGING/bin/librenotebook-window${EXE_SUFFIX}"
  chmod +x "$STAGING/bin/librenotebook-window${EXE_SUFFIX}" || true
else
  echo "WARN: bin/$NEU_BIN not found — windowed mode will be unavailable in the bundle." >&2
fi

# 4. Resources tree (Neutralino's --document-root needs it).
if [ -d resources ]; then
  cp -r resources/. "$STAGING/resources/"
fi

# 5. Icon.
if command -v rsvg-convert >/dev/null 2>&1 && [ -e static/icon.svg ]; then
  echo "==> rendering icon"
  rsvg-convert -w 256 -h 256 static/icon.svg -o "$STAGING/icon.png"
elif [ -e static/favicon.png ]; then
  cp static/favicon.png "$STAGING/icon.png"
fi

# 6. Stash version + arch for downstream packagers.
cat > "$DIST/build.env" <<EOF
VERSION=$VERSION
TARGET_OS=$TARGET_OS
TARGET_ARCH=$TARGET_ARCH
DENO_TARGET=$DENO_TARGET
NEU_BIN=$NEU_BIN
EXE_SUFFIX=$EXE_SUFFIX
ARCH_DEB=$ARCH_DEB
RPM_ARCH=$RPM_ARCH
ARCH_APPIMAGE=$ARCH_APPIMAGE
EOF

# ---------------------------------------------------------------- linux AppDir

if [ "$TARGET_OS" != "linux" ]; then
  echo "==> done. staging dir at $STAGING (target=${TARGET_OS}-${TARGET_ARCH}, version=$VERSION)"
  exit 0
fi

# Lay out the legacy AppDir that the .deb / .rpm / AppImage builders
# consume. Layout:
#   AppDir/usr/bin/librenotebook-server
#   AppDir/usr/bin/librenotebook-window
#   AppDir/usr/bin/librenotebook                  (launcher script)
#   AppDir/usr/share/applications/librenotebook.desktop
#   AppDir/usr/share/icons/hicolor/256x256/apps/librenotebook.png
#   AppDir/usr/share/librenotebook/resources/...
#   AppDir/AppRun, AppDir/librenotebook.desktop, AppDir/librenotebook.png   (AppImage shape)

mkdir -p "$APPDIR/usr/bin" \
         "$APPDIR/usr/share/applications" \
         "$APPDIR/usr/share/icons/hicolor/256x256/apps"

cp "$STAGING/bin/librenotebook-server" "$APPDIR/usr/bin/librenotebook-server"
chmod +x "$APPDIR/usr/bin/librenotebook-server"
if [ -e "$STAGING/bin/librenotebook-window" ]; then
  cp "$STAGING/bin/librenotebook-window" "$APPDIR/usr/bin/librenotebook-window"
  chmod +x "$APPDIR/usr/bin/librenotebook-window"
fi
if [ -d "$STAGING/resources" ]; then
  mkdir -p "$APPDIR/usr/share/librenotebook/"
  cp -r "$STAGING/resources" "$APPDIR/usr/share/librenotebook/resources"
fi

if [ -e "$STAGING/icon.png" ]; then
  cp "$STAGING/icon.png" \
     "$APPDIR/usr/share/icons/hicolor/256x256/apps/librenotebook.png"
  cp "$STAGING/icon.png" "$APPDIR/librenotebook.png"
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

cat > "$APPDIR/usr/bin/librenotebook" <<'EOF'
#!/usr/bin/env bash
# LibreNotebook launcher (Linux).
#
#   librenotebook server [--port N]   # headless, attaches to terminal
#   librenotebook window [--port N]   # opens the desktop window
#
# Honours $PORT (default 5173) and $YT_DLP_PATH (auto-detected if unset).
set -euo pipefail

self="$(readlink -f "$0")"
HERE="$(dirname "$self")"

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
    # Window mode is the desktop-app shape — always single-user.
    export MULTI_USER=0
    if [ -z "$WINDOW" ]; then
      echo "librenotebook: windowed mode unavailable (no native binary bundled)." >&2
      echo "Falling back to server mode (still single-user)." >&2
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

# AppImage AppRun.
cat > "$APPDIR/AppRun" <<'EOF'
#!/usr/bin/env bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/librenotebook" "$@"
EOF
chmod +x "$APPDIR/AppRun"

echo "==> done. AppDir at $APPDIR (target=${TARGET_OS}-${TARGET_ARCH}, version=$VERSION)"
