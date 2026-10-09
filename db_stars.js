'use strict';
const fs   = require('fs');
const path = require('path');

const ARCHIVE_DIR = process.env.ARCHIVE_DIR || '/archive';
const STARS_FILE  = path.join(ARCHIVE_DIR, 'data', '.appdata', 'stars.json');
const SESSIONS_FILE = path.join(ARCHIVE_DIR, 'data', '.appdata', 'sessions.json');

function load() {
  try {
    const raw = fs.readFileSync(STARS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return { stars: data.stars || {}, groups: data.groups || [], levels: data.levels || {} };
  } catch (_) {
    return { stars: {}, groups: [], levels: {} };
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

function loadSessions() {
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch (_) {
    return [];
  }
}

function saveSessions(sessions) {
  const dir = path.dirname(SESSIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmp = SESSIONS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ sessions }, null, 2), 'utf8');
  fs.renameSync(tmp, SESSIONS_FILE);
}

// ── autotagTT review (suggestions are written by the autotagTT batch job; this file only
// reads them and records the user's explicit decisions). Group membership is never touched here:
// accepting adds the video to its group through the normal /api/stars flow in the browser. ──
const AUTOTAG_FILE  = path.join(ARCHIVE_DIR, 'data', '.appdata', 'autotag', 'autotag.json');
const FEEDBACK_FILE = path.join(ARCHIVE_DIR, 'data', '.appdata', 'autotag_feedback.json');
const TAG_RE = /^[a-z0-9][a-z0-9 _-]{0,39}$/;
const ID_RE  = /^[A-Za-z0-9_-]{1,40}$/;
const isId   = x => typeof x === 'string' && ID_RE.test(x);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function loadFeedback() {
  const raw = readJson(FEEDBACK_FILE);
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [tag, v] of Object.entries(raw)) {
      if (!TAG_RE.test(tag) || !v) continue;
      out[tag] = {
        accepted: Array.isArray(v.accepted) ? v.accepted.filter(isId) : [],
        rejected: Array.isArray(v.rejected) ? v.rejected.filter(isId) : [],
      };
    }
  }
  return out;
}

function loadAutotag(tag) {
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) return { error: 'bad tag' };
  const sugg = readJson(AUTOTAG_FILE);
  const tags = sugg ? Object.keys(sugg).filter(k => k[0] !== '_' && Array.isArray(sugg[k])) : [];
  const fb = loadFeedback()[tag] || { accepted: [], rejected: [] };
  const decided = new Set([...fb.accepted, ...fb.rejected]);
  const list = (sugg && Array.isArray(sugg[tag])) ? sugg[tag] : [];
  const pending = list
    .filter(x => x && isId(x.id) && !decided.has(x.id))
    .map(x => ({ id: x.id, score: Number(x.score) || 0 }));
  const score = new Map(list.map(x => [x && x.id, x && Number(x.score) || 0]));
  const withScore = ids => ids.map(id => ({ id, score: score.get(id) ?? null }));
  return {
    available: !!sugg, tags, tag, pending,
    accepted: withScore(fb.accepted), rejected: withScore(fb.rejected),
    generated: sugg && sugg._meta ? sugg._meta.generated || null : null,
  };
}

// decision: 'accepted' | 'rejected' | 'pending' (undo a rejection). Repeating a decision is a no-op;
// switching an existing decision needs change=true so nothing is overwritten silently.
function recordFeedback(tag, id, decision, change) {
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) return { code: 400, error: 'bad tag' };
  if (!isId(id)) return { code: 400, error: 'bad id' };
  if (!['accepted', 'rejected', 'pending'].includes(decision)) return { code: 400, error: 'bad decision' };
  const all = loadFeedback();
  const fb = all[tag] || { accepted: [], rejected: [] };
  const known = (readJson(AUTOTAG_FILE) || {})[tag];
  const isSuggested = Array.isArray(known) && known.some(x => x && x.id === id);
  const cur = fb.accepted.includes(id) ? 'accepted' : fb.rejected.includes(id) ? 'rejected' : 'pending';
  if (!isSuggested && cur === 'pending') return { code: 404, error: 'unknown suggestion' };
  if (cur === decision) return { code: 200, ok: true, unchanged: true, status: cur };
  if (cur !== 'pending' && !change) return { code: 409, error: 'already ' + cur, status: cur };
  if (cur === 'accepted') return { code: 409, error: 'accepted videos are managed through their group', status: cur };
  fb.rejected = fb.rejected.filter(x => x !== id);
  if (decision === 'accepted') fb.accepted.push(id);
  if (decision === 'rejected') fb.rejected.push(id);
  all[tag] = fb;
  const dir = path.dirname(FEEDBACK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(FEEDBACK_FILE)) fs.copyFileSync(FEEDBACK_FILE, FEEDBACK_FILE + '.bak');
  const tmp = FEEDBACK_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, FEEDBACK_FILE);
  return { code: 200, ok: true, status: decision };
}

module.exports = { load, save, loadSessions, saveSessions, loadAutotag, recordFeedback };
