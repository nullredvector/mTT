'use strict';
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const url      = require('url');
const dbStars  = require('./db_stars');

const ARCHIVE_DIR = process.env.ARCHIVE_DIR || '/archive';
const PORT        = parseInt(process.env.PORT || '8080', 10);
const TTPULL_URL  =(process.env.TTPULL_URL || 'http://ttpull:3847').replace(/\/$/, '');

// ── Patch constants (must stay in sync with patch.js) ──────────────────────
const ANCHOR    = '<script src="data/.appdata/app.js"></script>';
const INJECTION = '<script src="data/.appdata/starplayer.js"></script>';
const INTERCEPTOR = `<script>!function(){try{window._mftt={_c:[],dbvd:null};var _s='';var _oc=document.createElement.bind(document);document.createElement=function(t){var el=_oc(t);if((t+'').toLowerCase()==='script'){try{var pd=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');if(pd&&pd.set)Object.defineProperty(el,'src',{configurable:true,get:function(){return pd.get.call(el);},set:function(v){_s=v;pd.set.call(el,v);}});}catch(e){}}return el;};Object.defineProperty(window,'db',{configurable:true,set:function(v){try{window._mftt._c.push({src:_s,data:typeof v==='string'?JSON.parse(v):v});}catch(e){}Object.defineProperty(window,'db',{value:v,configurable:true,writable:true});}}); Object.defineProperty(window,'dbvd',{configurable:true,set:function(v){try{window._mftt.dbvd=typeof v==='string'?JSON.parse(v):v;}catch(e){}Object.defineProperty(window,'dbvd',{value:v,configurable:true,writable:true});}});}catch(e){}}();</script>`;

function patchHtml(html) {
  // Strip any previous patch first (idempotent)
  html = html.replace(INTERCEPTOR + '\n\t' + ANCHOR + '\n\t' + INJECTION, ANCHOR);
  html = html.replace(ANCHOR + '\n\t' + INJECTION, ANCHOR);
  // Inject fresh
  return html.replace(ANCHOR, INTERCEPTOR + '\n\t' + ANCHOR + '\n\t' + INJECTION);
}

// ── MIME types ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.mp4':  'video/mp4',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.json': 'application/json',
};

// ── Server ──────────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname;

  // ── Stars API ──────────────────────────────────────────────────────────────
  if (pathname === '/api/stars') {
    if (req.method === 'GET') {
      const data = dbStars.load();
      const body = JSON.stringify(data);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.method === 'PUT') {
      let chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          dbStars.save({ stars: data.stars || {}, groups: data.groups || [], levels: data.levels || {} });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"Invalid JSON"}');
        }
      });
      return;
    }
    res.writeHead(405); res.end('Method not allowed'); return;
  }

  // ── ttpull live log (proxy) ────────────────────────────────────────────────
  // ttpull keeps its last log lines in memory (GET /logs) and exposes /status. The browser can't
  // reach it directly (other port, possibly HTTPS here), so the log tab polls this proxy.
  if (pathname === '/api/ttpull/logs' && req.method === 'GET') {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    Promise.all([
      fetch(TTPULL_URL + '/logs',   { signal: ctl.signal }).then(r => { if (!r.ok) throw new Error('logs ' + r.status); return r.text(); }),
      fetch(TTPULL_URL + '/status', { signal: ctl.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([text, status]) => {
      const lines = text.split('\n').filter(Boolean);
      const body = JSON.stringify({
        ok: true, lines,
        status: status && { running: !!status.running, phase: status.phase || null, hasSession: !!status.hasSession },
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(body);
    }).catch(e => {
      const reason = e.name === 'AbortError' ? 'timed out' : (e.cause && e.cause.code) || e.message;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: `ttpull unreachable at ${TTPULL_URL} (${reason})` }));
    }).finally(() => clearTimeout(timer));
    return;
  }

  // ── autotagTT review API ───────────────────────────────────────────────────
  // GET  /api/autotag?tag=braces                      → pending suggestions + recorded decisions
  // POST /api/autotag/feedback {tag,id,decision,change?} → records one explicit decision
  // Never edits groups. Like every other endpoint here it has no login of its own (the server is
  // meant to sit behind the LAN/reverse proxy); state-changing calls additionally have to be
  // same-origin JSON so another website can't drive them from the user's browser.
  if (pathname === '/api/autotag' && req.method === 'GET') {
    const tag = String(new URLSearchParams(url.parse(req.url).query || '').get('tag') || 'braces').toLowerCase();
    const out = dbStars.loadAutotag(tag);
    const body = JSON.stringify(out);
    res.writeHead(out.error ? 400 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  if (pathname === '/api/autotag/feedback') {
    if (req.method !== 'POST') { res.writeHead(405); res.end('Method not allowed'); return; }
    const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const origin = req.headers['origin'];
    let sameOrigin = true;
    if (origin) { try { sameOrigin = new URL(origin).host === req.headers['host']; } catch (_) { sameOrigin = false; } }
    if (!sameOrigin) return sendJson(403, { error: 'cross-origin request refused' });
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return sendJson(415, { error: 'JSON required' });
    let size = 0, chunks = [], tooBig = false;
    req.on('data', c => { size += c.length; if (size > 4096) tooBig = true; else chunks.push(c); });
    req.on('end', () => {
      if (tooBig) return sendJson(413, { error: 'body too large' });
      let d;
      try { d = JSON.parse(Buffer.concat(chunks).toString()); } catch (_) { return sendJson(400, { error: 'Invalid JSON' }); }
      if (!d || typeof d !== 'object' || Array.isArray(d)) return sendJson(400, { error: 'Invalid JSON' });
      let r;
      try {
        r = dbStars.recordFeedback(
          typeof d.tag === 'string' ? d.tag.toLowerCase() : '',
          typeof d.id === 'string' ? d.id : '',
          d.decision, d.change === true);
      } catch (_) { r = { code: 500, error: 'could not save feedback' }; }  // no paths or details in the response
      const { code, ...rest } = r;
      sendJson(code, rest);
    });
    return;
  }

  // ── Tab sessions API ───────────────────────────────────────────────────────
  if (pathname === '/api/sessions') {
    if (req.method === 'GET') {
      const body = JSON.stringify({ sessions: dbStars.loadSessions() });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (req.method === 'PUT') {
      let chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          dbStars.saveSessions(Array.isArray(data.sessions) ? data.sessions : []);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"Invalid JSON"}');
        }
      });
      return;
    }
    res.writeHead(405); res.end('Method not allowed'); return;
  }

  const isRoot   = pathname === '/' || pathname === '/Archive.html';

  const filePath = isRoot
    ? path.join(ARCHIVE_DIR, 'Archive.html')
    : path.join(ARCHIVE_DIR, pathname);

  // Basic path traversal guard
  if (!filePath.startsWith(path.resolve(ARCHIVE_DIR))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  // Archive.html: read into memory, patch, send
  if (isRoot) {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500);
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }
      const body = patchHtml(data);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(body);
    });
    return;
  }

  // All other files: stream with range request support (required for video)
  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    const total = stat.size;
    const range = req.headers['range'];

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : total - 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${total}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   mime,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Accept-Ranges':  'bytes',
        'Content-Length': total,
        'Content-Type':   mime,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}).listen(PORT, () => console.log(`[starplayer] listening on http://localhost:${PORT}`));
