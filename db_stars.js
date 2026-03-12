'use strict';
const fs   = require('fs');
const path = require('path');

const ARCHIVE_DIR = process.env.ARCHIVE_DIR || '/archive';
const STARS_FILE  = path.join(ARCHIVE_DIR, 'data', '.appdata', 'stars.json');

function load() {
  try {
    const raw = fs.readFileSync(STARS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { stars: data.stars || {}, groups: data.groups || [] };
  } catch (_) {
    return { stars: {}, groups: [] };
  }
}

function save(data) {
  const dir = path.dirname(STARS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(data, null, 2);
  const tmp  = STARS_FILE + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, STARS_FILE);
}

module.exports = { load, save };
