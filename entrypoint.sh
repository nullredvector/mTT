#!/bin/sh
set -e

APPDATA="$ARCHIVE_DIR/data/.appdata"

if [ -d "$APPDATA" ]; then
  cp /app/starplayer.js "$APPDATA/starplayer.js"
  echo "[starplayer] copied starplayer.js → $APPDATA/starplayer.js"
else
  echo "[starplayer] WARNING: $APPDATA not found — archive folder not set up yet"
  echo "[starplayer] starplayer.js will not be available until the extension sets up the archive"
fi

exec node /app/server.js
