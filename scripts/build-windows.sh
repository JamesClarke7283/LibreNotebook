#!/usr/bin/env bash
# Build a Windows NSIS installer.
# Output: dist/LibreNotebook-Setup-<version>-x86_64.exe
#
# The installer:
#   - Lays the binaries + resources under
#     %LOCALAPPDATA%\Programs\LibreNotebook (per-user, no admin needed).
#   - Adds a Start Menu shortcut and a Desktop shortcut, both
#     pointing at librenotebook.bat (which starts the server,
#     waits for it, then opens the Neutralino window).
#   - Registers an Add/Remove Programs entry with an Uninstall.exe.
#
# Requires: makensis (NSIS) on the build host. GitHub's
# windows-latest runner has it preinstalled at
# C:\Program Files (x86)\NSIS\makensis.exe; on Linux, install via
# `apt-get install nsis`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build.sh"

DIST="$ROOT/dist"
STAGING="$DIST/staging"
. "$DIST/build.env"

if [ "${TARGET_OS:-}" != "windows" ]; then
  echo "build-windows.sh: TARGET_OS=${TARGET_OS:-?} — set LN_TARGET_OS=windows before calling" >&2
  exit 64
fi

# Stage everything the installer will copy into %INSTDIR%.
WIN_STAGE="$DIST/win-stage"
rm -rf "$WIN_STAGE"
mkdir -p "$WIN_STAGE"

cp "$STAGING/bin/librenotebook-server.exe" "$WIN_STAGE/"
if [ -e "$STAGING/bin/librenotebook-window.exe" ]; then
  cp "$STAGING/bin/librenotebook-window.exe" "$WIN_STAGE/"
fi
if [ -d "$STAGING/resources" ]; then
  cp -r "$STAGING/resources" "$WIN_STAGE/resources"
fi
if [ -e "$STAGING/icon.png" ]; then
  cp "$STAGING/icon.png" "$WIN_STAGE/icon.png"
fi

# Launcher batch file. Starts the server detached, polls until it's
# answering, then runs the Neutralino window. The Start Menu shortcut
# launches it minimised so the brief console window is unobtrusive.
# Modern cmd.exe accepts LF line endings — no need for CRLF conversion.
cat > "$WIN_STAGE/librenotebook.bat" <<'EOF'
@echo off
setlocal
set "HERE=%~dp0"
set "MULTI_USER=0"
if "%PORT%"=="" set "PORT=5173"

start "LibreNotebook Server" /B "" "%HERE%librenotebook-server.exe"

set /a RETRIES=120
:waitloop
curl -s -f -o nul "http://127.0.0.1:%PORT%/onboarding" 2>nul && goto ready
curl -s -f -o nul "http://127.0.0.1:%PORT%/" 2>nul && goto ready
ping -n 1 -w 500 127.0.0.1 >nul
set /a RETRIES-=1
if %RETRIES% gtr 0 goto waitloop
echo LibreNotebook: server didn't start on port %PORT%.
exit /b 1

:ready
if exist "%HERE%librenotebook-window.exe" (
  "%HERE%librenotebook-window.exe" --url=http://localhost:%PORT% --window-title=LibreNotebook --window-width=1200 --window-height=800 --enable-server --document-root="%HERE%resources\" --load-dir-res
) else (
  echo LibreNotebook server running at http://localhost:%PORT% — close this window to stop.
  start "" "http://localhost:%PORT%/"
  pause
)

REM Best-effort cleanup of the server process.
taskkill /IM librenotebook-server.exe /F >nul 2>&1
endlocal
EOF

# NSIS script. Per-user install (no admin prompt), Start Menu +
# Desktop shortcuts, registered uninstaller. Uses paths relative to
# the script location (dist/) so it works regardless of how Git Bash
# spells the working directory on the Windows runner.
NSI="$DIST/installer.nsi"
cat > "$NSI" <<EOF
; LibreNotebook installer (auto-generated, do not edit)
Unicode true
SetCompressor /SOLID lzma

!define APP_NAME      "LibreNotebook"
!define APP_VERSION   "$VERSION"
!define APP_PUBLISHER "LibreNotebook"
!define APP_URL       "https://github.com/JamesClarke7283/LibreNotebook"
!define APP_EXEC      "librenotebook.bat"
!define UNINST_KEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\\\${APP_NAME}"

Name "\${APP_NAME} \${APP_VERSION}"
OutFile "LibreNotebook-Setup-\${APP_VERSION}-x86_64.exe"
InstallDir "\$LOCALAPPDATA\Programs\\\${APP_NAME}"
InstallDirRegKey HKCU "Software\\\${APP_NAME}" "InstallDir"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "\${APP_VERSION}.0"
VIAddVersionKey "ProductName"      "\${APP_NAME}"
VIAddVersionKey "FileDescription"  "Open-source NotebookLM (offline-first AI notebook)"
VIAddVersionKey "FileVersion"      "\${APP_VERSION}"
VIAddVersionKey "ProductVersion"   "\${APP_VERSION}"
VIAddVersionKey "CompanyName"      "\${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright"   "AGPL-v3-or-later"

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "\$INSTDIR\\\${APP_EXEC}"
!define MUI_FINISHPAGE_RUN_TEXT "Run \${APP_NAME} now"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Section "MainSection" SEC_MAIN
  SetOutPath "\$INSTDIR"
  ; Source path is relative to the .nsi file's location (dist/).
  File /r "win-stage\*.*"

  ; Start Menu folder + shortcuts.
  CreateDirectory "\$SMPROGRAMS\\\${APP_NAME}"
  CreateShortCut  "\$SMPROGRAMS\\\${APP_NAME}\\\${APP_NAME}.lnk" \\
                  "\$INSTDIR\\\${APP_EXEC}" "" "\$INSTDIR\\\${APP_EXEC}" 0 \\
                  SW_SHOWMINIMIZED
  CreateShortCut  "\$SMPROGRAMS\\\${APP_NAME}\Uninstall.lnk" \\
                  "\$INSTDIR\Uninstall.exe"

  ; Desktop shortcut.
  CreateShortCut  "\$DESKTOP\\\${APP_NAME}.lnk" \\
                  "\$INSTDIR\\\${APP_EXEC}" "" "\$INSTDIR\\\${APP_EXEC}" 0 \\
                  SW_SHOWMINIMIZED

  ; Add/Remove Programs registration.
  WriteRegStr HKCU "\${UNINST_KEY}" "DisplayName"      "\${APP_NAME}"
  WriteRegStr HKCU "\${UNINST_KEY}" "DisplayVersion"   "\${APP_VERSION}"
  WriteRegStr HKCU "\${UNINST_KEY}" "Publisher"        "\${APP_PUBLISHER}"
  WriteRegStr HKCU "\${UNINST_KEY}" "URLInfoAbout"     "\${APP_URL}"
  WriteRegStr HKCU "\${UNINST_KEY}" "InstallLocation"  "\$INSTDIR"
  WriteRegStr HKCU "\${UNINST_KEY}" "UninstallString"  "\$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "\${UNINST_KEY}" "QuietUninstallString" "\$INSTDIR\Uninstall.exe /S"
  WriteRegDWORD HKCU "\${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "\${UNINST_KEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\\\${APP_NAME}" "InstallDir" "\$INSTDIR"

  WriteUninstaller "\$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; Best-effort: stop a running server before nuking the install dir.
  ExecWait 'taskkill /IM librenotebook-server.exe /F'
  ExecWait 'taskkill /IM librenotebook-window.exe /F'

  Delete "\$DESKTOP\\\${APP_NAME}.lnk"
  Delete "\$SMPROGRAMS\\\${APP_NAME}\\\${APP_NAME}.lnk"
  Delete "\$SMPROGRAMS\\\${APP_NAME}\Uninstall.lnk"
  RMDir  "\$SMPROGRAMS\\\${APP_NAME}"

  RMDir /r "\$INSTDIR"

  DeleteRegKey HKCU "\${UNINST_KEY}"
  DeleteRegKey HKCU "Software\\\${APP_NAME}"
SectionEnd
EOF

# Locate makensis. NSIS preinstalled path on GitHub windows runners is
# `C:\Program Files (x86)\NSIS\makensis.exe`; on Linux it's usually on
# PATH after `apt install nsis`.
MAKENSIS=""
if command -v makensis >/dev/null 2>&1; then
  MAKENSIS="makensis"
elif [ -x "/c/Program Files (x86)/NSIS/makensis.exe" ]; then
  MAKENSIS="/c/Program Files (x86)/NSIS/makensis.exe"
elif [ -x "/c/Program Files/NSIS/makensis.exe" ]; then
  MAKENSIS="/c/Program Files/NSIS/makensis.exe"
else
  echo "build-windows.sh: makensis not found." >&2
  echo "    Install NSIS:" >&2
  echo "      Linux:   sudo apt-get install -y nsis" >&2
  echo "      Windows: choco install -y nsis" >&2
  exit 1
fi

echo "==> running $MAKENSIS"
( cd "$DIST" && "$MAKENSIS" -V2 "installer.nsi" )

OUT="$DIST/LibreNotebook-Setup-${VERSION}-x86_64.exe"
echo "==> $OUT"
