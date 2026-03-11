#!/bin/bash
# patch.command — double-click to patch your TikTok archive with the favorites feature.
# After running, re-open Archive.html in your browser.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_FAV_JS="$SCRIPT_DIR/starplayer.js"

# ── Pick archive folder ────────────────────────────────────────────────────
ARCHIVE_DIR=$(osascript -e \
  'tell application "Finder"
     set theFolder to choose folder with prompt "Select your TikTok archive folder"
     return POSIX path of theFolder
   end tell' 2>/dev/null)

if [ -z "$ARCHIVE_DIR" ]; then
  echo "Cancelled."
  exit 0
fi

ARCHIVE_DIR="${ARCHIVE_DIR%/}"
ARCHIVE_HTML="$ARCHIVE_DIR/Archive.html"
APPDATA_DIR="$ARCHIVE_DIR/data/.appdata"
DEST_FAV_JS="$APPDATA_DIR/starplayer.js"

# ── Validate ───────────────────────────────────────────────────────────────
if [ ! -f "$ARCHIVE_HTML" ]; then
  osascript -e 'display alert "Archive.html not found" message "Make sure you selected the correct TikTok archive folder."'
  exit 1
fi

if [ ! -d "$APPDATA_DIR" ]; then
  osascript -e 'display alert "data/.appdata not found" message "Make sure the extension has set up the archive folder first."'
  exit 1
fi

if [ ! -f "$SRC_FAV_JS" ]; then
  osascript -e 'display alert "starplayer.js not found" message "Make sure starplayer.js is in the same folder as patch.command."'
  exit 1
fi

# ── Patch Archive.html ─────────────────────────────────────────────────────
# Always re-apply so the interceptor script stays current.
# Strip any previous patch lines first, then inject fresh.
node "$SCRIPT_DIR/patch.js" "$ARCHIVE_DIR"

# ── Copy favorites.js ──────────────────────────────────────────────────────
cp "$SRC_FAV_JS" "$DEST_FAV_JS"
echo "Copied:  $DEST_FAV_JS"

# ── Done ───────────────────────────────────────────────────────────────────
osascript -e 'display alert "Done!" message "Re-open Archive.html in your browser to use the favorites feature."'
