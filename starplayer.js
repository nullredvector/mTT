(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE  (server-first with localStorage fallback)
  // ═══════════════════════════════════════════════════════════════════════════

  const STARS_KEY  = 'myfavett_stars_v1';
  const GROUPS_KEY = 'myfavett_groups_v1';
  const LEVELS_KEY = 'myfavett_levels_v1';
  const OLD_KEY    = 'myfavett_favorites_v1';

  let serverAvailable = false;
  let _syncTimer      = null;

  function loadStarsLocal() {
    try {
      const v = localStorage.getItem(STARS_KEY);
      if (v) return JSON.parse(v);
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        const d = JSON.parse(old);
        localStorage.setItem(STARS_KEY, JSON.stringify(d));
        localStorage.removeItem(OLD_KEY);
        return d;
      }
    } catch (_) {}
    return {};
  }

  function loadGroupsLocal()  {
    try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function loadLevelsLocal() {
    try { return JSON.parse(localStorage.getItem(LEVELS_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function saveStarsLocal()  { try { localStorage.setItem(STARS_KEY,  JSON.stringify(stars));  } catch (_) {} }
  function saveGroupsLocal() { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); } catch (_) {} }
  function saveLevelsLocal() { try { localStorage.setItem(LEVELS_KEY, JSON.stringify(levels)); } catch (_) {} }

  function syncToServer() {
    if (!serverAvailable) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
      fetch('/api/stars', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars, groups, levels }),
      }).catch(() => {});
    }, 300);
  }

  function saveStars()  { saveStarsLocal();  syncToServer(); refreshToolButtons(); }
  function saveGroups() { saveGroupsLocal(); syncToServer(); refreshToolButtons(); }
  function saveLevels() { saveLevelsLocal(); syncToServer(); refreshToolButtons(); }

  let stars  = loadStarsLocal();
  let groups = loadGroupsLocal();
  let levels = loadLevelsLocal();

  // Migrate levels that were stored inside star objects (old format)
  Object.entries(stars).forEach(([id, s]) => {
    if (s.level != null && levels[id] == null) { levels[id] = s.level; }
  });
  saveLevelsLocal();

  // Attempt to load from server (async, upgrades data on success)
  (function initServerSync() {
    fetch('/api/stars').then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(data => {
      serverAvailable = true;
      stars  = data.stars  || {};
      groups = data.groups || [];
      levels = data.levels || {};
      Object.entries(stars).forEach(([id, s]) => {
        if (s.level != null && levels[id] == null) { levels[id] = s.level; }
      });
      saveStarsLocal();
      saveGroupsLocal();
      saveLevelsLocal();
      refreshAllButtons();
      updateToggleBtn();
      if (starsTabActive) renderStarsView();
    }).catch(() => { /* no server — localStorage is fine */ });
  })();

  // Listen for changes broadcast from pop-out windows
  (() => {
    try {
      const ch = new BroadcastChannel('myfaveTT_popout');
      ch.onmessage = e => {
        const { s, g, l, openAuthor } = e.data || {};
        if (openAuthor) { openAuthorByName(openAuthor); try { window.focus(); } catch (_) {} }
        if (s) { stars  = s;  saveStarsLocal();  refreshAllButtons(); updateToggleBtn(); }
        if (g) { groups = g;  saveGroupsLocal(); refreshToolButtons(); }
        if (l) { levels = l;  saveLevelsLocal(); }
        if (s || g || l) syncToServer();
        if (starsTabActive) renderStarsView();
      };
    } catch (_) {}
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // Toggle a video in/out of a named group (creates the group if it doesn't exist).
  // Returns true if the video is now IN the group.
  function toggleQuickGroup(videoId, groupName) {
    let g = groups.find(x => x.name === groupName);
    if (!g) { g = { id: uid(), name: groupName, videoIds: [] }; groups.push(g); }
    const idx = g.videoIds.indexOf(videoId);
    if (idx === -1) { g.videoIds.push(videoId); } else { g.videoIds.splice(idx, 1); }
    saveGroups();
    if (starsTabActive) renderStarsView();
    return g.videoIds.includes(videoId);
  }

  function inQuickGroup(videoId, groupName) {
    const g = groups.find(x => x.name === groupName);
    return g ? g.videoIds.includes(videoId) : false;
  }

  // ── "braces" tag: membership in the user's existing group named "braces" ──
  const BRACES_SVG = size =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">` +
    '<rect x="2" y="6" width="20" height="12" rx="5"/><path d="M7 6v12M12 6v12M17 6v12"/><path d="M2 12h20" stroke-width="1.3"/>' +
    '<g fill="currentColor" stroke="none"><rect x="3.4" y="10.9" width="2.2" height="2.2" rx=".5"/><rect x="8.4" y="10.9" width="2.2" height="2.2" rx=".5"/>' +
    '<rect x="13.4" y="10.9" width="2.2" height="2.2" rx=".5"/><rect x="18.4" y="10.9" width="2.2" height="2.2" rx=".5"/></g></svg>';

  function findBracesGroup() {
    return groups.find(g => String(g.name).trim().toLowerCase() === 'braces');
  }

  function inBraces(videoId) {
    const g = findBracesGroup();
    return g ? g.videoIds.includes(videoId) : false;
  }

  // Toggles the video in the braces group (the group is created only if it doesn't exist yet)
  function toggleBraces(videoId) {
    const g = findBracesGroup();
    return toggleQuickGroup(videoId, g ? g.name : 'braces');
  }

  // A braces button. Its video id lives in data-vid so one button can follow a changing video.
  function makeBracesBtn(className, videoId, iconSize) {
    const b = document.createElement('button');
    b.className = className + ' braces-btn';
    b.innerHTML = BRACES_SVG(iconSize);
    if (videoId) b.dataset.vid = videoId;
    b._refresh = () => {
      const on = inBraces(b.dataset.vid);
      b.classList.toggle('braces-on', on);
      b.title = on ? 'Remove from braces' : 'Add to braces';
    };
    b._refresh();
    b.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      if (b.dataset.vid) toggleBraces(b.dataset.vid);
    });
    return b;
  }

  function refreshToolButtons() {
    document.querySelectorAll('.braces-btn, .thumb-tool').forEach(b => b._refresh && b._refresh());
  }

  // Right-center tool stack on a thumbnail (username page + stars grid): star, braces, group picker, level
  function buildThumbTools(videoId, coverSrc, authorName, desc) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-tools';
    const mk = cls => {
      const b = document.createElement('button');
      b.className = 'thumb-tool ' + cls;
      return b;
    };

    const star = mk('thumb-star');
    star._refresh = () => {
      const on = Boolean(stars[videoId]);
      star.textContent = on ? '★' : '☆';
      star.title = on ? 'Remove from Stars' : 'Add to Stars';
      star.classList.toggle('on', on);
    };
    star._refresh();
    star.addEventListener('click', e => {
      e.stopPropagation();
      toggleStar(videoId, coverSrc, authorName, desc);
      star._refresh();
    });

    const braces = makeBracesBtn('thumb-tool', videoId, 16);

    const grp = mk('thumb-grp');
    grp.textContent = '⊕';
    grp.title = 'Add to group';
    grp.addEventListener('click', e => { e.stopPropagation(); showGroupPicker(grp, videoId); });

    const lvl = mk('thumb-lvl');
    lvl._refresh = () => {
      const n = levels[videoId];
      lvl.textContent = n != null ? String(n) : 'lvl';
      lvl.title = n != null ? 'Level ' + n : 'Set level';
      lvl.classList.toggle('on', n != null);
    };
    lvl._refresh();
    lvl.addEventListener('click', e => {
      e.stopPropagation();
      showLevelPicker(lvl, videoId, () => {
        lvl._refresh();
        if (starsTabActive) renderStarsView();
      });
    });

    wrap.append(star, braces, grp, lvl);
    return wrap;
  }

  function getVideoIdFromSrc(src) {
    const m = src && src.match(/covers\/(\d+)\.jpg/);
    return m ? m[1] : null;
  }

  function getVideoPath(coverSrc) {
    return coverSrc.replace('/covers/', '/videos/').replace(/\.jpg$/, '.mp4');
  }

  // Cache of the archive data object found in React state
  let _archiveData = null;

  // Walk the React fiber tree to find the component state that holds
  // { videoDescriptions, videos, authors } — app.js deletes window.db/dbvd
  // after consuming them, so the fiber is the only reliable source.
  function findArchiveData() {
    if (_archiveData && _archiveData.videoDescriptions) return _archiveData;

    const candidates = [
      document.getElementById('archive'),
      document.querySelector('main'),
      document.body,
    ].filter(Boolean);

    let rootFiber = null;
    for (const el of candidates) {
      const k = Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (k) { rootFiber = el[k]; break; }
    }
    if (!rootFiber) return null;

    function isArchiveObj(v) {
      return v && typeof v === 'object' && v.videoDescriptions && v.videos;
    }

    // Walk a function-component hook linked list
    function searchHooks(hook) {
      let h = hook;
      while (h) {
        const v = h.memoizedState;
        if (isArchiveObj(v)) return v;
        // Context value lives one level deeper for some hook shapes
        if (v && typeof v === 'object' && isArchiveObj(v.value)) return v.value;
        h = h.next;
      }
      return null;
    }

    const stack = [rootFiber];
    let walked = 0;
    while (stack.length && walked < 200000) {
      const fiber = stack.pop();
      if (!fiber) continue;
      walked++;

      // Class component state
      if (fiber.memoizedState && !fiber.memoizedState.next) {
        if (isArchiveObj(fiber.memoizedState)) {
          _archiveData = fiber.memoizedState; return _archiveData;
        }
      }
      // Function component hooks (linked list — has .next)
      if (fiber.memoizedState && fiber.memoizedState.next !== undefined) {
        const found = searchHooks(fiber.memoizedState);
        if (found) { _archiveData = found; return _archiveData; }
      }
      // Context.Provider value prop
      const p = fiber.memoizedProps;
      if (p) {
        if (isArchiveObj(p.value)) { _archiveData = p.value; return _archiveData; }
        if (isArchiveObj(p))       { _archiveData = p;       return _archiveData; }
      }

      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child)   stack.push(fiber.child);
    }
    return null;
  }

  // app.js keeps its data in a module-level variable, so the fiber walk can come
  // up empty. Load the db files directly as a fallback.
  let _dbCache = null, _dbLoading = false, _dbFailed = false, _fiberFailAt = 0;

  async function loadArchiveDb() {
    // required: needed for names/descriptions; optional: only used to locate an author's files
    const files = [
      ['videos', 'db_videos.js', true], ['authors', 'db_authors.js', true],
      ['videoDescriptions', 'db_texts.js', true],
      ['likes', 'db_likes.js', false], ['bookmarked', 'db_bookmarked.js', false],
      ['following', 'db_following.js', false],
    ];
    const out = {};
    for (const [key, file, required] of files) {
      try {
        out[key] = await readDbFile(file);
      } catch (e) {
        if (required) throw e;
        console.warn('[starplayer] optional db file unavailable:', file, e);
      }
    }
    if (out.likes && out.likes.likes) out.likes = out.likes.likes;
    return out;
  }

  async function readDbFile(file) {
    const text = await (await fetch('data/.appdata/' + file)).text();
    const b64 = text.match(/_base64\s*=\s*"([^"]+)"/);
    let json;
    if (b64) {
      const bin = Uint8Array.from(atob(b64[1]), c => c.charCodeAt(0));
      const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
      json = await new Response(stream).text();
    } else {
      const raw = text.match(/String\.raw`([\s\S]*)`/);
      if (!raw) throw new Error('unrecognised format: ' + file);
      json = raw[1].replace(/背𓄹剃/g, '`').replace(/⑀⦃/g, '${');
    }
    return JSON.parse(json);
  }

  let _dbPromise = null;
  function archiveDbPromise() {
    if (!_dbPromise) {
      _dbLoading = true;
      _dbPromise = loadArchiveDb()
        .then(d => {
          _dbCache = d;
          if (starsTabActive) renderStarsView();
          if (autotagTabActive) renderAutotagView();
          if (panelOpen) renderPanel();
          return d;
        })
        .catch(e => { _dbFailed = true; console.warn('[starplayer] archive db load failed', e); throw e; })
        .finally(() => { _dbLoading = false; });
    }
    return _dbPromise;
  }

  function ensureArchiveDb() {
    if (_dbCache || _dbLoading || _dbFailed) return;
    archiveDbPromise().catch(() => {});
  }

  function getVideoInfo(videoId) {
    const id = String(videoId);
    let data = _dbCache;
    if (!data && Date.now() - _fiberFailAt > 5000) {
      data = findArchiveData();
      if (!data) _fiberFailAt = Date.now();
    }
    if (!data) { ensureArchiveDb(); return { desc: '', authorName: '' }; }

    const desc = (data.videoDescriptions[id] || data.videoDescriptions[videoId]) || '';
    const v    = data.videos[id] || data.videos[videoId];
    const a    = v && data.authors && data.authors[v.authorId];
    const authorName = (a && a.uniqueIds && a.uniqueIds[0]) || '';
    return { desc, authorName };
  }

  // Resolve a username to its author id (authors can have several past usernames)
  function authorIdForName(name) {
    const d = _dbCache;
    if (!d || !name) return null;
    const n = String(name).toLowerCase();
    for (const [id, a] of Object.entries(d.authors)) {
      if ((a.uniqueIds || []).some(u => String(u).toLowerCase() === n)) return id;
    }
    return null;
  }

  // Which folder holds a video's files: Likes, Favorites or Following/<author>? Falls back to Likes.
  let _dirIndex = null;
  function videoDirFor(id) {
    const d = _dbCache;
    if (!d) return 'Likes';
    if (!_dirIndex || _dirIndex.src !== d) {
      const idx = {
        src: d,
        likes: new Set((d.likes && d.likes.downloaded) || []),
        marks: new Set((d.bookmarked && d.bookmarked.downloaded) || []),
        following: new Map(),
      };
      Object.entries((d.following && d.following.authorItems) || {}).forEach(([aid, it]) => {
        [...(it.inFolder || []), ...(it.disappeared || [])].forEach(v => idx.following.set(v, aid));
      });
      _dirIndex = idx;
    }
    if (_dirIndex.likes.has(id)) return 'Likes';
    if (_dirIndex.marks.has(id)) return 'Favorites';
    if (_dirIndex.following.has(id)) return 'Following/' + _dirIndex.following.get(id);
    return 'Likes';
  }

  function coverSrcFor(id) { return `data/${videoDirFor(id)}/covers/${id}.jpg`; }

  // Videos that are in the archive but gone from the official lists, newest download first.
  // Same rule as the archive viewer: downloaded but not in the official list.
  let _disappearedCache = null;
  function disappearedIds() {
    const d = _dbCache;
    if (!d) return [];
    if (_disappearedCache && _disappearedCache.src === d) return _disappearedCache.ids;
    const known = id => { const v = d.videos[id]; return Boolean(v && d.authors[v.authorId]); };
    const out = [];
    const seen = new Set();
    const add = id => { if (!seen.has(id) && known(id)) { seen.add(id); out.push(id); } };
    // Without an official list every download would look "disappeared", so skip a missing or empty one
    const gone = src => {
      const official = src && src.officialList;
      if (!Array.isArray(official) || !official.length) return [];
      const set = new Set(official);
      return [...(src.downloaded || [])].filter(id => !set.has(id)).reverse();
    };
    gone(d.likes).forEach(add);
    gone(d.bookmarked).forEach(add);
    Object.values((d.following && d.following.authorItems) || {}).forEach(it => (it.disappeared || []).forEach(add));
    _disappearedCache = { src: d, ids: out };
    return out;
  }

  // Every downloaded video by this author, newest first, with the folder it lives in
  function authorVideos(authorId) {
    const d = _dbCache;
    if (!d) return [];
    const likes = new Set((d.likes && d.likes.downloaded) || []);
    const marks = new Set((d.bookmarked && d.bookmarked.downloaded) || []);
    const fi    = d.following && d.following.authorItems && d.following.authorItems[authorId];
    const fol   = new Set([...((fi && fi.inFolder) || []), ...((fi && fi.disappeared) || [])]);
    const a     = d.authors[authorId];
    const name  = (a && a.uniqueIds && a.uniqueIds[0]) || '';
    const out = [];
    for (const [id, v] of Object.entries(d.videos)) {
      if (v.authorId !== authorId) continue;
      const dir = likes.has(id) ? 'Likes' : marks.has(id) ? 'Favorites' : fol.has(id) ? `Following/${authorId}` : null;
      if (!dir) continue;
      out.push({
        id, authorName: name, desc: d.videoDescriptions[id] || '', createTime: v.createTime || 0,
        coverSrc: `data/${dir}/covers/${id}.jpg`, videoPath: `data/${dir}/videos/${id}.mp4`,
      });
    }
    return out.sort((x, y) => y.createTime - x.createTime);
  }

  function tabForCover(coverSrc) {
    if (coverSrc.includes('data/Likes/'))     return 'likes';
    if (coverSrc.includes('data/Favorites/')) return 'bookmarked';
    if (coverSrc.includes('data/Following/')) return 'following';
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOGGLE STAR
  // ═══════════════════════════════════════════════════════════════════════════

  function toggleStar(videoId, coverSrc, authorName, desc) {
    if (stars[videoId]) {
      delete stars[videoId];
    } else {
      if (!authorName || !desc) {
        const info = getVideoInfo(videoId);
        authorName = authorName || info.authorName;
        desc       = desc       || info.desc;
      }
      stars[videoId] = { id: videoId, coverSrc, authorName: authorName || '', desc: desc || '' };
    }
    saveStars();
    refreshAllButtons();
    updateToggleBtn();
    if (panelOpen)      renderPanel();
    if (starsTabActive) renderStarsView();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STAR BUTTONS ON MAIN-LIST CARDS
  // ═══════════════════════════════════════════════════════════════════════════

  function injectOrUpdateButton(coverDiv) {
    const img = coverDiv.querySelector('img.thumbnail');
    const src = img && img.getAttribute('src');
    const videoId = getVideoIdFromSrc(src);
    if (!videoId) return;

    let btn = coverDiv.querySelector('.star-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'star-btn';
      btn.textContent = '★';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        const s = coverDiv.querySelector('img.thumbnail')?.getAttribute('src');
        const id = getVideoIdFromSrc(s || '');
        if (id) toggleStar(id, s);
      });
      coverDiv.appendChild(btn);
    }

    // Rows are recycled by the virtual list, so keep the braces button on the current video
    let bb = coverDiv.querySelector('.braces-list-btn');
    if (!bb) {
      bb = makeBracesBtn('braces-list-btn', videoId, 15);
      coverDiv.appendChild(bb);
    }
    bb.dataset.vid = videoId;
    bb._refresh();

    const on = Boolean(stars[videoId]);
    btn.classList.toggle('star-active', on);
    btn.title = on ? 'Remove from Stars' : 'Add to Stars';
  }

  function refreshAllButtons() {
    document.querySelectorAll('div.cover').forEach(coverDiv => {
      const btn = coverDiv.querySelector('.star-btn');
      if (!btn) return;
      const src = coverDiv.querySelector('img.thumbnail')?.getAttribute('src') || '';
      const id  = getVideoIdFromSrc(src);
      if (!id) return;
      const on = Boolean(stars[id]);
      btn.classList.toggle('star-active', on);
      btn.title = on ? 'Remove from Stars' : 'Add to Stars';
    });
  }

  function scanCards() {
    document.querySelectorAll('div.cover').forEach(injectOrUpdateButton);
    document.querySelectorAll('div.cover').forEach(interceptCoverClick);
    applyMobileCards();
    stampLastRun();
  }

  // The viewer's "Last run: today." only gives a relative day. Put the real time after it.
  // Done with a data attribute + CSS ::after so the viewer's own (React-managed) DOM isn't touched.
  function stampLastRun() {
    const root = document.getElementById('archive');
    if (!root) return;
    const para = [...root.querySelectorAll('p')].find(el => /^\s*Last run:/.test(el.textContent));
    if (!para) return;

    let data = _dbCache;
    if (!data && Date.now() - _fiberFailAt > 5000) {
      data = findArchiveData();
      if (!data) _fiberFailAt = Date.now();
    }
    if (!data) { ensureArchiveDb(); return; }

    // Which list is on screen? The covers' folder tells us.
    const img = root.querySelector('img[src*="data/Likes/"], img[src*="data/Favorites/"]');
    const kind = img && tabForCover(img.getAttribute('src'));
    const list = kind === 'bookmarked' ? data.bookmarked : kind === 'likes' ? data.likes : null;
    const run = list && list.lastRun;
    const ms = run && Math.max(Number(run.start) || 0, Number(run.finish) || 0);
    if (!ms) return;

    const when = new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    if (para.getAttribute('data-sp-lastrun') !== when) para.setAttribute('data-sp-lastrun', when);
  }

  // Intercept thumbnail clicks to open our overlay instead of React's player.
  // We attach on BOTH the cover div AND the thumbnail img in the capture phase
  // with stopImmediatePropagation to ensure React's handlers never fire.
  function interceptCoverClick(coverDiv) {
    if (coverDiv._overlayBound) return;
    coverDiv._overlayBound = true;

    function handleClick(e) {
      // Don't intercept star button or other control clicks
      if (e.target.closest('.star-btn') || e.target.closest('.braces-btn') || e.target.closest('.overlay-ctrl-btn')) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const img = coverDiv.querySelector('img.thumbnail');
      const src = img && img.getAttribute('src');
      const videoId = getVideoIdFromSrc(src);
      if (!videoId || !src) return;

      // Debug: log the row DOM so we can see what's available
      const row = coverDiv.parentElement;
      console.log('[starplayer click] coverDiv.parentElement HTML:', row?.innerHTML?.slice(0, 800));
      const meta = scrapeRowMeta(coverDiv);
      console.log('[starplayer click] scraped meta:', JSON.stringify(meta));

      // Build context list from currently visible thumbnails
      const contextList = buildContextFromDOM();
      const idx = contextList.findIndex(v => v.id === videoId);
      openVideoOverlay(idx >= 0 ? idx : 0, contextList);
    }

    coverDiv.addEventListener('click', handleClick, true);
    // Also intercept on the thumbnail image itself
    const img = coverDiv.querySelector('img.thumbnail');
    if (img) {
      img.addEventListener('click', handleClick, true);
    }
  }

  // Scrape author name and caption from row DOM siblings of a cover div.
  // Works even when window.E / window._mftt are not available.
  function scrapeRowMeta(coverDiv) {
    const row = coverDiv.parentElement;
    if (!row) return { authorName: '', desc: '' };
    const scope = row.querySelector('.column-titles') || row;

    let authorName = '';
    let desc = '';

    // Author: first short text (2–40 chars, no newlines)
    const authorSelectors = ['a', '.link', '[class*="author"]', '[class*="Author"]',
      '[class*="nick"]', '[class*="Nick"]', '[class*="user"]', '[class*="User"]',
      '.searchable', '.underline'];
    for (const sel of authorSelectors) {
      const el = scope.querySelector(sel);
      const t = el?.textContent?.trim();
      if (t && t.length >= 2 && t.length <= 40 && !t.includes('\n')) {
        authorName = t.replace(/^@/, '');
        break;
      }
    }

    // Caption: try class-based selectors first, then fall back to all leaf text nodes
    const descSelectors = ['[class*="desc"]', '[class*="caption"]', '[class*="content"]',
      '[class*="title"]', '.searchable', '.underline'];
    for (const sel of descSelectors) {
      const el = scope.querySelector(sel);
      const t = el?.textContent?.trim();
      if (t && t !== authorName && t !== '@' + authorName && t.length > 2) {
        desc = t;
        break;
      }
    }

    // Fallback: walk every leaf element in the full row, prefer texts that look like captions
    if (!desc) {
      // Patterns to reject: pure counts (1.2K), durations (0:45), short dates (Jan 5), pure numbers
      const junkRe = /^[\d.,]+[KMBkm%]?$|^\d+:\d+$|^[A-Z][a-z]{2}\s+\d+$|^\d+$/;
      const candidates = [];
      row.querySelectorAll('*').forEach(el => {
        if (el.children.length > 0) return;
        const t = el.textContent?.trim();
        if (!t || t.length < 3) return;
        if (t === authorName || t === '@' + authorName) return;
        if (junkRe.test(t)) return;
        candidates.push(t);
      });
      // Prefer entries that contain spaces (likely real captions vs single-word ui labels)
      desc = candidates.find(t => t.includes(' ')) || candidates[0] || '';
    }

    return { authorName, desc };
  }

  function buildContextFromDOM() {
    const list = [];
    const seen = new Set();
    document.querySelectorAll('div.cover img.thumbnail').forEach(img => {
      const src = img.getAttribute('src');
      const id  = getVideoIdFromSrc(src);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const coverDiv = img.closest('div.cover');
      const { authorName, desc } = scrapeRowMeta(coverDiv);
      list.push({ id, coverSrc: src, videoPath: getVideoPath(src), authorName, desc });
    });
    return list;
  }

  function applyMobileCards() {
    if (window.innerWidth >= 768) return;

    // Inject caption overlays into each cover thumbnail
    document.querySelectorAll('div.cover').forEach(coverDiv => {
      // Re-render caption if the src changed (virtualized list recycles rows)
      const img = coverDiv.querySelector('img.thumbnail');
      const src = img ? (img.getAttribute('src') || '') : '';
      if (coverDiv.dataset.spCapSrc === src) return; // already up-to-date
      coverDiv.dataset.spCapSrc = src;

      coverDiv.querySelector('.sp-cap')?.remove();

      const videoId = getVideoIdFromSrc(src);
      if (!videoId) return;

      const { desc, authorName } = getVideoInfo(videoId);
      let txt = '';
      if (authorName) txt = '@' + authorName;
      if (desc) txt += (txt ? '\n' : '') + (desc.length > 100 ? desc.slice(0, 100) + '…' : desc);

      // Fallback: scrape text from sibling cells in the row
      if (!txt) {
        const row = coverDiv.parentElement;
        if (row) {
          const scope = row.querySelector('.column-titles') || row;
          const el = scope.querySelector('a, .link, .searchable, .underline');
          if (el) txt = el.textContent.trim().slice(0, 80);
        }
      }

      if (!txt) return;
      const cap = document.createElement('div');
      cap.className = 'sp-cap';
      cap.textContent = txt;
      coverDiv.appendChild(cap);

      // Add metadata overlay (like count, date) for card view
      if (!coverDiv.querySelector('.sp-meta')) {
        const E = window.E;
        const v = E && E.videos && E.videos[videoId];
        if (v) {
          const meta = document.createElement('div');
          meta.className = 'sp-meta';
          const parts = [];
          if (v.diggCount != null) parts.push('♥ ' + formatCount(v.diggCount));
          if (v.createTime) {
            const d = new Date(v.createTime * 1000);
            parts.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
          }
          meta.textContent = parts.join('  ·  ');
          coverDiv.appendChild(meta);
        }
      }
    });

    // Reposition rows into 2-column grid
    applyMobileGridLayout();

    // Mark and hide "Explain" nav tab on mobile (app.js renders it; useless on mobile)
    document.querySelectorAll('nav > div').forEach(div => {
      if (/explain/i.test(div.textContent.trim())) {
        div.classList.add('explain-tab');
      }
    });
    // Also hide any stray "Explain" buttons
    document.querySelectorAll('button').forEach(btn => {
      if (/^explain$/i.test(btn.textContent.trim())) {
        btn.style.setProperty('display', 'none', 'important');
      }
    });
  }

  function formatCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  // Reposition react-window's absolutely-positioned rows into a 2-column card grid
  function applyMobileGridLayout() {
    if (window.innerWidth >= 768) return;

    // Find the virtualized list container — the element with position:relative
    // that holds absolutely-positioned row children
    const main = document.querySelector('main');
    if (!main) return;

    // The react-window container is deeply nested: main > div > div[style*="position: relative"]
    const container = main.querySelector('[style*="position: relative"]');
    if (!container) return;

    const rows = Array.from(container.children).filter(el => {
      // Only process video rows (skip info banner and header, which are the first 2 items)
      return el.querySelector('div.cover');
    });

    if (rows.length === 0) return;

    const gap = 6;
    const colWidth = 'calc(50% - ' + (gap / 2) + 'px)';
    const cardHeight = Math.round(window.innerWidth / 2 * 16 / 9); // 9:16 aspect ratio per half-width

    rows.forEach((row, i) => {
      const col = i % 2;
      const gridRow = Math.floor(i / 2);

      row.style.setProperty('width', colWidth, 'important');
      row.style.setProperty('left', col === 0 ? '0px' : `calc(50% + ${gap / 2}px)`, 'important');
      row.style.setProperty('top', (gridRow * (cardHeight + gap)) + 'px', 'important');
      row.style.setProperty('height', cardHeight + 'px', 'important');
      row.classList.add('mobile-card-row');
    });

    // Adjust container height to fit grid
    const totalGridRows = Math.ceil(rows.length / 2);
    const totalHeight = totalGridRows * (cardHeight + gap);
    container.style.setProperty('height', totalHeight + 'px', 'important');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OPEN VIDEO (from panel or Stars tab)
  // ═══════════════════════════════════════════════════════════════════════════

  function starItemToCtx(s) {
    const info = getVideoInfo(s.id);
    return {
      id: s.id,
      coverSrc: s.coverSrc,
      videoPath: getVideoPath(s.coverSrc),
      authorName: info.authorName || s.authorName || '',
      desc:       info.desc       || s.desc       || '',
    };
  }

  function openVideo(coverSrc) {
    closePanel();
    const videoId = getVideoIdFromSrc(coverSrc);
    if (!videoId) return;
    // In stars view, use the exact rendered list so order and lvl-only entries match
    if (starsTabActive && starsContextItems.length > 0) {
      const ctx = getStarsContext();
      const idx = ctx.findIndex(v => v.id === videoId);
      openVideoOverlay(idx >= 0 ? idx : 0, ctx);
      return;
    }
    const s0 = stars[videoId];
    const contextList = [starItemToCtx(s0 || { id: videoId, coverSrc })];
    openVideoOverlay(0, contextList);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIDEO OVERLAY PLAYER
  // ═══════════════════════════════════════════════════════════════════════════

  let overlayEl      = null;
  let overlayCtx     = [];    // context list of { id, coverSrc, videoPath }
  let overlayIdx     = 0;
  let overlayVideo   = null;
  let overlayMuted   = true;

  function openVideoOverlay(startIdx, contextList) {
    // On mobile route to the scroll-snap feed instead of the small overlay
    if (isMobilePlayer()) {
      const fromAuthor = authorViewOpen();
      playerReturnTab = fromAuthor ? '__author__'
                     : activeMobileTab === 'stars' ? 'stars'
                     : activeMobileTab === 'recents' ? 'recents'
                     : activeMobileTab === 'review' ? 'review'
                     : null;
      playerOpen = true;
      playerVideoList = contextList;
      playerColumnOffsets = [startIdx];
      document.querySelector('nav .player-tab')?.classList.add('active');
      if (!playerViewEl) {
        playerViewEl = document.createElement('div');
        playerViewEl.id = 'player-view';
        document.body.appendChild(playerViewEl);
      }
      playerViewEl.style.display = 'flex';
      playerViewEl.style.zIndex = fromAuthor ? '3600' : '';
      setPreviewsSuspended(true);
      renderMobilePlayerContent();
      return;
    }

    closeVideoOverlay();
    overlayCtx = contextList;
    overlayIdx = startIdx;
    overlayMuted = true;

    overlayEl = document.createElement('div');
    overlayEl.id = 'video-overlay';
    overlayEl.setAttribute('tabindex', '0');

    // Backdrop click closes
    overlayEl.addEventListener('click', e => {
      if (e.target === overlayEl) closeVideoOverlay();
    });

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'overlay-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeVideoOverlay);
    overlayEl.appendChild(closeBtn);

    // Content container
    const content = document.createElement('div');
    content.id = 'video-overlay-content';
    overlayEl.appendChild(content);

    // Keyboard
    overlayEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeVideoOverlay(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { navigateOverlay(1); return; }
      if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  { navigateOverlay(-1); return; }
    });

    // Swipe / tap (mobile)
    let _sy = 0;
    overlayEl.addEventListener('touchstart', e => { _sy = e.touches[0].clientY; }, { passive: true });
    overlayEl.addEventListener('touchend', e => {
      const dy = _sy - e.changedTouches[0].clientY;
      if (Math.abs(dy) < 50) {
        // tap — toggle play/pause
        if (overlayVideo) overlayVideo.paused ? overlayVideo.play().catch(() => {}) : overlayVideo.pause();
        return;
      }
      navigateOverlay(dy > 0 ? 1 : -1);
    }, { passive: true });

    document.body.appendChild(overlayEl);
    setPreviewsSuspended(true);
    renderOverlayContent();
    overlayEl.focus();
  }

  function closeVideoOverlay() {
    if (!overlayEl) return;
    if (overlayVideo) { overlayVideo.pause(); overlayVideo.src = ''; }
    overlayEl.remove();
    overlayEl = null;
    overlayVideo = null;
    overlayCtx = [];
    setPreviewsSuspended(false);
    // If player tab was active, deactivate it
    if (playerOpen) {
      playerOpen = false;
      document.querySelector('nav .player-tab')?.classList.remove('active');
    }
  }

  function navigateOverlay(dir) {
    const next = overlayIdx + dir;
    if (next < 0 || next >= overlayCtx.length) return;
    overlayIdx = next;
    renderOverlayContent();
  }

  function renderOverlayContent() {
    if (!overlayEl) return;
    const content = overlayEl.querySelector('#video-overlay-content');
    if (!content) return;

    // Pause old video
    if (overlayVideo) { overlayVideo.pause(); overlayVideo.src = ''; }
    content.innerHTML = '';

    const item = overlayCtx[overlayIdx];
    if (!item) return;

    const info = getVideoInfo(item.id);
    const authorName = info.authorName || item.authorName || '';
    const desc = info.desc || item.desc || '';

    // Video
    const video = document.createElement('video');
    video.src = item.videoPath;
    video.muted = overlayMuted;
    video.autoplay = true;
    video.playsInline = true;
    video.poster = item.coverSrc;
    video.className = 'overlay-video';
    video.addEventListener('playing', () => { video.poster = ''; }, { once: true });
    video.addEventListener('ended', () => { video.currentTime = 0; video.play().catch(() => {}); });
    video.addEventListener('contextmenu', e => { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); });
    content.appendChild(video);
    overlayVideo = video;

    // Controls layer
    const controls = document.createElement('div');
    controls.className = 'overlay-controls-layer';

    // Right center: star + group
    const rightCenter = document.createElement('div');
    rightCenter.className = 'overlay-right-center';

    const starBtn = document.createElement('button');
    starBtn.className = 'overlay-ctrl-btn overlay-star-btn' + (stars[item.id] ? ' active' : '');
    starBtn.innerHTML = '★';
    starBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleStar(item.id, item.coverSrc, authorName, desc);
      starBtn.classList.toggle('active', Boolean(stars[item.id]));
    });
    rightCenter.appendChild(starBtn);
    rightCenter.appendChild(makeBracesBtn('overlay-ctrl-btn overlay-braces-btn', item.id, 24));

    const lvlBtn = document.createElement('button');
    lvlBtn.className = 'overlay-ctrl-btn overlay-lvl-btn';
    lvlBtn.textContent = levels[item.id] != null ? String(levels[item.id]) : 'lvl';
    lvlBtn.addEventListener('click', e => {
      e.stopPropagation();
      showLevelPicker(lvlBtn, item.id, newLvl => {
        lvlBtn.textContent = newLvl != null ? String(newLvl) : 'lvl';
        if (starsTabActive) renderStarsView();
      });
    });
    rightCenter.appendChild(lvlBtn);

    const groupBtn = document.createElement('button');
    groupBtn.className = 'overlay-ctrl-btn overlay-group-btn';
    groupBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
    groupBtn.addEventListener('click', e => { e.stopPropagation(); showGroupPicker(groupBtn, item.id); });
    rightCenter.appendChild(groupBtn);
    controls.appendChild(rightCenter);

    // Bottom-left: author + caption
    const meta = document.createElement('div');
    meta.className = 'overlay-meta';
    if (authorName) {
      const authEl = document.createElement('div');
      authEl.className = 'overlay-author';
      setAuthorLink(authEl, authorName);
      meta.appendChild(authEl);
    }
    if (desc) {
      const capEl = document.createElement('div');
      capEl.className = 'overlay-caption';
      capEl.textContent = desc.length > 150 ? desc.slice(0, 150) + '…' : desc;
      meta.appendChild(capEl);
    }
    controls.appendChild(meta);

    // Bottom-right: mute
    const muteBtn = document.createElement('button');
    muteBtn.className = 'overlay-ctrl-btn overlay-mute-btn';
    muteBtn.innerHTML = muteIcon(overlayMuted);
    muteBtn.addEventListener('click', e => {
      e.stopPropagation();
      overlayMuted = !overlayMuted;
      video.muted = overlayMuted;
      muteBtn.innerHTML = muteIcon(overlayMuted);
    });
    controls.appendChild(muteBtn);

    // Counter (subtle)
    if (overlayCtx.length > 1) {
      const counter = document.createElement('div');
      counter.className = 'overlay-counter';
      counter.textContent = `${overlayIdx + 1} / ${overlayCtx.length}`;
      controls.appendChild(counter);
    }

    // Bottom-center: prev / next nav buttons
    if (overlayCtx.length > 1) {
      const navDiv = document.createElement('div');
      navDiv.className = 'overlay-nav-btns';
      const prevNavBtn = document.createElement('button');
      prevNavBtn.className = 'overlay-ctrl-btn overlay-nav-btn';
      prevNavBtn.innerHTML = '&#8679;';
      prevNavBtn.title = 'Previous';
      prevNavBtn.disabled = overlayIdx <= 0;
      prevNavBtn.addEventListener('click', e => { e.stopPropagation(); navigateOverlay(-1); });
      const nextNavBtn = document.createElement('button');
      nextNavBtn.className = 'overlay-ctrl-btn overlay-nav-btn';
      nextNavBtn.innerHTML = '&#8681;';
      nextNavBtn.title = 'Next';
      nextNavBtn.disabled = overlayIdx >= overlayCtx.length - 1;
      nextNavBtn.addEventListener('click', e => { e.stopPropagation(); navigateOverlay(1); });
      navDiv.appendChild(prevNavBtn);
      navDiv.appendChild(nextNavBtn);
      controls.appendChild(navDiv);
    }

    content.appendChild(controls);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOTTOM-RIGHT QUICK-ACCESS PANEL
  // ═══════════════════════════════════════════════════════════════════════════

  let panelEl   = null;
  let panelOpen = false;

  function renderPanel() {
    document.getElementById('star-panel')?.remove();
    const starList = Object.values(stars);

    panelEl = document.createElement('div');
    panelEl.id = 'star-panel';

    const hdr = document.createElement('div');
    hdr.id = 'star-panel-header';
    hdr.innerHTML = `<span>★ Stars (${starList.length})</span>`;
    const x = document.createElement('button');
    x.id = 'star-panel-close';
    x.textContent = '✕';
    x.addEventListener('click', closePanel);
    hdr.appendChild(x);
    panelEl.appendChild(hdr);

    const grid = document.createElement('div');
    grid.id = 'star-panel-grid';

    if (!starList.length) {
      const e = document.createElement('p');
      e.id = 'star-panel-empty';
      e.innerHTML = 'No stars yet.<br>Click ★ on any video to add it.';
      grid.appendChild(e);
    } else {
      starList.forEach(star => {
        const info = getVideoInfo(star.id);
        const authorName = info.authorName || star.authorName || '';
        const desc       = info.desc       || star.desc       || '';
        const item = document.createElement('div');
        item.className = 'star-panel-item';

        const cw = document.createElement('div');
        cw.className = 'star-panel-cover';
        cw.title = 'Open video';
        cw.addEventListener('click', () => openVideo(star.coverSrc));

        const img = document.createElement('img');
        img.src = star.coverSrc;
        img.loading = 'lazy';
        cw.appendChild(img);

        const rm = document.createElement('button');
        rm.className = 'star-panel-remove';
        rm.title = 'Remove from Stars';
        rm.textContent = '✕';
        rm.addEventListener('click', e => {
          e.stopPropagation();
          delete stars[star.id];
          saveStars();
          refreshAllButtons(); updateToggleBtn(); renderPanel();
        });
        cw.appendChild(rm);
        item.appendChild(cw);

        if (authorName) {
          const a = document.createElement('div');
          a.className = 'star-panel-author';
          setAuthorLink(a, authorName);
          item.appendChild(a);
        }
        if (desc) {
          const d = document.createElement('div');
          d.className = 'star-panel-desc';
          d.textContent = desc.length > 60 ? desc.slice(0, 60) + '…' : desc;
          item.appendChild(d);
        }

        grid.appendChild(item);
      });
    }

    panelEl.appendChild(grid);
    document.body.appendChild(panelEl);
  }

  function openPanel()  { panelOpen = true;  renderPanel(); toggleBtn.classList.add('star-toggle-active'); }
  function closePanel() {
    panelOpen = false;
    document.getElementById('star-panel')?.remove();
    panelEl = null;
    toggleBtn?.classList.remove('star-toggle-active');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOTTOM-RIGHT TOGGLE BUTTON
  // ═══════════════════════════════════════════════════════════════════════════

  let toggleBtn;

  function createToggleBtn() {
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'star-toggle';
    toggleBtn.addEventListener('click', () => { if (panelOpen) closePanel(); else openPanel(); });
    updateToggleBtn();
    document.body.appendChild(toggleBtn);
  }

  function updateToggleBtn() {
    const n = Object.keys(stars).length;
    toggleBtn.textContent = '★ ' + n;
    toggleBtn.title = n + ' star' + (n !== 1 ? 's' : '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRID PREVIEWS — hover/play-all thumbnails and a size slider (stars + author pages)
  // ═══════════════════════════════════════════════════════════════════════════

  let gridPlayAll = false;        // play every thumbnail near the viewport
  let previewsSuspended = false;  // paused while a full-screen player is open
  const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
  const THUMB_DEFAULTS = { stars: 110, 'stars-m': 85, author: 220, 'author-m': 160, autotag: 150, 'autotag-m': 150 };

  function thumbKey(page) { return isMobilePlayer() ? page + '-m' : page; }

  function loadThumbSize(key) {
    try {
      const v = parseInt(localStorage.getItem('sp_thumb_' + key), 10);
      if (v >= 60 && v <= 420) return v;
    } catch (_) {}
    return THUMB_DEFAULTS[key];
  }

  function saveThumbSize(key, px) {
    try { localStorage.setItem('sp_thumb_' + key, String(px)); } catch (_) {}
  }

  function applyThumbSize(grid, px) {
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${px}px, 1fr))`;
    grid.style.setProperty('--tool', Math.max(20, Math.min(32, Math.round(px * 0.15))) + 'px');
    // How many label bubbles fit under a thumbnail of this width
    grid.dataset.cap = String(px < 80 ? 1 : px < 120 ? 2 : px < 170 ? 3 : px < 230 ? 4 : 5);
  }

  // ── Sort order for the stars, username and review grids ──────────────────
  // Latest/Oldest use the video's post date, Popular its like count. The review page also offers
  // "Best match", which keeps the order the model ranked its suggestions in.
  function sortOptions(page) {
    const opts = [['latest', 'Latest'], ['popular', 'Popular'], ['oldest', 'Oldest']];
    return page === 'autotag' ? [['score', 'Best match'], ...opts] : opts;
  }

  function getSort(page) {
    const fallback = page === 'autotag' ? 'score' : 'latest';
    try {
      const v = localStorage.getItem('sp_sort_' + page);
      if (sortOptions(page).some(([k]) => k === v)) return v;
    } catch (_) {}
    return fallback;
  }

  function saveSort(page, mode) {
    try { localStorage.setItem('sp_sort_' + page, mode); } catch (_) {}
  }

  // Returns a sorted copy of items ({ id, ... }). Videos with no data in the archive database go last.
  function sortVideos(items, page) {
    const mode = getSort(page);
    const d = _dbCache;
    if (mode === 'score' || !d) return items;
    const keyed = items.map((item, i) => {
      const v = d.videos[item.id];
      return { item, i, known: Boolean(v), t: v ? (v.createTime || 0) : 0, likes: v ? (v.diggCount || 0) : 0, plays: v ? (v.playCount || 0) : 0 };
    });
    keyed.sort((a, b) => {
      if (a.known !== b.known) return a.known ? -1 : 1;
      let r;
      if (mode === 'oldest') r = a.t - b.t;
      else if (mode === 'popular') r = (b.likes - a.likes) || (b.plays - a.plays) || (b.t - a.t);
      else r = b.t - a.t;
      return r || a.i - b.i;
    });
    return keyed.map(k => k.item);
  }

  // Mark a thumbnail as previewable and add mouse-over playback
  function attachPreview(cover, videoPath) {
    if (!videoPath || !/\/videos\/.+\.mp4$/.test(videoPath)) return;
    cover.classList.add('preview-cover');
    cover.dataset.video = videoPath;
    if (!canHover) return;
    cover.addEventListener('mouseenter', () => { cover._spHover = true;  syncCoverPlayback(cover); });
    cover.addEventListener('mouseleave', () => { cover._spHover = false; syncCoverPlayback(cover); });
  }

  // Attach or release the preview <video> of one thumbnail
  function syncCoverPlayback(cover) {
    let vid = cover.querySelector('video.preview-video');
    const want = !previewsSuspended && (cover._spHover || (gridPlayAll && cover._spVisible));
    if (want) {
      if (vid) { vid.play().catch(() => {}); return; }
      const img = cover.querySelector('img');
      vid = document.createElement('video');
      vid.className = 'preview-video';
      vid.src = cover.dataset.video;
      vid.muted = true; vid.loop = true; vid.playsInline = true; vid.preload = 'auto';
      cover.insertBefore(vid, img ? img.nextSibling : cover.firstChild);
      cover.classList.add('is-playing');
      vid.play().catch(() => {});
    } else if (vid) {
      vid.pause(); vid.removeAttribute('src'); vid.load(); vid.remove();
      cover.classList.remove('is-playing');
    }
  }

  // Only thumbnails near the grid's viewport may hold a <video>, so a long list can't exhaust memory
  function observeGridPreviews(grid) {
    if (grid._spIO) grid._spIO.disconnect();
    grid._spIO = new IntersectionObserver(entries => {
      entries.forEach(e => { e.target._spVisible = e.isIntersecting; syncCoverPlayback(e.target); });
    }, { root: grid, rootMargin: '200px' });
    grid.querySelectorAll('.preview-cover').forEach(c => grid._spIO.observe(c));
  }

  function refreshPreviews(container) {
    if (container) container.querySelectorAll('.preview-cover').forEach(c => syncCoverPlayback(c));
  }

  // Drop every preview <video> under a container (before it is hidden or re-rendered)
  function releaseGridPreviews(container) {
    if (!container) return;
    container.querySelectorAll('.preview-grid').forEach(g => {
      if (g._spIO) { g._spIO.disconnect(); g._spIO = null; }
      if (g._fillIO) { g._fillIO.disconnect(); g._fillIO = null; }
    });
    container.querySelectorAll('.preview-cover').forEach(c => {
      c._spVisible = false; c._spHover = false; syncCoverPlayback(c);
    });
  }

  // Fill a grid in chunks as the user scrolls instead of building every card at once.
  // A category can hold tens of thousands of videos; makeCard(item, index) is only called for
  // the ones that get near the viewport.
  const GRID_CHUNK = 60;
  function fillGrid(grid, items, makeCard) {
    let next = 0;
    const sentinel = document.createElement('div');
    sentinel.className = 'grid-sentinel';

    function addChunk() {
      const end = Math.min(next + GRID_CHUNK, items.length);
      const frag = document.createDocumentFragment();
      const cards = [];
      for (; next < end; next++) {
        const card = makeCard(items[next], next);
        cards.push(card);
        frag.appendChild(card);
      }
      grid.insertBefore(frag, sentinel.parentNode === grid ? sentinel : null);
      if (grid._spIO) cards.forEach(c => c.querySelectorAll('.preview-cover').forEach(cv => grid._spIO.observe(cv)));
      if (next >= items.length) {
        sentinel.remove();
        if (grid._fillIO) { grid._fillIO.disconnect(); grid._fillIO = null; }
      }
    }

    function pump() {
      while (next < items.length) {
        const g = grid.getBoundingClientRect(), s = sentinel.getBoundingClientRect();
        if (s.top > g.bottom + 800) break;
        addChunk();
      }
    }

    if (items.length > GRID_CHUNK) grid.appendChild(sentinel);
    addChunk();
    if (items.length <= GRID_CHUNK) return;
    grid._fillTo = target => { while (next < items.length && next < target) addChunk(); };
    grid._fillIO = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) pump();
    }, { root: grid, rootMargin: '800px' });
    grid._fillIO.observe(sentinel);
  }

  function setPreviewsSuspended(v) {
    if (previewsSuspended === v) return;
    previewsSuspended = v;
    refreshPreviews(starsViewEl);
    refreshPreviews(authorViewEl);
  }

  // Play-all button + thumbnail size slider shown in a page header
  function buildGridControls(page, grid, container) {
    const key = thumbKey(page);
    const wrap = document.createElement('div');
    wrap.className = 'grid-controls';

    const play = document.createElement('button');
    play.className = 'grid-playall';
    const refresh = () => {
      play.textContent = gridPlayAll ? '⏸' : '▶';
      play.title = gridPlayAll ? 'Stop playing thumbnails' : 'Play all thumbnails';
      play.classList.toggle('on', gridPlayAll);
    };
    refresh();
    play.addEventListener('click', e => {
      e.stopPropagation();
      gridPlayAll = !gridPlayAll;
      refresh();
      refreshPreviews(container);
    });

    const size = document.createElement('input');
    size.type = 'range';
    size.className = 'grid-size';
    size.min = '60'; size.max = '420'; size.step = '10';
    size.title = 'Thumbnail size';
    const start = loadThumbSize(key);
    size.value = String(start);
    applyThumbSize(grid, start);
    size.addEventListener('input', () => {
      const px = parseInt(size.value, 10);
      applyThumbSize(grid, px);
      saveThumbSize(key, px);
    });

    // One button per sort order, the selected one highlighted
    const sort = document.createElement('div');
    sort.className = 'grid-sort';
    sort.setAttribute('role', 'group');
    sort.title = 'Sort order';
    const current = getSort(page);
    sortOptions(page).forEach(([value, label]) => {
      const b = document.createElement('button');
      b.className = 'grid-sort-btn' + (value === current ? ' on' : '');
      b.textContent = label;
      b.setAttribute('aria-pressed', value === current ? 'true' : 'false');
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (getSort(page) === value) return;
        saveSort(page, value);
        sort.querySelectorAll('.grid-sort-btn').forEach(x => {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        });
        if (page === 'stars') renderStarsView();
        else if (page === 'author') renderAuthorView();
        else if (page === 'autotag') renderAutotagView();
      });
      sort.appendChild(b);
    });

    wrap.append(play, size, sort);
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STARS TAB — NAV + CONTENT
  // ═══════════════════════════════════════════════════════════════════════════

  let starsTabActive = false;
  let starsViewEl    = null;
  let activeView       = '__tagged__'; // null (All Stars / selected groups) | '__tagged__' | '__lvl_groups__' | '__ungrouped__' (Untagged) | '__disappeared__'
  let activeGroupIds   = new Set();   // empty = all stars; non-empty = union of selected groups
  let activeLvl        = new Set();   // empty = no filter; set of numbers = multi-select
  let lvlSectionOpen   = true;
  let mobileStarsLvlOpen = false;     // mobile: whether inline lvl strip is visible
  let mobileStarsGroupsOpen = false;  // mobile: whether group picker panel is expanded
  let groupSortOrder   = 'alpha';     // 'alpha' | 'count'
  let starsViewKey = '';            // which view/filters the stars grid last showed
  let starsContextItems = [];       // items of the rendered grid, in order
  let starsContextCache = null;     // player contexts built from them when a video is opened (lists can be huge)
  function setStarsContext(items) { starsContextItems = items; starsContextCache = null; }
  function getStarsContext() {
    // Light entries on purpose: the players look up the author and caption themselves, and the
    // list can hold tens of thousands of videos
    if (!starsContextCache) {
      starsContextCache = starsContextItems.map(item => {
        const s = item.lvlOnly ? item : (stars[item.id] || item);
        return { id: s.id, coverSrc: s.coverSrc, videoPath: getVideoPath(s.coverSrc), authorName: s.authorName || '', desc: s.desc || '' };
      });
    }
    return starsContextCache;
  }

  function showStarsTab() {
    if (autotagTabActive) hideAutotagView();
    if (logTabActive) hideLogView();
    if (activeAuthorId) hideAuthorView();
    starsTabActive = true;
    if (!isMobilePlayer()) closePlayer();
    document.querySelector('main')?.style.setProperty('display', 'none');
    toggleBtn.style.display = 'none';
    closePanel();

    if (isMobilePlayer()) { activeMobileTab = 'stars'; updateMobileNavActive(); }
    else {
      document.querySelectorAll('nav .author-tab.active, nav .log-tab.active, nav .autotag-tab.active').forEach(el => el.classList.remove('active'));
      document.querySelector('nav .stars-tab')?.classList.add('active');
    }

    const main = document.querySelector('main');
    if (!starsViewEl) {
      starsViewEl = document.createElement('div');
      starsViewEl.id = 'stars-view';
      main?.parentNode.insertBefore(starsViewEl, main);
    }
    starsViewEl.style.display = 'flex';
    renderStarsView();
  }

  function showMainContent() {
    if (autotagTabActive) hideAutotagView();
    if (logTabActive) hideLogView();
    if (activeAuthorId) hideAuthorView();
    starsTabActive = false;
    document.querySelector('main')?.style.removeProperty('display');
    toggleBtn.style.display = '';
    if (starsViewEl) { releaseGridPreviews(starsViewEl); starsViewEl.style.display = 'none'; }
    if (!isMobilePlayer()) document.querySelector('nav .stars-tab')?.classList.remove('active');
  }

  function renderStarsView() {
    if (!starsViewEl) return;
    // Re-rendering after a tag/star/level change must not throw you back to the top of a long list:
    // remember how far the same view was loaded and scrolled
    const viewKey = [activeView, [...activeGroupIds].sort().join(','), [...activeLvl].sort().join(','), getSort('stars')].join('|');
    const prevGrid = starsViewEl.querySelector('#stars-grid');
    const keep = (prevGrid && starsViewKey === viewKey)
      ? { loaded: prevGrid.querySelectorAll('.stars-grid-card').length, scroll: prevGrid.scrollTop }
      : null;
    starsViewKey = viewKey;
    releaseGridPreviews(starsViewEl);
    starsViewEl.innerHTML = '';

    // ── Sidebar ──────────────────────────────────────────────────────────────
    const sidebar = document.createElement('div');
    sidebar.id = 'stars-sidebar';

    function makeSidebarItem(id, label, count) {
      let isActive;
      if      (id === '__lvl_groups__') isActive = activeView === '__lvl_groups__';
      else if (id === '__ungrouped__')  isActive = activeView === '__ungrouped__';
      else if (id === '__tagged__')     isActive = activeView === '__tagged__';
      else if (id === '__disappeared__') isActive = activeView === '__disappeared__';
      else if (id === 'all')            isActive = activeView === null && activeGroupIds.size === 0;
      else                              isActive = activeGroupIds.has(id);
      const item = document.createElement('div');
      item.className = 'stars-group-item' + (isActive ? ' active' : '');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'stars-group-name';
      nameSpan.textContent = label;
      const countSpan = document.createElement('span');
      countSpan.className = 'stars-group-count';
      countSpan.textContent = count;
      item.appendChild(nameSpan);
      item.appendChild(countSpan);
      return item;
    }

    sidebar.appendChild(buildLabelToggle());

    // ── Lvl nav item + numbered filter buttons ────────────────────────────────
    const lvlNavItem = makeSidebarItem('__lvl_groups__', 'lvl', '');
    lvlNavItem.addEventListener('click', () => { activeView = '__lvl_groups__'; activeGroupIds.clear(); renderStarsView(); });
    sidebar.appendChild(lvlNavItem);

    const lvlGrid = document.createElement('div');
    lvlGrid.id = 'stars-lvl-grid';
    for (let n = 10; n <= 23; n++) {
      const count = Object.keys(levels).filter(id => levels[id] === n).length;
      const btn = document.createElement('button');
      btn.className = 'stars-lvl-btn' + (activeLvl.has(n) ? ' active' : '');
      btn.textContent = n;
      btn.title = count + ' video' + (count !== 1 ? 's' : '');
      btn.addEventListener('click', () => {
        if (activeLvl.has(n)) activeLvl.delete(n); else activeLvl.add(n);
        if (activeView === '__lvl_groups__') { activeView = null; activeGroupIds.clear(); }
        renderStarsView();
      });
      lvlGrid.appendChild(btn);
    }
    sidebar.appendChild(lvlGrid);

    const lvlDivider = document.createElement('hr');
    lvlDivider.className = 'stars-sidebar-divider';
    sidebar.appendChild(lvlDivider);

    // ── All tagged (every video that is in at least one group) ───────────────
    const taggedIds = new Set(groups.flatMap(g => g.videoIds));
    const taggedItem = makeSidebarItem('__tagged__', 'All tagged', taggedIds.size);
    taggedItem.addEventListener('click', () => { activeView = '__tagged__'; activeGroupIds.clear(); renderStarsView(); });
    sidebar.appendChild(taggedItem);

    // ── All Stars ─────────────────────────────────────────────────────────────
    const allItem = makeSidebarItem('all', 'All Stars', Object.keys(stars).length);
    allItem.addEventListener('click', () => { activeView = null; activeGroupIds.clear(); renderStarsView(); });
    sidebar.appendChild(allItem);

    // ── Untagged ──────────────────────────────────────────────────────────────
    const groupedIds = new Set(groups.flatMap(g => g.videoIds));
    const ungroupedStarCount  = Object.keys(stars).filter(id => !groupedIds.has(id)).length;
    const ungroupedLvlCount   = Object.keys(levels).filter(id => !stars[id] && !groupedIds.has(id)).length;
    const ungroupedTotal      = ungroupedStarCount + ungroupedLvlCount;
    const ungroupedItem = makeSidebarItem('__ungrouped__', 'Untagged', ungroupedTotal);
    ungroupedItem.addEventListener('click', () => { activeView = '__ungrouped__'; activeGroupIds.clear(); renderStarsView(); });
    sidebar.appendChild(ungroupedItem);

    // Disappeared: every archived video removed from the official lists, tagged or not
    const disappearedItem = makeSidebarItem('__disappeared__', 'Disappeared', _dbCache ? disappearedIds().length.toLocaleString() : '');
    disappearedItem.title = 'Videos removed from the official lists';
    disappearedItem.addEventListener('click', () => { activeView = '__disappeared__'; activeGroupIds.clear(); renderStarsView(); });
    sidebar.appendChild(disappearedItem);
    if (!_dbCache) ensureArchiveDb();

    const divider = document.createElement('hr');
    divider.className = 'stars-sidebar-divider';
    sidebar.appendChild(divider);

    // sort before rendering
    const sortedGroups = [...groups].sort((a, b) => {
      if (groupSortOrder === 'count') return b.videoIds.length - a.videoIds.length;
      return a.name.localeCompare(b.name);
    });

    sortedGroups.forEach(g => {
      const count = g.videoIds.length;
      const row = document.createElement('div');
      row.className = 'stars-group-row';

      const item = makeSidebarItem(g.id, g.name, count);
      item.addEventListener('click', () => {
        activeView = null;
        if (activeGroupIds.has(g.id)) activeGroupIds.delete(g.id); else activeGroupIds.add(g.id);
        renderStarsView();
      });

      const renameBtn = document.createElement('button');
      renameBtn.className = 'stars-group-action';
      renameBtn.title = 'Rename';
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', e => {
        e.stopPropagation();
        startRenameGroup(g.id, row);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'stars-group-action stars-group-delete';
      delBtn.title = 'Delete group';
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`Delete group "${g.name}"?`)) return;
        groups = groups.filter(x => x.id !== g.id);
        saveGroups();
        activeGroupIds.delete(g.id);
        renderStarsView();
      });

      row.appendChild(item);
      row.appendChild(renameBtn);
      row.appendChild(delBtn);
      sidebar.appendChild(row);
    });

    const newBtn = document.createElement('button');
    newBtn.id = 'stars-new-group-btn';
    newBtn.textContent = '+ New Group';
    newBtn.addEventListener('click', () => startNewGroup(sidebar));
    sidebar.appendChild(newBtn);

    const sortSel = document.createElement('select');
    sortSel.id = 'stars-group-sort';
    sortSel.title = 'Sort groups';
    [['alpha','A – Z'],['count','By count']].forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (val === groupSortOrder) opt.selected = true;
      sortSel.appendChild(opt);
    });
    sortSel.addEventListener('change', () => { groupSortOrder = sortSel.value; renderStarsView(); });
    sidebar.appendChild(sortSel);

    starsViewEl.appendChild(sidebar);

    // ── Main area ─────────────────────────────────────────────────────────────
    const mainArea = document.createElement('div');
    mainArea.id = 'stars-main';

    // ── Build level groups map (used by both lvl view and filter) ─────────────
    const levelGroupMap = {};
    Object.entries(levels).forEach(([id, n]) => {
      if (n != null) { if (!levelGroupMap[n]) levelGroupMap[n] = []; levelGroupMap[n].push(id); }
    });

    const mainHeader = document.createElement('div');
    mainHeader.id = 'stars-main-header';
    mainArea.appendChild(mainHeader);

    // ── Mobile compact header (replaces sidebar on small screens) ─────────────
    const mobileHdr = document.createElement('div');
    mobileHdr.id = 'stars-mobile-header';

    // Top row: title (left) + filter buttons (right) — all in one line
    const mobileTopRow = document.createElement('div');
    mobileHdr.appendChild(mobileTopRow);

    const mobileTitle = document.createElement('div');
    mobileTitle.id = 'stars-mobile-title';
    mobileTopRow.appendChild(mobileTitle);

    const mobileFilters = document.createElement('div');
    mobileFilters.id = 'stars-mobile-filters';
    mobileTopRow.appendChild(mobileFilters);

    function makeFilterBtn(cls, html, title, isActive, onClick) {
      const btn = document.createElement('button');
      btn.className = 'stars-filter-btn ' + cls + (isActive ? ' active' : '');
      btn.innerHTML = html;
      btn.title = title;
      btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
      return btn;
    }

    // tag — All tagged (the default view)
    const tagSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/></svg>';
    mobileFilters.appendChild(makeFilterBtn('stars-filter-tagged', tagSvg, 'All tagged', activeView === '__tagged__', () => {
      activeView = '__tagged__'; activeGroupIds.clear(); activeLvl.clear(); mobileStarsLvlOpen = false; mobileStarsGroupsOpen = false; renderStarsView();
    }));

    // ★ All Stars
    const isAll = activeView === null && activeGroupIds.size === 0 && activeLvl.size === 0 && !mobileStarsLvlOpen;
    mobileFilters.appendChild(makeFilterBtn('stars-filter-all', '★', 'All Stars', isAll, () => {
      activeView = null; activeGroupIds.clear(); activeLvl.clear(); mobileStarsLvlOpen = false; mobileStarsGroupsOpen = false; renderStarsView();
    }));

    // 👍 Liked group
    const likedG   = groups.find(g => g.name === 'liked');
    const likedActive = likedG ? activeGroupIds.has(likedG.id) : false;
    const thumbUpSvg  = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
    mobileFilters.appendChild(makeFilterBtn('stars-filter-thumb-up', thumbUpSvg, 'Liked', likedActive, () => {
      const g = groups.find(x => x.name === 'liked');
      if (!g) return;
      activeView = null; activeLvl.clear(); mobileStarsLvlOpen = false;
      if (activeGroupIds.has(g.id)) activeGroupIds.delete(g.id); else { activeGroupIds.clear(); activeGroupIds.add(g.id); }
      renderStarsView();
    }));

    // 👎 Disliked group
    const dislikedG   = groups.find(g => g.name === 'disliked');
    const dislikedActive = dislikedG ? activeGroupIds.has(dislikedG.id) : false;
    const thumbDownSvg   = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>';
    mobileFilters.appendChild(makeFilterBtn('stars-filter-thumb-down', thumbDownSvg, 'Disliked', dislikedActive, () => {
      const g = groups.find(x => x.name === 'disliked');
      if (!g) return;
      activeView = null; activeLvl.clear(); mobileStarsLvlOpen = false;
      if (activeGroupIds.has(g.id)) activeGroupIds.delete(g.id); else { activeGroupIds.clear(); activeGroupIds.add(g.id); }
      renderStarsView();
    }));

    // lvl filter button — tap: toggle inline lvl number strip / long-press: lvl groups view
    const lvlBtnActive = activeLvl.size > 0 || mobileStarsLvlOpen || activeView === '__lvl_groups__';
    const lvlFilterBtn = makeFilterBtn('stars-filter-lvl', 'lvl', 'Level filter (hold for groups)', lvlBtnActive, () => {});
    let _lvlTimer = null;
    lvlFilterBtn.addEventListener('pointerdown', () => {
      _lvlTimer = setTimeout(() => {
        _lvlTimer = null;
        mobileStarsLvlOpen = false;
        activeView = '__lvl_groups__'; activeGroupIds.clear(); activeLvl.clear(); renderStarsView();
      }, 500);
    });
    lvlFilterBtn.addEventListener('pointerup', () => {
      if (_lvlTimer) {
        clearTimeout(_lvlTimer); _lvlTimer = null;
        if (mobileStarsLvlOpen || activeLvl.size > 0) {
          mobileStarsLvlOpen = false; activeLvl.clear();
        } else {
          mobileStarsLvlOpen = true;
        }
        if (activeView === '__lvl_groups__') { activeView = null; activeGroupIds.clear(); }
        renderStarsView();
      }
    });
    lvlFilterBtn.addEventListener('pointercancel', () => { clearTimeout(_lvlTimer); _lvlTimer = null; });
    mobileFilters.appendChild(lvlFilterBtn);

    // "grp" toggle button — opens/closes the group picker panel
    const nonSystemGroups = groups.filter(g => g.name !== 'liked' && g.name !== 'disliked');
    if (nonSystemGroups.length) {
      const grpActiveCount = [...activeGroupIds].filter(id => nonSystemGroups.some(g => g.id === id)).length;
      const grpLabel = grpActiveCount > 0 ? `grp ${grpActiveCount}` : 'grp';
      const grpBtnActive = grpActiveCount > 0 || mobileStarsGroupsOpen;
      const grpBtn = makeFilterBtn('stars-filter-grp', grpLabel, 'Groups', grpBtnActive, () => {
        mobileStarsGroupsOpen = !mobileStarsGroupsOpen;
        renderStarsView();
      });
      mobileFilters.appendChild(grpBtn);

      // Expandable group picker panel (shown when open)
      if (mobileStarsGroupsOpen) {
        const groupWrap = document.createElement('div');
        groupWrap.id = 'stars-mobile-groups-wrap';
        const groupPanel = document.createElement('div');
        groupPanel.id = 'stars-mobile-groups';
        const sortedNS = [...nonSystemGroups].sort((a, b) => {
          if (groupSortOrder === 'count') return b.videoIds.length - a.videoIds.length;
          return a.name.localeCompare(b.name);
        });
        sortedNS.forEach(g => {
          const pill = document.createElement('button');
          pill.className = 'stars-mobile-group-pill' + (activeGroupIds.has(g.id) ? ' active' : '');
          pill.textContent = g.name + (g.videoIds.length ? ` ${g.videoIds.length}` : '');
          pill.addEventListener('click', () => {
            activeView = null; activeLvl.clear();
            if (activeGroupIds.has(g.id)) activeGroupIds.delete(g.id); else activeGroupIds.add(g.id);
            renderStarsView();
          });
          groupPanel.appendChild(pill);
        });
        groupWrap.appendChild(groupPanel);
        mobileHdr.appendChild(groupWrap);
      }
    }

    // Lvl number strip (visible when strip open or a lvl is already selected)
    if (mobileStarsLvlOpen || activeLvl.size > 0) {
      const lvlStrip = document.createElement('div');
      lvlStrip.id = 'stars-mobile-lvl-strip';
      for (let n = 10; n <= 23; n++) {
        const count = Object.keys(levels).filter(id => levels[id] === n).length;
        if (!count) continue;
        const btn = document.createElement('button');
        btn.className = 'stars-filter-btn stars-filter-lvl-num' + (activeLvl.has(n) ? ' active' : '');
        btn.textContent = n;
        btn.title = count + ' video' + (count !== 1 ? 's' : '');
        btn.addEventListener('click', e => {
          e.stopPropagation();
          activeView = null;
          if (activeLvl.has(n)) activeLvl.delete(n); else activeLvl.add(n);
          renderStarsView();
        });
        lvlStrip.appendChild(btn);
      }
      mobileHdr.appendChild(lvlStrip);
    }

    mainArea.insertBefore(mobileHdr, mainHeader);

    const grid = document.createElement('div');
    grid.id = 'stars-grid';

    if (activeView === '__lvl_groups__') {
      // ── Lvl groups view ─────────────────────────────────────────────────────
      const occupiedLvls = Object.keys(levelGroupMap).map(Number).sort((a, b) => a - b);
      mainHeader.innerHTML =
        `<span class="stars-main-title">lvl</span>` +
        `<span class="stars-main-count">${occupiedLvls.length} group${occupiedLvls.length !== 1 ? 's' : ''}</span>`;
      mobileTitle.innerHTML =
        `<span class="stars-main-title">lvl</span><span class="stars-main-count">${occupiedLvls.length} group${occupiedLvls.length !== 1 ? 's' : ''}</span>`;

      if (!occupiedLvls.length) {
        const empty = document.createElement('div');
        empty.id = 'stars-empty';
        empty.textContent = 'No levels assigned yet.';
        grid.appendChild(empty);
      } else {
        occupiedLvls.forEach(n => {
          const ids = levelGroupMap[n];
          // prefer starred video for cover, fall back to guessed local path
          const coverId = ids.find(id => stars[id]) || ids[ids.length - 1];
          const coverSrc = stars[coverId]?.coverSrc || `data/Likes/covers/${coverId}.jpg`;
          const card = document.createElement('div');
          card.className = 'stars-lvl-group-card';
          const img = document.createElement('img');
          img.src = coverSrc; img.className = 'stars-lvl-group-img';
          img.onerror = () => { img.style.display = 'none'; };
          card.appendChild(img);
          const badge = document.createElement('div');
          badge.className = 'stars-lvl-group-badge';
          badge.textContent = n;
          card.appendChild(badge);
          const countEl = document.createElement('div');
          countEl.className = 'stars-lvl-group-count';
          countEl.textContent = ids.length + ' video' + (ids.length !== 1 ? 's' : '');
          card.appendChild(countEl);
          card.addEventListener('click', () => {
            activeView = null; activeGroupIds.clear(); activeLvl.clear(); activeLvl.add(n); renderStarsView();
          });
          grid.appendChild(card);
        });
      }
    } else if (activeView === '__tagged__') {
      // ── All tagged: every video that belongs to at least one group ───────────
      const seen = new Set();
      const baseVideos = [];
      groups.forEach(g => g.videoIds.forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);
        baseVideos.push(stars[id]
          ? { ...stars[id], id }
          : { id, coverSrc: coverSrcFor(id), authorName: '', desc: '', lvlOnly: true });
      }));
      const videosToShow = sortVideos(activeLvl.size > 0
        ? baseVideos.filter(s => activeLvl.has(levels[s.id]))
        : baseVideos, 'stars');

      const countText = `${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}`;
      mainHeader.innerHTML =
        `<span class="stars-main-title">All tagged</span><span class="stars-main-count">${countText}</span>`;
      mobileTitle.innerHTML =
        `<span class="stars-main-title">All tagged</span><span class="stars-main-count">${countText}</span>`;

      setStarsContext(videosToShow);
      if (!videosToShow.length) {
        const empty = document.createElement('div');
        empty.id = 'stars-empty';
        empty.innerHTML = activeLvl.size > 0
          ? 'No tagged videos at this level.'
          : 'No tagged videos yet.<br>Use ⊕ or the braces button on a video to add it to a group.';
        grid.appendChild(empty);
      } else {
        fillGrid(grid, videosToShow, star => {
          const info = getVideoInfo(star.id);
          const authorName = info.authorName || star.authorName || '';
          const desc       = info.desc       || star.desc       || '';
          return buildStarsGridCard(star, authorName, desc, null);
        });
      }
    } else if (activeView === '__disappeared__') {
      // ── Disappeared: every archived video removed from the official lists (tagging does not hide it) ──
      const baseVideos = disappearedIds()
        .map(id => stars[id]
          ? { ...stars[id], id }
          : { id, coverSrc: coverSrcFor(id), authorName: '', desc: '', lvlOnly: true });
      const videosToShow = sortVideos(activeLvl.size > 0
        ? baseVideos.filter(s => activeLvl.has(levels[s.id]))
        : baseVideos, 'stars');

      const countText = `${videosToShow.length.toLocaleString()} video${videosToShow.length !== 1 ? 's' : ''}`;
      mainHeader.innerHTML =
        `<span class="stars-main-title">Disappeared</span><span class="stars-main-count">${countText}</span>`;
      mobileTitle.innerHTML =
        `<span class="stars-main-title">Disappeared</span><span class="stars-main-count">${countText}</span>`;

      setStarsContext(videosToShow);
      if (!videosToShow.length) {
        const empty = document.createElement('div');
        empty.id = 'stars-empty';
        empty.textContent = _dbCache
          ? (activeLvl.size > 0 ? 'No disappeared videos at this level.' : 'No disappeared videos.')
          : 'Loading the archive database…';
        grid.appendChild(empty);
      } else {
        fillGrid(grid, videosToShow, star => {
          const info = getVideoInfo(star.id);
          const authorName = info.authorName || star.authorName || '';
          const desc       = info.desc       || star.desc       || '';
          return buildStarsGridCard(star, authorName, desc, null);
        });
      }
    } else if (activeView === '__ungrouped__') {
      // ── Untagged view (stars and level-only videos that are in no group) ─────
      const groupedIdsSet = new Set(groups.flatMap(g => g.videoIds));
      const ungroupedStars = Object.entries(stars)
        .filter(([id]) => !groupedIdsSet.has(id))
        .map(([key, s]) => ({ ...s, id: key }));
      const lvlOnlyVideos = Object.entries(levels)
        .filter(([id]) => !stars[id] && levels[id] != null && !groupedIdsSet.has(id))
        .map(([id, n]) => ({
          id,
          coverSrc: coverSrcFor(id),
          authorName: '', desc: '', lvlOnly: true
        }));
      const baseVideos = [...ungroupedStars, ...lvlOnlyVideos];
      const videosToShow = sortVideos(activeLvl.size > 0
        ? baseVideos.filter(s => activeLvl.has(levels[s.id]))
        : baseVideos, 'stars');

      mainHeader.innerHTML =
        `<span class="stars-main-title">Untagged</span>` +
        `<span class="stars-main-count">${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}</span>`;
      mobileTitle.innerHTML =
        `<span class="stars-main-title">Untagged</span><span class="stars-main-count">${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}</span>`;

      setStarsContext(videosToShow);
      if (!videosToShow.length) {
        const empty = document.createElement('div');
        empty.id = 'stars-empty';
        empty.textContent = 'No untagged videos.';
        grid.appendChild(empty);
      } else {
        fillGrid(grid, videosToShow, star => {
          const info = getVideoInfo(star.id);
          const authorName = info.authorName || star.authorName || '';
          const desc       = info.desc       || star.desc       || '';
          const onRemove = star.lvlOnly
            ? () => { delete levels[star.id]; saveLevels(); renderStarsView(); }
            : null;
          return buildStarsGridCard(star, authorName, desc, onRemove);
        });
      }
    } else {
      // ── Normal video grid (all stars or multi-select groups) ─────────────────
      const isAll = activeGroupIds.size === 0;

      let baseVideos;
      if (isAll) {
        // all starred videos + all lvl-only unstarred (when lvl filter active)
        baseVideos = Object.entries(stars).map(([key, s]) => ({ ...s, id: key }));
        if (activeLvl.size > 0) {
          const starredIds = new Set(baseVideos.map(s => s.id));
          const lvlOnly = Object.entries(levels)
            .filter(([id, n]) => !starredIds.has(id) && activeLvl.has(n))
            .map(([id]) => ({ id, coverSrc: coverSrcFor(id), authorName: '', desc: '', lvlOnly: true }));
          baseVideos = [...baseVideos, ...lvlOnly];
        }
      } else {
        // union of all selected groups (starred + lvl-only)
        const seen = new Set();
        baseVideos = [];
        activeGroupIds.forEach(gid => {
          const g = groups.find(x => x.id === gid);
          if (!g) return;
          g.videoIds.forEach(id => {
            if (seen.has(id)) return; seen.add(id);
            if (stars[id]) {
              baseVideos.push({ ...stars[id], id });
            } else {
              baseVideos.push({ id, coverSrc: coverSrcFor(id), authorName: '', desc: '', lvlOnly: true });
            }
          });
        });
      }

      const videosToShow = sortVideos(activeLvl.size > 0
        ? baseVideos.filter(s => activeLvl.has(levels[s.id]))
        : baseVideos, 'stars');

      let titleText;
      if (isAll) titleText = 'All Stars';
      else if (activeGroupIds.size === 1) {
        const gid = [...activeGroupIds][0];
        titleText = groups.find(g => g.id === gid)?.name || 'Group';
      } else titleText = `${activeGroupIds.size} Groups`;

      mainHeader.innerHTML =
        `<span class="stars-main-title">${titleText}</span>` +
        `<span class="stars-main-count">${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}</span>`;
      mobileTitle.innerHTML =
        `<span class="stars-main-title">${titleText}</span><span class="stars-main-count">${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}</span>`;

      setStarsContext(videosToShow);
      if (!videosToShow.length) {
        const empty = document.createElement('div');
        empty.id = 'stars-empty';
        empty.innerHTML = isAll
          ? 'No starred videos yet.<br>Click ★ on any video in Likes, Favorites, or Following.'
          : 'No videos in this group yet.<br>Star videos and use ⊕ to add them here.';
        grid.appendChild(empty);
      } else {
        fillGrid(grid, videosToShow, star => {
          const info = getVideoInfo(star.id);
          const authorName = info.authorName || star.authorName || '';
          const desc       = info.desc       || star.desc       || '';
          // For unstarred cards in group view: ✕ removes from the selected groups (not the level)
          const onRemove = (star.lvlOnly && !isAll)
            ? () => {
                activeGroupIds.forEach(gid => {
                  const g = groups.find(x => x.id === gid);
                  if (g) g.videoIds = g.videoIds.filter(id => id !== star.id);
                });
                saveGroups(); renderStarsView();
              }
            : null;
          return buildStarsGridCard(star, authorName, desc, onRemove);
        });
      }
    }

    const isVideoGrid = activeView !== '__lvl_groups__';
    if (isVideoGrid) {
      grid.classList.add('preview-grid');
      mainHeader.appendChild(buildGridControls('stars', grid, starsViewEl));
      mobileTopRow.appendChild(buildGridControls('stars', grid, starsViewEl));
      mobileTopRow.appendChild(buildLabelToggle());
    }

    mainArea.appendChild(grid);
    starsViewEl.appendChild(mainArea);
    if (keep) {
      if (grid._fillTo) grid._fillTo(keep.loaded);
      grid.scrollTop = keep.scroll;
    }
    if (isVideoGrid) observeGridPreviews(grid);
  }

  function buildStarsGridCard(star, authorName, desc, onRemoveOverride) {
    const card = document.createElement('div');
    card.className = 'stars-grid-card';

    const cover = document.createElement('div');
    cover.className = 'stars-grid-cover';
    attachPreview(cover, star.coverSrc ? getVideoPath(star.coverSrc) : null);
    cover.addEventListener('click', () => openVideo(star.coverSrc));

    const img = document.createElement('img');
    img.src = star.coverSrc;
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; };
    cover.appendChild(img);

    const rmBtn = document.createElement('button');
    rmBtn.className = 'stars-grid-remove stars-grid-x';
    const isGlobalView = activeView === null && activeGroupIds.size === 0;
    const isInGroup    = activeView === null && activeGroupIds.size > 0;
    rmBtn.title = onRemoveOverride ? 'Remove level'
      : (isGlobalView || activeView === '__ungrouped__') ? 'Remove from Stars'
      : 'Remove from group';
    rmBtn.textContent = '✕';
    rmBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (onRemoveOverride) { onRemoveOverride(); return; }
      if (isGlobalView || activeView === '__ungrouped__') {
        toggleStar(star.id, star.coverSrc);
      } else if (isInGroup) {
        activeGroupIds.forEach(gid => {
          const g = groups.find(x => x.id === gid);
          if (g) { g.videoIds = g.videoIds.filter(id => id !== star.id); }
        });
        saveGroups(); renderStarsView();
      }
    });
    if (activeView !== '__tagged__' && activeView !== '__disappeared__') cover.appendChild(rmBtn);
    cover.appendChild(buildThumbTools(star.id, star.coverSrc, authorName, desc));
    appendLabelBubbles(cover, star.id);

    card.appendChild(cover);
    if (authorName) {
      const a = document.createElement('div');
      a.className = 'stars-grid-author';
      setAuthorLink(a, authorName);
      card.appendChild(a);
    }
    if (desc) {
      const d = document.createElement('div');
      d.className = 'stars-grid-desc';
      d.textContent = desc.length > 80 ? desc.slice(0, 80) + '…' : desc;
      card.appendChild(d);
    }
    return card;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP PICKER
  // ═══════════════════════════════════════════════════════════════════════════

  function showGroupPicker(anchorBtn, videoId) {
    const targetDoc = anchorBtn.ownerDocument || document;
    targetDoc.getElementById('stars-group-picker')?.remove();

    const picker = document.createElement('div');
    picker.id = 'stars-group-picker';

    const list = document.createElement('div');
    list.className = 'grp-picker-list';

    const buildRows = () => {
      list.innerHTML = '';
      const sorted = [...groups].sort((a, b) => b.videoIds.length - a.videoIds.length);
      if (!sorted.length) {
        const empty = document.createElement('div');
        empty.className = 'grp-picker-empty';
        empty.textContent = 'No groups yet';
        list.appendChild(empty);
      }
      sorted.forEach(g => {
        const row = document.createElement('label');
        row.className = 'grp-picker-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = g.videoIds.includes(videoId);
        cb.addEventListener('change', () => {
          if (cb.checked) { if (!g.videoIds.includes(videoId)) g.videoIds.push(videoId); }
          else g.videoIds = g.videoIds.filter(id => id !== videoId);
          saveGroups();
          if (starsTabActive) renderStarsView();
        });
        const nameSpan = document.createElement('span');
        nameSpan.className = 'grp-picker-name';
        nameSpan.textContent = g.name;
        const countSpan = document.createElement('span');
        countSpan.className = 'grp-picker-count';
        countSpan.textContent = g.videoIds.length;
        row.appendChild(cb); row.appendChild(nameSpan); row.appendChild(countSpan);
        list.appendChild(row);
      });
    };
    buildRows();
    picker.appendChild(list);

    // ＋ New group inline form
    const newRow = document.createElement('div');
    newRow.className = 'grp-picker-new-row';
    const addBtn = document.createElement('button');
    addBtn.className = 'grp-picker-add-btn';
    addBtn.textContent = '＋ New group';
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      addBtn.style.display = 'none';
      inp.style.display = 'flex';
      inp.querySelector('input').focus();
    });
    const inp = document.createElement('div');
    inp.className = 'grp-picker-inp';
    inp.style.display = 'none';
    const field = document.createElement('input');
    field.type = 'text'; field.placeholder = 'Group name'; field.maxLength = 40;
    const ok = document.createElement('button');
    ok.textContent = '✓'; ok.className = 'grp-picker-ok';
    const commit = () => {
      const name = field.value.trim();
      if (name) {
        const newG = { id: (Math.random().toString(36).slice(2)), name, videoIds: [videoId] };
        groups.push(newG);
        saveGroups();
        if (starsTabActive) renderStarsView();
        buildRows();
      }
      field.value = '';
      inp.style.display = 'none';
      addBtn.style.display = '';
    };
    ok.addEventListener('click', commit);
    field.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
    inp.appendChild(field); inp.appendChild(ok);
    newRow.appendChild(addBtn); newRow.appendChild(inp);
    picker.appendChild(newRow);

    targetDoc.body.appendChild(picker);
    const rect = anchorBtn.getBoundingClientRect();
    const pw = picker.offsetWidth || 180;
    const ph = picker.offsetHeight || 120;
    picker.style.top  = Math.max(4, Math.min(rect.top + rect.height / 2 - ph / 2, window.innerHeight - ph - 8)) + 'px';
    picker.style.left = Math.max(4, rect.left - pw - 6) + 'px';

    setTimeout(() => {
      targetDoc.addEventListener('click', function h(e) {
        if (!picker.contains(e.target)) { picker.remove(); targetDoc.removeEventListener('click', h); }
      });
    }, 0);
  }

  function showLevelPicker(anchorBtn, videoId, onUpdate) {
    const targetDoc = anchorBtn.ownerDocument || document;
    targetDoc.getElementById('level-picker')?.remove();

    const picker = document.createElement('div');
    picker.id = 'level-picker';

    const currentLvl = levels[videoId] ?? null;

    for (let n = 10; n <= 23; n++) {
      const btn = document.createElement('button');
      btn.className = 'lvl-picker-btn' + (currentLvl === n ? ' cur' : '');
      btn.textContent = n;
      btn.addEventListener('click', () => {
        if (currentLvl === n) { delete levels[videoId]; saveLevels(); onUpdate(null); }
        else { levels[videoId] = n; saveLevels(); onUpdate(n); }
        picker.remove();
      });
      picker.appendChild(btn);
    }

    targetDoc.body.appendChild(picker);
    const rect = anchorBtn.getBoundingClientRect();
    const pw = picker.offsetWidth || 120;
    const ph = picker.offsetHeight || 120;
    picker.style.top  = Math.max(4, rect.top + rect.height / 2 - ph / 2) + 'px';
    picker.style.left = Math.max(4, rect.left - pw - 6) + 'px';

    setTimeout(() => {
      targetDoc.addEventListener('click', function h(e) {
        if (!picker.contains(e.target) && e.target !== anchorBtn) {
          picker.remove(); targetDoc.removeEventListener('click', h);
        }
      });
    }, 0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function startNewGroup(sidebar) {
    const existing = sidebar.querySelector('#stars-new-group-btn');
    if (!existing) return;
    const form = document.createElement('div');
    form.className = 'stars-inline-form';
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'Group name';
    input.className = 'stars-inline-input'; input.maxLength = 40;
    const ok = document.createElement('button'); ok.textContent = '✓'; ok.className = 'stars-inline-confirm';
    const cancel = document.createElement('button'); cancel.textContent = '✕'; cancel.className = 'stars-inline-cancel';
    function commit() {
      const name = input.value.trim();
      if (name) { groups.push({ id: uid(), name, videoIds: [] }); saveGroups(); }
      renderStarsView();
    }
    ok.addEventListener('click', commit);
    cancel.addEventListener('click', () => renderStarsView());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') renderStarsView(); });
    form.appendChild(input); form.appendChild(ok); form.appendChild(cancel);
    existing.replaceWith(form);
    input.focus();
  }

  function startRenameGroup(groupId, rowEl) {
    const nameSpan = rowEl.querySelector('.stars-group-name');
    const g = groups.find(x => x.id === groupId);
    if (!nameSpan || !g) return;
    const input = document.createElement('input');
    input.type = 'text'; input.value = g.name;
    input.className = 'stars-inline-input'; input.maxLength = 40; input.style.width = '100%';
    function commit() { const name = input.value.trim(); if (name) { g.name = name; saveGroups(); } renderStarsView(); }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') renderStarsView(); });
    nameSpan.replaceWith(input);
    input.select();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAYER — VIDEO LIST
  // ═══════════════════════════════════════════════════════════════════════════

  let playerOpen           = false;
  let playerVideoList      = [];
  let playerWinStart       = 0;     // index in playerVideoList of the first rendered phone-feed slide
  let playerColumnOffsets  = [];   // one index per column, independently navigable
  let playerBuilding       = false;
  let playerViewEl         = null;  // mobile tab-view element (like starsViewEl)
  let playerReturnTab      = null;  // tab to return to when player is closed via X button
  let playerStartId        = null;  // if set, player will start at this video ID
  let recentsGridEl        = null;  // custom recents grid element
  let recentsGridBuilt     = false; // true once grid has been populated

  // ── Mobile tab state ───────────────────────────────────────────────────────
  const MOBILE_TABS = ['home', 'stars', 'recents', 'favs', 'review'];
  let activeMobileTab = 'stars';   // the app opens on Stars (see showDefaultStarsView)

  function updateMobileNavActive() {
    document.querySelectorAll('#sp-mobile-nav .sp-nav-btn').forEach(btn => {
      btn.classList.toggle('sp-active', btn.dataset.tab === activeMobileTab);
    });
  }

  function setMobileTab(tab, skipAnim) {
    if (activeAuthorId) hideAuthorView(false);
    if (autotagTabActive && tab !== 'review') hideAutotagView();
    if (tab !== 'stars') releaseGridPreviews(starsViewEl);
    const oldIdx = MOBILE_TABS.indexOf(activeMobileTab);
    const newIdx = MOBILE_TABS.indexOf(tab);
    activeMobileTab = tab;
    updateMobileNavActive();
    if (tab === 'home') {
      hideRecentsView();
      showMainContent();
      if (!playerOpen) {
        openPlayer();
      } else {
        if (playerViewEl) playerViewEl.style.display = '';
      }
    } else if (tab === 'stars') {
      if (playerOpen) closePlayer();
      hideRecentsView();
      showStarsTab();
    } else if (tab === 'recents') {
      if (playerOpen) closePlayer();
      showRecentsView();
    } else if (tab === 'review') {
      if (playerOpen) closePlayer();
      hideRecentsView();
      showAutotagTab();
    } else {
      // favs
      if (playerOpen) closePlayer();
      hideRecentsView();
      showMainContent();
      document.querySelector('nav div.bookmarked')?.click();
    }
    if (!skipAnim) {
      requestAnimationFrame(() => applySwipeEnter(getSwipeViewEl(), newIdx > oldIdx ? 'left' : 'right'));
    }
  }

  // Let the page draw under the notch/status bar (viewport-fit=cover) and, when added to the Home Screen,
  // use a translucent status bar so the video runs edge to edge.
  function setupPhoneChrome() {
    const meta = (name, content) => {
      let m = document.querySelector(`meta[name="${name}"]`);
      if (!m) { m = document.createElement('meta'); m.name = name; document.head.appendChild(m); }
      m.content = content;
      return m;
    };
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) vp = meta('viewport', 'width=device-width, initial-scale=1');
    if (!/viewport-fit/.test(vp.content)) vp.content += ', viewport-fit=cover';
    meta('apple-mobile-web-app-capable', 'yes');
    meta('mobile-web-app-capable', 'yes');
    meta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    meta('theme-color', '#000000');
  }

  function createMobileNav() {
    if (document.getElementById('sp-mobile-nav')) return;
    const nav = document.createElement('div');
    nav.id = 'sp-mobile-nav';
    const tabs = [
      { id: 'home',    label: 'Home',    svg: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>' },
      { id: 'stars',   label: 'Stars',   svg: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' },
      { id: 'recents', label: 'Recents', svg: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L11 13.5V7h1.5v5.87l4.75 2.82-1.01 1.74z"/>' },
      { id: 'favs',    label: 'Favs',    svg: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' },
      { id: 'review',  label: 'Review',  svg: '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>' },
    ];
    tabs.forEach(({ id, label, svg }) => {
      const btn = document.createElement('button');
      btn.className = 'sp-nav-btn' + (id === activeMobileTab ? ' sp-active' : '');
      btn.dataset.tab = id;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">${svg}</svg><span>${label}</span>`;
      btn.addEventListener('click', () => setMobileTab(id));
      nav.appendChild(btn);
    });
    document.body.appendChild(nav);
  }

  const TAB_LABELS = { home: 'Home', stars: 'Stars', recents: 'Recents', favs: 'Favs', review: 'Review' };

  function getSwipeViewEl() {
    if (activeMobileTab === 'home')    return playerViewEl;
    if (activeMobileTab === 'stars')   return document.getElementById('stars-view');
    if (activeMobileTab === 'recents') return recentsGridEl;
    if (activeMobileTab === 'review')  return autotagViewEl;
    return document.querySelector('main');
  }

  function applySwipeEnter(el, dir) {
    if (!el) return;
    const cls = dir === 'left' ? 'sp-enter-from-right' : 'sp-enter-from-left';
    el.classList.remove('sp-enter-from-right', 'sp-enter-from-left');
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  function doSwipe(newTab, dir, outEl) {
    if (outEl) {
      outEl.style.transition = 'transform 0.22s ease';
      outEl.style.transform = `translateX(${dir === 'left' ? -110 : 110}vw)`;
      setTimeout(() => {
        outEl.style.transition = '';
        outEl.style.transform = '';
        setMobileTab(newTab, true);
        requestAnimationFrame(() => applySwipeEnter(getSwipeViewEl(), dir));
      }, 220);
    } else {
      setMobileTab(newTab, true);
      requestAnimationFrame(() => applySwipeEnter(getSwipeViewEl(), dir));
    }
  }

  function showSwipeHint(dx, fromIdx) {
    let hint = document.getElementById('sp-swipe-hint');
    if (!hint) return;
    const isNext = dx < 0;
    const targetIdx = fromIdx + (isNext ? 1 : -1);
    if (targetIdx < 0 || targetIdx >= MOBILE_TABS.length) {
      hint.style.opacity = '0'; return;
    }
    hint.querySelector('.sp-sh-label').textContent = TAB_LABELS[MOBILE_TABS[targetIdx]];
    hint.querySelector('.sp-sh-arrow').textContent = isNext ? '›' : '‹';
    hint.style.left   = isNext ? 'auto' : '0';
    hint.style.right  = isNext ? '0'    : 'auto';
    hint.style.borderRadius = isNext ? '10px 0 0 10px' : '0 10px 10px 0';
    hint.style.opacity = String(Math.min(1, Math.abs(dx) / 80));
  }

  function hideSwipeHint() {
    const hint = document.getElementById('sp-swipe-hint');
    if (hint) { hint.style.opacity = '0'; }
  }

  function initSwipeHint() {
    if (document.getElementById('sp-swipe-hint')) return;
    const hint = document.createElement('div');
    hint.id = 'sp-swipe-hint';
    hint.innerHTML = '<span class="sp-sh-arrow"></span><span class="sp-sh-label"></span>';
    document.body.appendChild(hint);
  }

  // The video in the phone feed that is currently showing, and who posted it
  function feedAuthorName() {
    const item = playerVideoList[playerColumnOffsets[0] || 0];
    if (!item) return '';
    const info = getVideoInfo(item.id);
    return (info && info.authorName) || item.authorName || '';
  }

  // Slide the username page (and the view under it, with a little parallax) to x px from the left edge.
  // x = innerWidth: page fully off to the right; x = 0: page fully covering the screen.
  function dragAuthorTo(x) {
    const W = window.innerWidth || 1;
    const under = getSwipeViewEl();
    if (authorViewEl) { authorViewEl.style.transition = 'none'; authorViewEl.style.transform = `translateX(${x}px)`; }
    if (under) { under.style.transition = 'none'; under.style.transform = `translateX(${-(W - x) * 0.3}px)`; }
  }

  // Finish a drag: glide the username page to x, then tidy up the inline styles and call done
  function settleAuthorTo(x, done) {
    const W = window.innerWidth || 1;
    const under = getSwipeViewEl();
    const ease = 'transform 0.26s cubic-bezier(.2,.8,.2,1)';
    if (authorViewEl) { authorViewEl.style.transition = ease; authorViewEl.style.transform = `translateX(${x}px)`; }
    if (under) { under.style.transition = ease; under.style.transform = `translateX(${-(W - x) * 0.3}px)`; }
    setTimeout(() => {
      [authorViewEl, under].forEach(n => { if (n) { n.style.transition = ''; n.style.transform = ''; } });
      if (done) done();
    }, 270);
  }

  // Swipe right on a username page: slide it away and go back to what was underneath
  function swipeBackFromAuthor() {
    const id = activeAuthorId;
    if (!authorViewEl || !id) return;
    settleAuthorTo(window.innerWidth || 1, () => closeAuthorTab(id));
  }

  function setupMobileSwipe() {
    initSwipeHint();
    // _ctx: where the touch started. 'author' = a username page (drag right = pull it off),
    // 'feed' = the video feed (drag left = pull that user's page over), 'tabs' = the usual tab swipes,
    // 'none' = controls such as the size slider or the seek bar, which must not be mistaken for a swipe.
    let _tsx = 0, _tsy = 0, _tt = 0, _swipeDir = null, _swiping = false, _outEl = null, _ctx = 'tabs', _pull = null;

    document.addEventListener('touchstart', e => {
      _tsx = e.touches[0].clientX;
      _tsy = e.touches[0].clientY;
      _tt = Date.now();
      _swipeDir = null; _swiping = false; _pull = null;
      const t = e.target;
      if (t.closest && t.closest('input, .grid-controls, select, textarea, .sp-seek')) _ctx = 'none';
      else if (authorViewOpen() && authorViewEl.contains(t)) _ctx = 'author';
      else if (playerViewEl && playerViewEl.style.display !== 'none' && playerViewEl.contains(t)) _ctx = 'feed';
      else _ctx = 'tabs';
      _outEl = _ctx === 'author' ? authorViewEl : getSwipeViewEl();
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (_ctx === 'none') return;
      const dx = e.touches[0].clientX - _tsx;
      const dy = e.touches[0].clientY - _tsy;
      if (!_swipeDir && (Math.abs(dx) > 8 || Math.abs(dy) > 8))
        _swipeDir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (_swipeDir !== 'h') return;
      const W = window.innerWidth || 1;
      if (_ctx === 'author') {          // the page follows the finger; only a rightward drag does anything
        if (dx > 0) { _swiping = true; dragAuthorTo(Math.min(W, dx)); }
        return;
      }
      if (_ctx === 'feed' && (dx < 0 || _pull)) {   // leftward drag on a video: the user's page rides in from the right
        if (!_pull) {
          const name = feedAuthorName();
          const id = _dbCache && name ? authorIdForName(name) : null;
          if (!id) return;
          _pull = { id, wasOpen: openAuthors.some(a => a.id === id) };
          showAuthorTab(id, name);
        }
        _swiping = true;
        dragAuthorTo(Math.max(0, Math.min(W, W + dx)));
        return;
      }
      const idx = MOBILE_TABS.indexOf(activeMobileTab);
      if ((dx < 0 && idx >= MOBILE_TABS.length - 1) || (dx > 0 && idx <= 0)) return;
      _swiping = true;
      if (_outEl) _outEl.style.transform = `translateX(${dx * 0.35}px)`;
      showSwipeHint(dx, idx);
    }, { passive: true });

    function endTouch(dx, dy) {
      hideSwipeHint();
      if (_ctx === 'none') return;
      const W = window.innerWidth || 1;
      const vel = dx / Math.max(1, Date.now() - _tt);   // px per ms; fast flicks commit even when short
      if (_ctx === 'author') {
        if (!_swiping) return;
        if (dx > W * 0.3 || (dx > 40 && vel > 0.5)) swipeBackFromAuthor();
        else settleAuthorTo(0);
        return;
      }
      if (_pull) {
        const p = _pull;
        _pull = null;
        if (-dx > W * 0.3 || (-dx > 40 && vel < -0.5)) {
          settleAuthorTo(0);            // user page now covers the screen
        } else {
          settleAuthorTo(W, () => { if (p.wasOpen) hideAuthorView(true); else closeAuthorTab(p.id); });
        }
        return;
      }
      if (!_swiping) return;
      if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) {
        // snap back
        if (_outEl) { _outEl.style.transition = 'transform 0.2s ease'; _outEl.style.transform = ''; setTimeout(() => { if (_outEl) _outEl.style.transition = ''; }, 200); }
        return;
      }
      const idx = MOBILE_TABS.indexOf(activeMobileTab);
      const newTab = dx < 0 ? MOBILE_TABS[idx + 1] : MOBILE_TABS[idx - 1];
      if (!newTab) { if (_outEl) { _outEl.style.transform = ''; } return; }
      doSwipe(newTab, dx < 0 ? 'left' : 'right', _outEl);
    }
    document.addEventListener('touchend', e => {
      endTouch(e.changedTouches[0].clientX - _tsx, e.changedTouches[0].clientY - _tsy);
    }, { passive: true });
    document.addEventListener('touchcancel', () => endTouch(0, 0), { passive: true });
  }

  function numCols() { return window.innerWidth < 768 ? 1 : 3; }

  // Walk React's fiber tree from a root element to find the react-window
  // VariableSizeList and extract all video IDs from its itemKey prop.
  function extractIdsFromFiber() {
    // Try several candidate elements for the React fiber root
    const candidates = [
      document.getElementById('archive'),
      document.querySelector('main'),
      document.body,
    ].filter(Boolean);

    let rootFiber = null;
    for (const el of candidates) {
      const k = Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (k) { rootFiber = el[k]; console.log('[Fiber] root on', el.id || el.tagName, k.slice(0,20)); break; }
    }

    if (!rootFiber) {
      console.log('[Fiber] no React fiber found on any candidate element');
      return [];
    }

    const ids = [];
    let walked = 0;

    // Iterative (not recursive) — avoids call-stack overflow on mobile,
    // where the JS stack limit is far smaller than on desktop.
    const stack = [rootFiber];
    while (stack.length > 0 && walked < 50000) {
      const fiber = stack.pop();
      if (!fiber) continue;
      walked++;
      const p = fiber.memoizedProps;
      if (p && typeof p.itemCount === 'number' && p.itemCount > 0) {
        console.log('[Fiber] list-like node itemCount=' + p.itemCount +
          ' hasItemKey=' + (typeof p.itemKey === 'function'));
        if (typeof p.itemKey === 'function') {
          for (let i = 2; i < p.itemCount; i++) {
            const id = p.itemKey(i);
            if (typeof id === 'string' && id.length > 8) ids.push(id);
          }
          // Don't descend into children of a matched list node; do continue siblings
          if (fiber.sibling) stack.push(fiber.sibling);
          continue;
        }
      }
      // Push sibling before child so child is processed first (depth-first order)
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child)   stack.push(fiber.child);
    }

    console.log('[Fiber] walked', walked, 'nodes, ids:', ids.length);
    return ids;
  }

  // Build the video list by briefly switching to Likes then Bookmarked tabs,
  // reading IDs from the React fiber each time, then restoring the active tab.
  async function buildVideoList() {
    playerBuilding = true;
    const list = [];
    const seen = new Set();

    // Remember which tab is currently active so we can restore it
    const prevTab = document.querySelector('nav div.active:not(.stars-tab):not(.player-tab)');

    async function collectTab(tabClass, videoPath, coverPath) {
      const tabEl = document.querySelector(`nav div.${tabClass}`);
      if (!tabEl) return;
      tabEl.click();
      await new Promise(r => setTimeout(r, 800));

      // Primary: React fiber (gets full list regardless of scroll position)
      let ids = extractIdsFromFiber();
      console.log(`[Player] ${tabClass} via fiber: ${ids.length}`);

      // Fallback: collect from whichever thumbnails are currently in the DOM
      if (ids.length === 0) {
        ids = [];
        document.querySelectorAll('img.thumbnail').forEach(img => {
          const id = getVideoIdFromSrc(img.getAttribute('src') || '');
          if (id) ids.push(id);
        });
        console.log(`[Player] ${tabClass} via DOM thumbnails: ${ids.length}`);
      }

      // Collect author names and captions from whichever rows are currently visible in the DOM.
      const authorMap = {};
      const descMap = {};
      const covers = document.querySelectorAll('div.cover');
      covers.forEach(coverDiv => {
        const imgId = getVideoIdFromSrc(coverDiv.querySelector('img.thumbnail')?.getAttribute('src') || '');
        if (!imgId) return;
        const { authorName, desc } = scrapeRowMeta(coverDiv);
        if (authorName) authorMap[imgId] = authorName;
        if (desc) descMap[imgId] = desc;
      });
      console.log('[Player] author map sample:', Object.entries(authorMap).slice(0, 3));

      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        list.push({ id, videoPath: videoPath(id), coverSrc: coverPath(id), authorName: authorMap[id] || '', desc: descMap[id] || '' });
      }
    }

    await collectTab('likes',
      id => `data/Likes/videos/${id}.mp4`,
      id => `data/Likes/covers/${id}.jpg`
    );

    await collectTab('bookmarked',
      id => `data/Favorites/videos/${id}.mp4`,
      id => `data/Favorites/covers/${id}.jpg`
    );

    // Restore the original tab
    (prevTab || document.querySelector('nav div.likes'))?.click();

    const ordered = await orderHomeList(list);

    console.log('[Player] total videos:', ordered.length);
    playerBuilding = false;
    return ordered;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAYER — OVERLAY
  // ═══════════════════════════════════════════════════════════════════════════

  function isMobilePlayer() { return window.innerWidth < 768; }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECENTS GRID (mobile) — custom cover grid replacing the React virtual list
  // ═══════════════════════════════════════════════════════════════════════════

  async function showRecentsView() {
    if (!recentsGridEl) {
      recentsGridEl = document.createElement('div');
      recentsGridEl.id = 'recents-grid-view';
      document.body.appendChild(recentsGridEl);
    }
    recentsGridEl.style.display = 'flex';
    if (recentsGridBuilt) return;

    recentsGridEl.innerHTML = '<div id="recents-grid-loading">Loading…</div>';
    document.querySelector('nav div.likes')?.click();
    await new Promise(r => setTimeout(r, 600));

    const ids = extractIdsFromFiber();
    recentsGridEl.innerHTML = '';

    // Build context list for the video overlay (same shape as stars context)
    const contextList = ids.map(id => ({
      id,
      coverSrc:  `data/Likes/covers/${id}.jpg`,
      videoPath: `data/Likes/videos/${id}.mp4`,
      authorName: '', desc: '',
    }));

    // ── Stats overlay (shown/hidden by button) ──────────────────────────────
    const statsOverlay = document.createElement('div');
    statsOverlay.id = 'recents-stats-overlay';

    const statsBtn = document.createElement('button');
    statsBtn.id = 'recents-stats-btn';
    statsBtn.textContent = '📈';
    statsBtn.title = 'Stats';
    statsBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = statsOverlay.classList.toggle('recents-stats-open');
      if (open) {
        statsOverlay.innerHTML = '';

        // ── Build stats from archive data (E is module-scoped in app.js, not window.E)
        // findArchiveData() walks the React fiber and returns the full E object
        // because E has both videoDescriptions and videos properties.
        const archData = findArchiveData();
        const lk = archData && archData.likes;
        const total      = (lk && lk.total)                        || ids.length;
        const downloaded = (lk && lk.downloaded && lk.downloaded.size) || 0;

        // disappeared = downloaded videos no longer in officialList (mirrors app.js Ke.disappeared)
        let disappeared = 0;
        if (lk && lk.downloaded && lk.officialList) {
          const offSet = new Set(lk.officialList);
          disappeared = [...lk.downloaded].filter(n => !offSet.has(n)).length;
        }

        // date from lastRun (timestamps in seconds)
        let lastRunDate = null;
        if (lk && lk.lastRun) {
          const ts = Math.max(lk.lastRun.start || 0, lk.lastRun.finish || 0);
          if (ts > 0) lastRunDate = ts;
        }

        // ── Find Redux dispatch — context value shape is {store} so dispatch
        //    is at val.store.dispatch or val.dispatch (older react-redux)
        function findDispatch() {
          const rootEl = [document.getElementById('archive'), document.querySelector('main'), document.body]
            .filter(Boolean).find(el => Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')));
          if (!rootEl) return null;
          const rootKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
          const stack = [rootEl[rootKey]]; let walked = 0;
          while (stack.length && walked < 200000) {
            const fiber = stack.pop(); if (!fiber) continue; walked++;
            const val = fiber.memoizedProps && fiber.memoizedProps.value;
            if (val) {
              // react-redux 8+: context value = {store, subscription}
              const d = (val.store && val.store.dispatch) || val.dispatch;
              if (typeof d === 'function') return d;
            }
            if (fiber.sibling) stack.push(fiber.sibling);
            if (fiber.child)   stack.push(fiber.child);
          }
          return null;
        }

        // ── Render stats row ─────────────────────────────────────────────────
        const p = document.createElement('p');
        p.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:0;padding:12px 16px;font-size:14px;color:#ccc;';

        const mkSpan = (text, clickFn) => {
          const s = document.createElement('span');
          s.textContent = text;
          if (clickFn) { s.style.cssText = 'cursor:pointer;text-decoration:underline;color:#f66;'; s.addEventListener('click', clickFn); }
          return s;
        };

        p.appendChild(mkSpan(`❤️ ${total}`));

        if (disappeared > 0) {
          p.appendChild(mkSpan(`⛔️ ${disappeared}`, ev => {
            ev.stopPropagation();
            // Switch to Likes tab in React + dispatch disappeared view
            document.querySelector('nav div.likes')?.click();
            const dispatch = findDispatch();
            if (dispatch) dispatch({ type: 'routes/click_disappeared_video_count' });
            statsOverlay.classList.remove('recents-stats-open');
            setMobileTab('home');
          }));
        }

        if (downloaded > 0) p.appendChild(mkSpan(`⬇️ ${downloaded}`));

        if (lastRunDate) {
          const d = new Date(lastRunDate * 1000);
          p.appendChild(mkSpan(`🏃🏼‍♀️ ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`));
        }

        statsOverlay.appendChild(p);
      }
    });
    recentsGridEl.appendChild(statsOverlay);
    recentsGridEl.appendChild(statsBtn);

    // ── Grid ────────────────────────────────────────────────────────────────
    const grid = document.createElement('div');
    grid.id = 'recents-grid';

    ids.forEach((id, idx) => {
      const card = document.createElement('div');
      card.className = 'recents-card';

      // Cover wrapper — reuse stars-grid-cover for consistent styling
      const cover = document.createElement('div');
      cover.className = 'stars-grid-cover recents-cover-wrap';
      card.appendChild(cover);

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = `data/Likes/covers/${id}.jpg`;
      cover.appendChild(img);

      // Tap cover → open video overlay (same as stars, returns to recents)
      cover.addEventListener('click', () => {
        const info = getVideoInfo(id);
        contextList[idx].authorName = info.authorName || '';
        contextList[idx].desc       = info.desc       || '';
        openVideoOverlay(idx, contextList);
      });

      // Star button (top-right) ── same position as stars-grid-remove
      const starBtn = document.createElement('button');
      starBtn.className = 'stars-grid-remove recents-star-btn';
      const refreshStarBtn = () => {
        const on = Boolean(stars[id]);
        starBtn.textContent = on ? '★' : '☆';
        starBtn.title = on ? 'Remove from Stars' : 'Add to Stars';
        starBtn.classList.toggle('recents-star-active', on);
      };
      refreshStarBtn();
      starBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleStar(id, `data/Likes/covers/${id}.jpg`);
        refreshStarBtn();
      });
      cover.appendChild(starBtn);
      cover.appendChild(makeBracesBtn('stars-grid-remove grid-braces-btn', id, 13));

      // Group button (top-left) ── same position as stars-grid-add-group
      const grpBtn = document.createElement('button');
      grpBtn.className = 'stars-grid-add-group recents-grp-btn';
      grpBtn.textContent = '⊕';
      grpBtn.title = 'Add to group';
      grpBtn.addEventListener('click', e => {
        e.stopPropagation();
        showGroupPicker(grpBtn, id);
      });
      cover.appendChild(grpBtn);

      grid.appendChild(card);
    });

    recentsGridEl.appendChild(grid);
    recentsGridBuilt = true;
  }

  function hideRecentsView() {
    if (recentsGridEl) recentsGridEl.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WATCH LOG + RANKED FEED
  // ═══════════════════════════════════════════════════════════════════════════
  // How you watch is kept as counters per video (ids and numbers only): s = times shown,
  // m = ms watched, k = quick skips, e = plays to the end (a replay counts again), t = last shown.
  // They live in localStorage and go to /api/watch as deltas so every device adds to one picture.
  // The ranker below never needs to know what any group is called: it only sees which videos
  // share a group, how big the groups are, and which videos were starred or watched.

  const WATCH_KEY = 'sp_watch';
  const SKIP_MS   = 2500;
  let watchStats  = {};      // id -> { s, m, k, e, t }
  let watchDelta  = {};      // counters not yet sent to the server
  let watchTimer  = null;
  let endFeedVisit = null;   // set by the phone feed; closes the visit being timed

  (function loadWatchLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || 'null');
      if (raw && typeof raw === 'object') { watchStats = raw.stats || {}; watchDelta = raw.delta || {}; }
    } catch (_) {}
  })();

  function saveWatchLocal() {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify({ stats: watchStats, delta: watchDelta })); } catch (_) {}
  }

  function addCounters(target, id, d) {
    const c = target[id] || (target[id] = { s: 0, m: 0, k: 0, e: 0, t: 0 });
    c.s += d.s || 0; c.m += d.m || 0; c.k += d.k || 0; c.e += d.e || 0; c.t = Math.max(c.t || 0, d.t || 0);
  }

  function watchAdd(id, d) {
    const full = { s: 0, m: 0, k: 0, e: 0, t: Date.now(), ...d };
    addCounters(watchStats, id, full);
    addCounters(watchDelta, id, full);
    saveWatchLocal();
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => flushWatch(false), 20000);
  }

  function flushWatch(useBeacon) {
    if (!Object.keys(watchDelta).length) return;
    const sent = watchDelta;
    const body = JSON.stringify({ delta: sent });
    watchDelta = {};
    saveWatchLocal();
    const restore = () => { Object.entries(sent).forEach(([id, d]) => addCounters(watchDelta, id, d)); saveWatchLocal(); };
    if (useBeacon && navigator.sendBeacon) {
      if (!navigator.sendBeacon('/api/watch', new Blob([body], { type: 'application/json' }))) restore();
      return;
    }
    fetch('/api/watch', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      .then(r => { if (!r.ok) throw new Error(r.status); })
      .catch(restore);   // no server, or it failed: keep the counters for the next try
  }

  // The server's totals (all devices) plus whatever this device has not sent yet
  const watchReady = fetch('/api/watch', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d || !d.watch) return;
      const merged = JSON.parse(JSON.stringify(d.watch));
      Object.entries(watchDelta).forEach(([id, x]) => addCounters(merged, id, x));
      watchStats = merged;
      saveWatchLocal();
    })
    .catch(() => { /* no server */ });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (endFeedVisit) endFeedVisit(); flushWatch(true); }
  });
  window.addEventListener('pagehide', () => { if (endFeedVisit) endFeedVisit(); flushWatch(true); });

  // ── Ranking ────────────────────────────────────────────────────────────────
  // score = how much your own habits favour the video + a little novelty. Every number is here so
  // it is easy to tune.
  const RANK = {
    lift: 1.0,         // groups whose videos you star more often than average pull their videos up
    interest: 1.0,     // ...and so do groups you have put many videos in
    star: 1.5, level: 0.3, liked: 1.2, disliked: -4,
    engagement: 1.6,   // finishing/replaying lifts a video, skipping it quickly lowers it
    unseen: 0.4,       // a small push for videos the feed has never shown
    recent: -2.5, recentDays: 2,   // just shown: keep it out for a while
    repeat: -0.2,      // shown many times overall
    popularity: 0.15,  // like count from the archive, a gentle prior
    temperature: 1.0,  // higher = more variety between runs
    authorGap: 3,      // avoid the same author within this many videos
    lookahead: 25,     // how far ahead to look for a different author
    explore: 0.1,      // chance a slot in the first 200 is given to a random unseen video
  };
  const QUICK_POSITIVE = 'liked', QUICK_NEGATIVE = 'disliked';

  // list: [{ id, ... }]. Returns a new array in feed order. rng/now are injectable for tests.
  function rankVideos(list, rng, now) {
    rng = rng || Math.random;
    now = now || Date.now();
    const n = list.length;
    if (n < 2) return list.slice();
    const d = _dbCache;
    const inList = new Set(list.map(v => v.id));

    // Group statistics over the videos being ranked
    const starCount = list.reduce((k, v) => k + (stars[v.id] ? 1 : 0), 0);
    const base = (starCount + 1) / (n + 2);
    const PRIOR = 8;
    const stat = [];
    let maxN = 1;
    const liked = new Set(), disliked = new Set();
    const member = new Map();                      // video id -> [group ids that count as tags]
    groups.forEach(g => {
      const name = String(g.name).trim().toLowerCase();
      if (name === QUICK_POSITIVE || name === QUICK_NEGATIVE) {
        g.videoIds.forEach(id => (name === QUICK_POSITIVE ? liked : disliked).add(id));
        return;
      }
      let ng = 0, sg = 0;
      g.videoIds.forEach(id => {
        if (!inList.has(id)) return;
        ng++; if (stars[id]) sg++;
        (member.get(id) || member.set(id, []).get(id)).push(g.id);
      });
      if (ng) { stat.push({ id: g.id, ng, sg }); if (ng > maxN) maxN = ng; }
    });
    const weight = new Map();
    stat.forEach(({ id, ng, sg }) => {
      const rate = (sg + PRIOR * base) / (ng + PRIOR);
      // capped both ways: a group with no stars is not a dislike, and one huge lift must not drown the rest
      const lift = Math.max(-1, Math.min(2, Math.log(rate / base)));
      weight.set(id, RANK.lift * lift + RANK.interest * (Math.log1p(ng) / Math.log1p(maxN)));
    });

    let maxLog = 1;
    if (d) list.forEach(v => { const x = d.videos[v.id]; if (x) maxLog = Math.max(maxLog, Math.log10(1 + (x.diggCount || 0))); });

    const scored = list.map(item => {
      const id = item.id;
      const gs = member.get(id);
      let sc = 0;
      if (gs) sc = gs.reduce((a, g) => a + (weight.get(g) || 0), 0) / Math.sqrt(gs.length);
      if (stars[id]) sc += RANK.star;
      if (levels[id] != null) sc += RANK.level;
      if (liked.has(id)) sc += RANK.liked;
      if (disliked.has(id)) sc += RANK.disliked;
      const w = watchStats[id];
      if (w && w.s) {
        sc += RANK.engagement * Math.max(-1.2, Math.min(1.2, (0.8 * w.e - 1.2 * w.k) / (w.s + 1)));
        sc += RANK.recent * Math.exp(-((now - (w.t || 0)) / 864e5) / RANK.recentDays);
        sc += RANK.repeat * Math.log1p(w.s);
      } else sc += RANK.unseen;
      const x = d && d.videos[id];
      if (x) sc += RANK.popularity * (Math.log10(1 + (x.diggCount || 0)) / maxLog);
      return { item, id, score: sc, author: x ? x.authorId : null };
    });

    // Sample an order in proportion to the scores (adds Gumbel noise), so every run differs
    scored.forEach(r => { r.key = r.score / RANK.temperature - Math.log(-Math.log(Math.max(rng(), 1e-12))); });
    scored.sort((a, b) => b.key - a.key);

    // Spread authors out: take the best-ranked video whose author wasn't just shown
    const out = [], recent = [], taken = new Uint8Array(n);
    let head = 0;
    while (out.length < n) {
      while (taken[head]) head++;
      let pick = head;
      for (let j = head, seen = 0; j < n && seen < RANK.lookahead; j++) {
        if (taken[j]) continue;
        seen++;
        if (!scored[j].author || !recent.includes(scored[j].author)) { pick = j; break; }
      }
      taken[pick] = 1;
      out.push(scored[pick]);
      recent.push(scored[pick].author);
      if (recent.length > RANK.authorGap) recent.shift();
    }

    // A little exploration near the top so the feed can't lock itself in
    const pool = [];
    out.forEach((r, i) => { if (!watchStats[r.id] && !disliked.has(r.id)) pool.push(i); });
    for (let i = 0; i < Math.min(200, n) && pool.length; i++) {
      if (rng() < RANK.explore) {
        const j = pool[Math.floor(rng() * pool.length)];
        if (j > i) [out[i], out[j]] = [out[j], out[i]];
      }
    }
    return out.map(r => r.item);
  }

  function shuffleList(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function feedMode() {
    try { return localStorage.getItem('sp_feed_mode') === 'shuffle' ? 'shuffle' : 'ranked'; } catch (_) { return 'ranked'; }
  }

  // Order a list of candidate videos for the Home feed / pop-out player
  async function orderHomeList(list) {
    if (feedMode() !== 'ranked') return shuffleList(list);
    try { await Promise.race([watchReady, new Promise(r => setTimeout(r, 1500))]); } catch (_) {}
    return rankVideos(list);
  }

  // The Home feed's videos: from the archive database when it is available (fast, nothing flickers);
  // otherwise the app's own lists are read (that switches tabs behind the scenes)
  async function buildHomeList() {
    try { const l = await buildVideoListFromDb(); if (l.length) return l; } catch (e) { console.warn('[Feed] database list failed', e); }
    return buildVideoList();
  }

  async function openPlayer() {
    if (!isMobilePlayer()) { launchPlayerWindow(); return; }
    if (starsTabActive) showMainContent();

    // Mobile: show loading screen, build list, then scroll-snap feed
    playerOpen = true;
    activeMobileTab = 'home'; updateMobileNavActive();
    showMobilePlayerLoading();
    playerVideoList = await buildHomeList();
    if (!playerOpen) { hideMobilePlayerView(); return; }
    // If a specific video was requested (e.g. tapped from recents grid), put it first
    if (playerStartId) {
      const si = playerVideoList.findIndex(v => v.id === playerStartId);
      if (si > 0) { const [it] = playerVideoList.splice(si, 1); playerVideoList.unshift(it); }
      playerStartId = null;
    }
    playerColumnOffsets = [0];
    renderMobilePlayerContent();
  }

  // Desktop: open a new pop-out player window without touching the current tab.
  // The list comes from the archive db, so no React tabs need to be clicked.
  async function launchPlayerWindow() {
    let list = [];
    try { list = await buildVideoListFromDb(); } catch (e) { console.warn('[Player] db list failed', e); }
    if (!list.length) list = await buildVideoList();   // fallback: scrapes the tabs
    if (list.length) popoutPlayer(list, 0);
  }

  async function buildVideoListFromDb() {
    const d = await archiveDbPromise();
    const list = [];
    const seen = new Set();
    const add = (ids, dir) => {
      for (const id of ids) {
        const v = d.videos[id];
        if (!v || seen.has(id)) continue;
        seen.add(id);
        const a = d.authors[v.authorId];
        list.push({
          id, authorName: (a && a.uniqueIds && a.uniqueIds[0]) || '', desc: d.videoDescriptions[id] || '',
          videoPath: `data/${dir}/videos/${id}.mp4`, coverSrc: `data/${dir}/covers/${id}.jpg`,
        });
        seen.add(id);
      }
    };
    const dl = new Set((d.likes && d.likes.downloaded) || []);
    add(((d.likes && d.likes.officialList) || []).filter(id => dl.has(id)), 'Likes');
    const bm = new Set((d.bookmarked && d.bookmarked.downloaded) || []);
    add(((d.bookmarked && d.bookmarked.officialList) || []).filter(id => bm.has(id)), 'Favorites');
    return orderHomeList(list);
  }

  function closePlayer() {
    playerOpen = false;
    closeVideoOverlay();
    document.getElementById('player-overlay')?.remove();
    hideMobilePlayerView();
    if (!isMobilePlayer()) document.querySelector('nav .player-tab')?.classList.remove('active');
  }

  // Show #player-view immediately as a fixed loading screen.
  // Does NOT hide <main> — the fixed overlay covers it visually,
  // and keeping <main> in the normal display state lets React re-render
  // freely during buildVideoList tab-switching (avoids mobile page crashes).
  function showMobilePlayerLoading() {
    closePanel();
    if (!playerViewEl) {
      playerViewEl = document.createElement('div');
      playerViewEl.id = 'player-view';
      document.body.appendChild(playerViewEl);
    }
    playerViewEl.innerHTML = '';
    playerViewEl.style.display = 'flex';
    const loading = document.createElement('div');
    loading.id = 'player-view-loading';
    loading.textContent = 'Loading videos…';
    playerViewEl.appendChild(loading);
  }

  function hideMobilePlayerView() {
    if (endFeedVisit) endFeedVisit();
    if (!playerViewEl) return;
    // Pause any playing videos before hiding
    playerViewEl.querySelectorAll('video').forEach(v => v.pause());
    playerViewEl.style.display = 'none';
    playerViewEl.style.zIndex = '';
    playerViewEl.innerHTML = '';
    setPreviewsSuspended(false);
  }

  function renderMobilePlayerContent() {
    if (!playerViewEl) return;
    playerViewEl.innerHTML = '';

    if (!playerVideoList.length) {
      const empty = document.createElement('div');
      empty.id = 'player-view-loading';
      empty.textContent = 'No videos found.';
      playerViewEl.appendChild(empty);
      return;
    }

    renderMobileScrollFeed(playerViewEl);
  }

  // Navigate a single column independently. Rebuilds only that column's content.
  function navigateColumn(colIdx, dir) {
    const next = playerColumnOffsets[colIdx] + dir;
    if (next < 0 || next >= playerVideoList.length) return;
    playerColumnOffsets[colIdx] = next;
    rebuildColumn(colIdx);
    updatePlayerCounter();
  }

  function rebuildColumn(colIdx) {
    const col = document.querySelector(`#player-stage .player-column[data-col="${colIdx}"]`);
    if (!col) return;
    col.querySelector('video')?.pause();
    col.innerHTML = '';
    const idx = playerColumnOffsets[colIdx];
    if (idx >= 0 && idx < playerVideoList.length) {
      col.appendChild(buildPlayerColumn(playerVideoList[idx], colIdx));
    }
  }

  function updatePlayerCounter() {
    const el = document.getElementById('player-counter');
    if (!el) return;
    const total = playerVideoList.length;
    if (!total) return;
    const min = Math.min(...playerColumnOffsets) + 1;
    const max = Math.max(...playerColumnOffsets) + 1;
    el.textContent = min === max ? `${min} / ${total}` : `${min}–${max} / ${total}`;
  }

  function renderPlayerOverlay() {
    document.getElementById('player-overlay')?.remove();
    const cols  = numCols();
    const total = playerVideoList.length;

    // Ensure offsets array matches current column count
    if (playerColumnOffsets.length !== cols) {
      playerColumnOffsets = Array.from({ length: cols }, (_, i) => i);
    }

    const overlay = document.createElement('div');
    overlay.id = 'player-overlay';
    overlay.setAttribute('tabindex', '0');

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.id = 'player-header';

    // Global ← advances all columns back by cols
    const prevBtn = document.createElement('button');
    prevBtn.className = 'player-nav-btn';
    prevBtn.innerHTML = '&#8592;';
    prevBtn.disabled = Math.min(...playerColumnOffsets) < cols;
    prevBtn.addEventListener('click', () => {
      const base = Math.max(0, Math.min(...playerColumnOffsets) - cols);
      playerColumnOffsets = Array.from({ length: cols }, (_, i) => base + i);
      renderPlayerOverlay();
    });

    const titleGroup = document.createElement('div');
    titleGroup.id = 'player-title-group';
    const title = document.createElement('span');
    title.id = 'player-title';
    title.textContent = 'Player';
    const counter = document.createElement('span');
    counter.id = 'player-counter';
    const min = total ? Math.min(...playerColumnOffsets) + 1 : 0;
    const max = total ? Math.max(...playerColumnOffsets) + 1 : 0;
    counter.textContent = !total
      ? (playerBuilding ? 'Loading…' : 'No videos found')
      : (min === max ? `${min} / ${total}` : `${min}–${max} / ${total}`);
    titleGroup.appendChild(title);
    titleGroup.appendChild(counter);

    // Global → advances all columns forward by cols
    const nextBtn = document.createElement('button');
    nextBtn.className = 'player-nav-btn';
    nextBtn.innerHTML = '&#8594;';
    nextBtn.disabled = Math.max(...playerColumnOffsets) + cols >= total;
    nextBtn.addEventListener('click', () => {
      const base = Math.max(...playerColumnOffsets) + 1;
      playerColumnOffsets = Array.from({ length: cols }, (_, i) =>
        Math.min(base + i, total - 1));
      renderPlayerOverlay();
    });

    const rightBtns = document.createElement('div');
    rightBtns.id = 'player-header-right';

    const popoutBtn = document.createElement('button');
    popoutBtn.className = 'player-header-btn';
    popoutBtn.title = 'Pop out into floating window';
    popoutBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M10 14L21 3M9 3H3v18h18v-6"/></svg>';
    popoutBtn.addEventListener('click', popoutPlayer);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'player-header-btn';
    closeBtn.title = 'Close Player';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closePlayer);

    // Hotkey legend (non-interactive)
    const hotkeys = document.createElement('span');
    hotkeys.id = 'player-hotkeys';
    hotkeys.textContent = cols > 1 ? 'Q W E  ↑  A S D  ↓' : 'Q ↑  A ↓';

    rightBtns.appendChild(hotkeys);
    rightBtns.appendChild(popoutBtn);
    rightBtns.appendChild(closeBtn);

    header.appendChild(prevBtn);
    header.appendChild(titleGroup);
    header.appendChild(nextBtn);
    header.appendChild(rightBtns);
    overlay.appendChild(header);

    // ── Stage: desktop = side-by-side columns | mobile = scroll-snap feed ──────
    if (cols > 1) {
      const stage = document.createElement('div');
      stage.id = 'player-stage';
      for (let i = 0; i < cols; i++) {
        const col = document.createElement('div');
        col.className = 'player-column';
        col.dataset.col = i;
        const idx = playerColumnOffsets[i];
        if (idx < total) col.appendChild(buildPlayerColumn(playerVideoList[idx], i));
        else col.classList.add('player-column-empty');
        stage.appendChild(col);
      }
      overlay.appendChild(stage);
    } else {
      renderMobileScrollFeed(overlay);
      // Mobile: swipe on the overlay container (more reliable than per-slide)
      let _otsx = 0, _otsy = 0, _odir = null, _oswiping = false;
      overlay.addEventListener('touchstart', e => {
        _otsx = e.touches[0].clientX; _otsy = e.touches[0].clientY;
        _odir = null; _oswiping = false;
      }, { passive: true });
      overlay.addEventListener('touchmove', e => {
        const dx = e.touches[0].clientX - _otsx;
        const dy = e.touches[0].clientY - _otsy;
        if (!_odir && (Math.abs(dx) > 8 || Math.abs(dy) > 8))
          _odir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (_odir !== 'h') return;
        const tidx = MOBILE_TABS.indexOf(activeMobileTab);
        if ((dx < 0 && tidx >= MOBILE_TABS.length - 1) || (dx > 0 && tidx <= 0)) return;
        _oswiping = true;
        overlay.style.transform = `translateX(${dx * 0.35}px)`;
        showSwipeHint(dx, tidx);
      }, { passive: true });
      overlay.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - _otsx;
        const dy = e.changedTouches[0].clientY - _otsy;
        hideSwipeHint();
        if (!_oswiping) return;
        if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy)) {
          const tidx = MOBILE_TABS.indexOf(activeMobileTab);
          const newTab = dx < 0 ? MOBILE_TABS[tidx + 1] : MOBILE_TABS[tidx - 1];
          if (newTab) { doSwipe(newTab, dx < 0 ? 'left' : 'right', overlay); return; }
        }
        overlay.style.transition = 'transform 0.2s ease';
        overlay.style.transform = '';
        setTimeout(() => { overlay.style.transition = ''; }, 200);
      }, { passive: true });
    }

    document.body.appendChild(overlay);

    // Keyboard navigation (all screen sizes)
    const colKeys = {
      q: [0, -1], w: [1, -1], e: [2, -1],
      a: [0,  1], s: [1,  1], d: [2,  1],
    };
    overlay.addEventListener('keydown', ev => {
      if (ev.key === 'Escape')     { closePlayer(); return; }
      if (ev.key === 'ArrowRight' && !nextBtn.disabled) { nextBtn.click(); return; }
      if (ev.key === 'ArrowLeft'  && !prevBtn.disabled) { prevBtn.click(); return; }
      const mapping = colKeys[ev.key.toLowerCase()];
      if (mapping) {
        const [col, dir] = mapping;
        if (col < cols) navigateColumn(col, dir);
      }
    });

    // Swipe gestures only for desktop columns (mobile uses native scroll-snap)
    if (cols > 1) {
      let _swipeY = 0;
      overlay.addEventListener('touchstart', e => {
        _swipeY = e.touches[0].clientY;
      }, { passive: true });
      overlay.addEventListener('touchend', e => {
        const dy = _swipeY - e.changedTouches[0].clientY;
        if (Math.abs(dy) < 50) return;
        if (dy > 0 && !nextBtn.disabled) nextBtn.click();
        else if (dy < 0 && !prevBtn.disabled) prevBtn.click();
      }, { passive: true });
    }

    overlay.focus();
  }

  // ── Mobile scroll-snap player feed ─────────────────────────────────────────
  function renderMobileScrollFeed(overlay) {
    const counter = overlay.querySelector('#player-counter');
    const total   = playerVideoList.length;

    const feed = document.createElement('div');
    feed.id = 'player-feed';
    overlay.appendChild(feed);

    if (!total) return;

    // Cap rendered slides on mobile to avoid OOM crash from creating hundreds
    // of <video> elements at once. 60 gives ~30 min of content to scroll through.
    const MOBILE_CAP = 60;
    // For long lists (tens of thousands) render a window around the starting video, not the first 60
    const globalStart = Math.max(0, Math.min(playerColumnOffsets[0] || 0, total - 1));
    const winStart = total > MOBILE_CAP ? Math.max(0, Math.min(globalStart - 10, total - MOBILE_CAP)) : 0;
    playerWinStart = winStart;
    const renderList = total > MOBILE_CAP ? playerVideoList.slice(winStart, winStart + MOBILE_CAP) : playerVideoList;
    if (counter && total > MOBILE_CAP) {
      counter.title = `Showing ${renderList.length} of ${total}`;
    }

    // ── Single fixed controls layer (stays put while videos scroll) ──────────
    let currentMuted = true;
    let currentItem  = null;
    let currentVid   = null;

    const ctrlLayer = document.createElement('div');
    ctrlLayer.id = 'player-overlay-controls';

    const rightCenter = document.createElement('div');
    rightCenter.className = 'player-right-center';

    const thumbUpBtn = document.createElement('button');
    thumbUpBtn.className = 'player-ctrl-btn player-thumb-btn player-thumb-up';
    thumbUpBtn.title = 'Add to Liked';
    thumbUpBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
    thumbUpBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!currentItem) return;
      const now = toggleQuickGroup(currentItem.id, 'liked');
      thumbUpBtn.classList.toggle('active', now);
      // Mutually exclusive: remove from disliked if adding to liked
      if (now) {
        const dg = groups.find(x => x.name === 'disliked');
        if (dg) { dg.videoIds = dg.videoIds.filter(id => id !== currentItem.id); saveGroups(); }
        thumbDownBtn.classList.remove('active');
      }
    });

    const thumbDownBtn = document.createElement('button');
    thumbDownBtn.className = 'player-ctrl-btn player-thumb-btn player-thumb-down';
    thumbDownBtn.title = 'Add to Disliked';
    thumbDownBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>';
    thumbDownBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!currentItem) return;
      const now = toggleQuickGroup(currentItem.id, 'disliked');
      thumbDownBtn.classList.toggle('active', now);
      // Mutually exclusive: remove from liked if adding to disliked
      if (now) {
        const lg = groups.find(x => x.name === 'liked');
        if (lg) { lg.videoIds = lg.videoIds.filter(id => id !== currentItem.id); saveGroups(); }
        thumbUpBtn.classList.remove('active');
      }
    });

    const starBtn = document.createElement('button');
    starBtn.className = 'player-ctrl-btn player-star-btn';
    starBtn.innerHTML = '★';
    starBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!currentItem) return;
      toggleStar(currentItem.id, currentItem.coverSrc);
      starBtn.classList.toggle('active', Boolean(stars[currentItem.id]));
      starBtn.title = stars[currentItem.id] ? 'Remove from Stars' : 'Add to Stars';
    });

    const bracesBtn = makeBracesBtn('player-ctrl-btn player-braces-btn', null, 24);

    const lvlBtn = document.createElement('button');
    lvlBtn.className = 'player-ctrl-btn player-lvl-btn';
    lvlBtn.title = 'Set level';
    lvlBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!currentItem) return;
      showLevelPicker(lvlBtn, currentItem.id, newLvl => {
        lvlBtn.textContent = newLvl != null ? String(newLvl) : 'lvl';
        lvlBtn.classList.toggle('active', newLvl != null);
        if (starsTabActive) renderStarsView();
      });
    });

    const groupBtn = document.createElement('button');
    groupBtn.className = 'player-ctrl-btn player-group-btn';
    groupBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
    groupBtn.title = 'Add to group';
    groupBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (!currentItem) return;
      showGroupPicker(groupBtn, currentItem.id);
    });

    const muteBtn = document.createElement('button');
    muteBtn.className = 'player-ctrl-btn player-mute-btn';
    muteBtn.innerHTML = muteIcon(true);
    muteBtn.title = 'Unmute';
    const paintMute = () => {
      muteBtn.innerHTML = muteIcon(currentMuted);
      muteBtn.title = currentMuted ? 'Unmute' : 'Mute';
    };
    muteBtn.addEventListener('click', e => {
      e.stopPropagation();
      currentMuted = !currentMuted;
      if (currentVid) currentVid.muted = currentMuted;
      paintMute();
    });

    rightCenter.appendChild(thumbUpBtn);
    rightCenter.appendChild(thumbDownBtn);
    rightCenter.appendChild(starBtn);
    rightCenter.appendChild(bracesBtn);
    rightCenter.appendChild(lvlBtn);
    rightCenter.appendChild(groupBtn);
    ctrlLayer.appendChild(rightCenter);
    ctrlLayer.appendChild(muteBtn);

    const authorEl  = document.createElement('div');
    authorEl.className = 'player-author';
    ctrlLayer.appendChild(authorEl);

    const captionEl = document.createElement('div');
    captionEl.className = 'player-caption';
    ctrlLayer.appendChild(captionEl);

    // Close/back button — shown when player was launched from another tab (e.g. Stars)
    if (playerReturnTab) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'player-ctrl-btn player-overlay-close';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        closePlayer();
        if (playerReturnTab !== '__author__') setMobileTab(playerReturnTab);
        playerReturnTab = null;
      });
      ctrlLayer.appendChild(closeBtn);
    }

    // Home feed only: switch between the ranked order and a plain shuffle
    if (activeMobileTab === 'home' && !playerReturnTab) {
      const modeBtn = document.createElement('button');
      modeBtn.className = 'player-feed-mode';
      modeBtn.textContent = feedMode() === 'ranked' ? '★ Ranked' : '⤨ Shuffle';
      modeBtn.title = 'Tap to switch between the ranked feed and a plain shuffle';
      modeBtn.addEventListener('click', e => {
        e.stopPropagation();
        try { localStorage.setItem('sp_feed_mode', feedMode() === 'ranked' ? 'shuffle' : 'ranked'); } catch (_) {}
        closePlayer();
        openPlayer();
      });
      ctrlLayer.appendChild(modeBtn);
    }

    overlay.appendChild(ctrlLayer);

    // Thin seek bar along the bottom edge, right above the tab bar; drag it to scrub the playing video
    const seek = document.createElement('div');
    seek.className = 'sp-seek';
    seek.innerHTML = '<div class="sp-seek-track"><div class="sp-seek-fill"></div></div><div class="sp-seek-time"></div>';
    const seekFill = seek.querySelector('.sp-seek-fill');
    const seekTime = seek.querySelector('.sp-seek-time');
    let scrubbing = false;
    const fmtT = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    function paintSeek() {
      const v = currentVid;
      if (!v || !v.duration || !isFinite(v.duration)) { seekFill.style.width = '0%'; return; }
      seekFill.style.width = (Math.min(1, v.currentTime / v.duration) * 100) + '%';
      if (scrubbing) seekTime.textContent = `${fmtT(v.currentTime)} / ${fmtT(v.duration)}`;
    }
    function scrubTo(clientX) {
      const v = currentVid;
      if (!v || !v.duration || !isFinite(v.duration)) return;
      const r = seek.getBoundingClientRect();
      v.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1))) * v.duration;
      paintSeek();
    }
    seek.addEventListener('pointerdown', e => {
      e.stopPropagation();
      scrubbing = true;
      seek.classList.add('scrubbing');
      try { seek.setPointerCapture(e.pointerId); } catch (_) {}
      scrubTo(e.clientX);
    });
    seek.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e.clientX); });
    const endScrub = () => { scrubbing = false; seek.classList.remove('scrubbing'); };
    seek.addEventListener('pointerup', endScrub);
    seek.addEventListener('pointercancel', endScrub);
    ctrlLayer.appendChild(seek);
    (function seekLoop() {
      if (!overlay.isConnected) return;
      paintSeek();
      requestAnimationFrame(seekLoop);
    })();

    // Called by IntersectionObserver each time a new slide becomes dominant
    function updateControls(item, vid) {
      currentItem = item;
      currentVid  = vid;
      vid.muted   = currentMuted;

      thumbUpBtn.classList.toggle('active', inQuickGroup(item.id, 'liked'));
      thumbDownBtn.classList.toggle('active', inQuickGroup(item.id, 'disliked'));

      starBtn.classList.toggle('active', Boolean(stars[item.id]));
      starBtn.title = stars[item.id] ? 'Remove from Stars' : 'Add to Stars';

      bracesBtn.dataset.vid = item.id;
      bracesBtn._refresh();

      lvlBtn.textContent = levels[item.id] != null ? String(levels[item.id]) : 'lvl';
      lvlBtn.classList.toggle('active', levels[item.id] != null);

      const info    = getVideoInfo(item.id);
      const name    = info.authorName || item.authorName || '';
      const caption = info.desc || '';
      if (name) setAuthorLink(authorEl, name); else clearAuthorLink(authorEl);
      captionEl.textContent = caption.length > 120 ? caption.slice(0, 120) + '…' : caption;
    }
    // ── End fixed controls layer ─────────────────────────────────────────────

    const videoEls = [];

    // Start a video and cope with browsers refusing autoplay (common on phones):
    // - sound refused (e.g. after you unmuted, the next video has no tap of its own): play muted instead
    //   and show the muted state on the button
    // - even muted play refused: mark the slide so a tap on it starts the video
    // - a play() cut short by pause()/a new load is normal while scrolling, not a refusal
    function startPlayback(vid) {
      const p = vid.play();
      if (!p || !p.catch) return;
      p.catch(err => {
        if (vid !== currentVid || (err && err.name === 'AbortError')) return;
        if (!vid.muted) {
          currentMuted = true;
          vid.muted = true;
          paintMute();
          startPlayback(vid);
        } else {
          vid.parentElement?.classList.add('needs-tap');
        }
      });
    }

    // Time how long each video is watched (see WATCH LOG): a visit starts when a slide becomes active
    // and ends when another one does, or the feed closes or the page is hidden.
    let visit = null;
    function endVisit() {
      if (!visit) return;
      const v = visit;
      visit = null;
      const dur = v.vid.duration;
      const ms = Math.min(Date.now() - v.t0, dur && isFinite(dur) ? dur * 3000 : 120000);
      if (ms < 400) return;   // flicked past while scrolling: not a view
      watchAdd(v.id, { s: 1, m: Math.round(ms), k: (v.loops === 0 && ms < SKIP_MS) ? 1 : 0, e: v.loops });
    }
    endFeedVisit = endVisit;

    // Make the slide at idx the active one: controls, counter, playback
    function activate(idx) {
      const vid = videoEls[idx];
      if (!vid) return;
      endVisit();
      visit = { id: renderList[idx].id, vid, t0: Date.now(), loops: 0 };
      playerColumnOffsets[0] = winStart + idx;
      updateControls(renderList[idx], vid);
      vid._userPaused = false;
      vid.parentElement?.classList.remove('sp-paused');
      startPlayback(vid);
      if (counter) counter.textContent = `${winStart + idx + 1} / ${total}`;
      // a little head start for the next video
      const next = videoEls[idx + 1];
      if (next && next.preload === 'none') next.preload = 'metadata';
    }

    // Safety net for the observer: once scrolling settles, the slide in view must be the one playing
    let settleTimer = null;
    function syncToView() {
      const h = feed.clientHeight;
      if (!h) return;
      const idx = Math.max(0, Math.min(videoEls.length - 1, Math.round(feed.scrollTop / h)));
      const vid = videoEls[idx];
      if (!vid) return;
      if (currentVid !== vid) {
        videoEls.forEach((v, j) => { if (j !== idx && !v.paused) v.pause(); });
        activate(idx);
      } else if (vid.paused && !vid._userPaused) {
        startPlayback(vid);
      }
    }

    renderList.forEach((item, idx) => {
      const slide = document.createElement('div');
      slide.className = 'player-slide';
      slide.dataset.idx = idx;

      // Video — preload=none so only the playing one downloads
      const video = document.createElement('video');
      video.src = item.videoPath;
      video.preload = 'none';
      video.muted = currentMuted;
      video.playsInline = true;
      video.poster = item.coverSrc;
      video.className = 'player-video';
      video.addEventListener('playing', () => { video.poster = ''; }, { once: true });
      video.addEventListener('playing', () => { slide.classList.remove('needs-tap'); });
      video.addEventListener('loadedmetadata', () => { video.classList.toggle('sp-wide', video.videoWidth > video.videoHeight); });
      video.addEventListener('timeupdate', () => { if (video === currentVid) paintSeek(); });
      video.addEventListener('ended',   () => {
        if (visit && visit.vid === video) visit.loops++;
        video.currentTime = 0; video.play().catch(() => {});
      });
      video.addEventListener('contextmenu', e => { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); });

      let _stx = 0, _sty = 0;
      slide.addEventListener('touchstart', e => { _stx = e.touches[0].clientX; _sty = e.touches[0].clientY; }, { passive: true });
      slide.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - _stx;
        const dy = e.changedTouches[0].clientY - _sty;
        // Tap only — overlay handles horizontal swipe, feed handles vertical scroll
        if (Math.abs(dx) < 15 && Math.abs(dy) < 15) {
          if (video.paused) { video._userPaused = false; slide.classList.remove('sp-paused'); video.play().catch(() => {}); }
          else { video._userPaused = true; slide.classList.add('sp-paused'); video.pause(); }
        }
      }, { passive: true });

      slide.appendChild(video);
      feed.appendChild(slide);
      videoEls.push(video);
    });

    const startIdx = globalStart - winStart;

    // Size each slide to exactly fill the feed container (resolved after layout).
    // scrollIntoView and IO setup are deferred until heights are applied so that
    // the browser can resolve the correct scroll target position.
    const setSlideHeights = () => {
      const h = feed.clientHeight;
      if (h > 0) {
        feed.querySelectorAll('.player-slide').forEach(s => { s.style.height = h + 'px'; });

        // Scroll to starting position NOW that slides have real heights
        if (startIdx > 0 && feed.children[startIdx]) {
          feed.children[startIdx].scrollIntoView({ behavior: 'instant' });
        }

        // IntersectionObserver: play the centered slide, pause everything else.
        // Set up AFTER scrollIntoView so slide 0 doesn't incorrectly fire first.
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            const idx = parseInt(entry.target.dataset.idx);
            const vid = videoEls[idx];
            if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
              activate(idx);
            } else {
              vid.pause();
            }
          });
        }, { threshold: 0.6 });

        feed.querySelectorAll('.player-slide').forEach(s => io.observe(s));

        // Kick off the starting video
        activate(startIdx);

        feed.addEventListener('scroll', () => {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(syncToView, 140);
        }, { passive: true });
      } else {
        requestAnimationFrame(setSlideHeights);
      }
    };
    requestAnimationFrame(setSlideHeights);
  }

  function buildPlayerColumn(item, colIdx) {
    const { id, videoPath, coverSrc, authorName } = item;

    const wrap = document.createElement('div');
    wrap.className = 'player-video-wrap';

    const video = document.createElement('video');
    video.src = videoPath;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.poster = coverSrc;
    video.className = 'player-video';
    video.addEventListener('playing', () => { video.poster = ''; }, { once: true });
    video.addEventListener('ended', () => { video.currentTime = 0; video.play().catch(() => {}); });
    video.addEventListener('contextmenu', e => { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); });
    wrap.appendChild(video);

    const controls = document.createElement('div');
    controls.className = 'player-controls';

    // Center-right: star + add-to-group
    const rightCenter = document.createElement('div');
    rightCenter.className = 'player-right-center';

    const starBtn = document.createElement('button');
    starBtn.className = 'player-ctrl-btn player-star-btn' + (stars[id] ? ' active' : '');
    starBtn.innerHTML = '★';
    starBtn.title = stars[id] ? 'Remove from Stars' : 'Add to Stars';
    starBtn.addEventListener('click', e => {
      e.stopPropagation();
      toggleStar(id, coverSrc);
      starBtn.classList.toggle('active', Boolean(stars[id]));
      starBtn.title = stars[id] ? 'Remove from Stars' : 'Add to Stars';
    });

    const groupBtn = document.createElement('button');
    groupBtn.className = 'player-ctrl-btn player-group-btn';
    groupBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
    groupBtn.title = 'Add to group';
    groupBtn.addEventListener('click', e => { e.stopPropagation(); showGroupPicker(groupBtn, id); });

    rightCenter.appendChild(starBtn);
    rightCenter.appendChild(makeBracesBtn('player-ctrl-btn player-braces-btn', id, 24));
    rightCenter.appendChild(groupBtn);
    controls.appendChild(rightCenter);

    // Bottom-left: author + caption
    {
      const info = getVideoInfo(id);
      const name = info.authorName || authorName || '';
      const caption = info.desc || '';
      if (name) {
        const authDiv = document.createElement('div');
        authDiv.className = 'player-author';
        authDiv.textContent = '@' + name;
        controls.appendChild(authDiv);
      }
      if (caption) {
        const capDiv = document.createElement('div');
        capDiv.className = 'player-caption';
        capDiv.textContent = caption.length > 120 ? caption.slice(0, 120) + '…' : caption;
        controls.appendChild(capDiv);
      }
    }

    // Bottom-center: per-column ↑ ↓ navigation
    const colNav = document.createElement('div');
    colNav.className = 'player-col-nav';

    const upBtn = document.createElement('button');
    upBtn.className = 'player-ctrl-btn player-col-nav-btn';
    upBtn.innerHTML = '&#8679;';
    upBtn.title = 'Previous video (col ' + (colIdx + 1) + ')';
    upBtn.disabled = playerColumnOffsets[colIdx] <= 0;
    upBtn.addEventListener('click', e => { e.stopPropagation(); navigateColumn(colIdx, -1); });

    const downBtn = document.createElement('button');
    downBtn.className = 'player-ctrl-btn player-col-nav-btn';
    downBtn.innerHTML = '&#8681;';
    downBtn.title = 'Next video (col ' + (colIdx + 1) + ')';
    downBtn.disabled = playerColumnOffsets[colIdx] >= playerVideoList.length - 1;
    downBtn.addEventListener('click', e => { e.stopPropagation(); navigateColumn(colIdx, 1); });

    colNav.appendChild(upBtn);
    colNav.appendChild(downBtn);
    controls.appendChild(colNav);

    // Bottom-right: mute toggle
    let muted = true;
    const muteBtn = document.createElement('button');
    muteBtn.className = 'player-ctrl-btn player-mute-btn';
    muteBtn.innerHTML = muteIcon(true);
    muteBtn.title = 'Unmute';
    muteBtn.addEventListener('click', e => {
      e.stopPropagation();
      muted = !muted;
      video.muted = muted;
      muteBtn.innerHTML = muteIcon(muted);
      muteBtn.title = muted ? 'Unmute' : 'Mute';
    });
    controls.appendChild(muteBtn);

    wrap.appendChild(controls);
    return wrap;
  }

  function muteIcon(muted) {
    return muted
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAYER — POP-OUT WINDOW
  // ═══════════════════════════════════════════════════════════════════════════

  function popoutPlayer(startList, startIdx) {
    const win = window.open(
      'about:blank', '',   // empty name = new window every time
      'width=360,height=640,resizable=yes,menubar=no,toolbar=no,location=no,status=no'
    );
    if (!win) { alert('Pop-out was blocked. Please allow pop-ups for this file and try again.'); return; }

    const safeJson  = obj => JSON.stringify(obj).replace(/<\/script>/gi, '<\\/script>');
    const vidList   = startList != null ? startList : playerVideoList;
    const vidOffset = startIdx  != null ? startIdx  : (playerColumnOffsets[0] || 0);
    // Snapshot current in-memory state so pop-out starts with fresh data
    const initStars  = safeJson(stars);
    const initGroups = safeJson(groups);
    const initLevels = safeJson(levels);
    const apiOrigin  = location.origin;

    win.document.write(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>myfaveTT</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:#000;color:#ddd;font-family:system-ui,sans-serif;position:relative}
video{width:100%;height:100%;object-fit:contain;display:block}
.ctl{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .2s}
body:hover .ctl,.ctl.pinned{opacity:1}
.close{position:absolute;top:10px;right:10px;background:rgba(0,0,0,.5);border:none;border-radius:50%;color:#fff;width:32px;height:32px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;pointer-events:auto}
.close:hover{background:rgba(0,0,0,.85)}
.rc{position:absolute;right:10px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:10px;pointer-events:auto;align-items:center}
.b{background:rgba(0,0,0,.5);border:none;border-radius:50%;color:#ddd;width:40px;height:40px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;pointer-events:auto;flex-shrink:0}
.b:hover{background:rgba(0,0,0,.85)}
.b.on{color:gold}
.bbr.on{color:#4fc3f7}
.blvl{font-size:12px;font-weight:700;letter-spacing:-.5px}
.bgrp svg{pointer-events:none}
.scrim{position:absolute;bottom:0;left:0;right:0;height:180px;background:linear-gradient(transparent,rgba(0,0,0,.8));pointer-events:none}
.meta{position:absolute;bottom:12px;left:12px;max-width:calc(100% - 70px);pointer-events:none}
.au{font-size:13px;font-weight:600;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.9);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.au.lnk{display:inline-block;max-width:100%;vertical-align:top;pointer-events:auto;cursor:pointer}
.au.lnk:hover{text-decoration:underline}
.cap{font-size:11px;color:rgba(255,255,255,.85);text-shadow:0 1px 3px rgba(0,0,0,.8);line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mu{position:absolute;bottom:10px;right:10px;pointer-events:auto}
.ct{position:absolute;top:10px;left:50%;transform:translateX(-50%);font-size:11px;color:rgba(255,255,255,.35);pointer-events:none;white-space:nowrap}
.nav{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:8px;pointer-events:auto}
.navbtn{background:rgba(0,0,0,.5);border:none;border-radius:50%;color:#ddd;width:36px;height:36px;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
.navbtn:hover{background:rgba(0,0,0,.85)}
.navbtn:disabled{opacity:.25;cursor:default}
.picker{position:fixed;z-index:9999;background:#252525;border:1px solid #555;border-radius:8px;padding:8px;box-shadow:0 4px 20px rgba(0,0,0,.8)}
.lpicker{display:flex;flex-direction:column;gap:3px}
.lpbtn{background:#1e1e1e;border:1px solid #3a3a3a;border-radius:4px;color:#bbb;font-size:13px;font-weight:600;padding:5px 20px;cursor:pointer;text-align:center;white-space:nowrap}
.lpbtn:hover{background:#2a2a2a;color:#fff}
.lpbtn.cur{background:#fe2c55;border-color:#fe2c55;color:#fff}
.gpicker{display:flex;flex-direction:column;min-width:170px;max-height:320px}
.gplst{overflow-y:auto;max-height:220px;display:flex;flex-direction:column;gap:1px;padding:4px 0}
.gpempty{padding:8px 12px;font-size:12px;color:#555}
.gprow{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:13px;cursor:pointer;color:#ccc;white-space:nowrap;border-radius:4px}
.gprow:hover{background:#333}
.gpname{flex:1;overflow:hidden;text-overflow:ellipsis}
.gpcnt{font-size:11px;color:#666;flex-shrink:0}
.gpnew{border-top:1px solid #333;padding:6px 8px}
.gpaddbt{background:none;border:none;color:#888;font-size:12px;cursor:pointer;padding:2px 4px;width:100%;text-align:left}
.gpaddbt:hover{color:#ccc}
.gpinf{display:flex;gap:4px;align-items:center}
.gpinf input{flex:1;background:#1a1a1a;border:1px solid #444;border-radius:4px;color:#ccc;font-size:12px;padding:4px 6px;outline:none}
.gpok{background:#333;border:none;border-radius:4px;color:#aaa;cursor:pointer;font-size:13px;padding:3px 7px}
.gpok:hover{background:#444;color:#fff}
</style></head><body>
<video id="v" muted autoplay playsinline></video>
<div class="ctl" id="c">
  <div class="scrim"></div>
  <button class="close" id="x">✕</button>
  <div class="rc" id="rc"></div>
  <div class="meta"><div class="au" id="au"></div><div class="cap" id="cp"></div></div>
  <div class="ct" id="ct"></div>
  <div class="nav" id="nv">
    <button class="navbtn" id="nb" title="Previous">&#8679;</button>
    <button class="navbtn" id="pb" title="Next">&#8681;</button>
  </div>
  <button class="b mu" id="mb"></button>
</div>
<script>
const API='${apiOrigin}/api/stars';
const BR='${BRACES_SVG(20)}';
let vids=${safeJson(vidList)};
let idx=${vidOffset};
let muted=true;

// Start with a snapshot of the main window's current in-memory state
let starsData=${initStars};
let groupsData=${initGroups};
let levelsData=${initLevels};

function ls(){return starsData;}
function lg(){return groupsData;}
function ll(){return levelsData;}

let _bc=null;
try{_bc=new BroadcastChannel('myfaveTT_popout');}catch(_){}

function syncAll(s,g,l){
  // Broadcast to main window (BroadcastChannel — most reliable cross-window path)
  if(_bc) _bc.postMessage({s,g,l});
  // Also hit the server directly as a safety net
  fetch(API,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({stars:s,groups:g,levels:l})}).catch(()=>{});
}
function openAuthor(name){
  if(_bc) _bc.postMessage({openAuthor:name});
  try{ if(window.opener&&!window.opener.closed) window.opener.focus(); }catch(_){}
}
function ss(s){starsData=s;syncAll(s,groupsData,levelsData);}
function sg(g){groupsData=g;syncAll(starsData,g,levelsData);}
function sl(l){levelsData=l;syncAll(starsData,groupsData,l);}

function mi(m){
  return m
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
}

function closePicker(){document.querySelectorAll('.picker').forEach(p=>p.remove());document.getElementById('c').classList.remove('pinned');}

function positionLeft(el, anchorRect){
  document.body.appendChild(el);
  const ew=el.offsetWidth||160, eh=el.offsetHeight||200;
  el.style.top=Math.max(4,Math.min(anchorRect.top+anchorRect.height/2-eh/2,window.innerHeight-eh-4))+'px';
  el.style.left=Math.max(4,anchorRect.left-ew-8)+'px';
}

function showLvlPicker(btn,id){
  closePicker();
  document.getElementById('c').classList.add('pinned');
  const cur=(ll()[id]??null);
  const p=document.createElement('div');
  p.className='picker lpicker';
  for(let n=10;n<=23;n++){
    const b=document.createElement('button');
    b.className='lpbtn'+(cur===n?' cur':'');
    b.textContent=n;
    b.addEventListener('click',()=>{
      const lv=ll();
      if(cur===n){delete lv[id];}else{lv[id]=n;}
      sl(lv);
      const newCur=lv[id]??null;
      btn.textContent=newCur!=null?String(newCur):'lvl';
      closePicker();
    });
    p.appendChild(b);
  }
  positionLeft(p,btn.getBoundingClientRect());
  setTimeout(()=>{document.addEventListener('click',function h(e){if(!p.contains(e.target)){closePicker();document.removeEventListener('click',h);}});},0);
}

function showGrpPicker(btn,id){
  closePicker();
  document.getElementById('c').classList.add('pinned');
  const p=document.createElement('div');
  p.className='picker gpicker';

  const lst=document.createElement('div'); lst.className='gplst'; p.appendChild(lst);
  const buildRows=()=>{
    lst.innerHTML='';
    const sorted=[...lg()].sort((a,b)=>b.videoIds.length-a.videoIds.length);
    if(!sorted.length){const e=document.createElement('div');e.className='gpempty';e.textContent='No groups yet';lst.appendChild(e);return;}
    sorted.forEach(g=>{
      const row=document.createElement('label'); row.className='gprow';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=g.videoIds.includes(id);
      cb.addEventListener('change',()=>{
        const gs=lg(); const gi=gs.find(x=>x.id===g.id);
        if(gi){if(cb.checked){if(!gi.videoIds.includes(id))gi.videoIds.push(id);}else gi.videoIds=gi.videoIds.filter(x=>x!==id); sg(gs);}
        buildRows();
      });
      const ns=document.createElement('span'); ns.className='gpname'; ns.textContent=g.name;
      const cs=document.createElement('span'); cs.className='gpcnt'; cs.textContent=g.videoIds.length;
      row.appendChild(cb); row.appendChild(ns); row.appendChild(cs); lst.appendChild(row);
    });
  };
  buildRows();

  const nr=document.createElement('div'); nr.className='gpnew'; p.appendChild(nr);
  const ab=document.createElement('button'); ab.className='gpaddbt'; ab.textContent='＋ New group';
  const inf=document.createElement('div'); inf.className='gpinf'; inf.style.display='none';
  const fi=document.createElement('input'); fi.type='text'; fi.placeholder='Group name'; fi.maxLength=40;
  const ok=document.createElement('button'); ok.textContent='✓'; ok.className='gpok';
  const commit=()=>{
    const name=fi.value.trim();
    if(name){
      const gs=lg();
      gs.push({id:(Math.random().toString(36).slice(2)),name,videoIds:[id]});
      sg(gs); buildRows();
    }
    fi.value=''; inf.style.display='none'; ab.style.display='';
  };
  ok.addEventListener('click',commit);
  fi.addEventListener('keydown',e=>{if(e.key==='Enter')commit(); e.stopPropagation();});
  ab.addEventListener('click',e=>{e.stopPropagation();ab.style.display='none';inf.style.display='flex';fi.focus();});
  inf.appendChild(fi); inf.appendChild(ok); nr.appendChild(ab); nr.appendChild(inf);

  positionLeft(p,btn.getBoundingClientRect());
  setTimeout(()=>{document.addEventListener('click',function h(e){if(!p.contains(e.target)){closePicker();document.removeEventListener('click',h);}});},0);
}

function render(){
  closePicker();
  v.pause();
  const item=vids[idx]; if(!item)return;
  v.poster=item.coverSrc; v.src=item.videoPath; v.muted=muted;
  v.play().catch(()=>{});
  v.onended=()=>{v.currentTime=0;v.play().catch(()=>{});};

  const rc=document.getElementById('rc'); rc.innerHTML='';

  // ★ Star
  const sb=document.createElement('button');
  sb.className='b'+(ls()[item.id]?' on':''); sb.innerHTML='★'; sb.title='Star';
  sb.addEventListener('click',()=>{
    const s=ls();
    if(s[item.id])delete s[item.id];
    else s[item.id]={id:item.id,coverSrc:item.coverSrc,authorName:item.authorName||'',desc:item.desc||''};
    ss(s); sb.classList.toggle('on',Boolean(ls()[item.id]));
  });
  rc.appendChild(sb);

  // braces tag (toggles the shared "braces" group)
  const bb=document.createElement('button');
  bb.className='b bbr'; bb.innerHTML=BR;
  const bracesOf=gs=>gs.find(x=>String(x.name).trim().toLowerCase()==='braces');
  const inBr=()=>{const g=bracesOf(lg());return !!(g&&g.videoIds.includes(item.id));};
  const paintBr=()=>{const on=inBr();bb.classList.toggle('on',on);bb.title=on?'Remove from braces':'Add to braces';};
  paintBr();
  bb.addEventListener('click',e=>{
    e.stopPropagation();
    const gs=lg(); let g=bracesOf(gs);
    if(!g){g={id:Math.random().toString(36).slice(2),name:'braces',videoIds:[]};gs.push(g);}
    const i=g.videoIds.indexOf(item.id);
    if(i<0)g.videoIds.push(item.id); else g.videoIds.splice(i,1);
    sg(gs); paintBr();
  });
  rc.appendChild(bb);

  // lvl
  const lb=document.createElement('button');
  const curL=ll()[item.id]??null;
  lb.className='b blvl'; lb.textContent=curL!=null?String(curL):'lvl'; lb.title='Set level';
  lb.addEventListener('click',e=>{e.stopPropagation();showLvlPicker(lb,item.id);});
  rc.appendChild(lb);

  // ⊕ Group
  const gb=document.createElement('button');
  gb.className='b bgrp';
  gb.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  gb.title='Add to group';
  gb.addEventListener('click',e=>{e.stopPropagation();showGrpPicker(gb,item.id);});
  rc.appendChild(gb);

  const au=document.getElementById('au');
  au.textContent=item.authorName?'@'+item.authorName:'';
  au.classList.toggle('lnk',Boolean(item.authorName));
  au.title=item.authorName?'All videos by @'+item.authorName:'';
  au.onclick=item.authorName?function(e){e.stopPropagation();openAuthor(item.authorName);}:null;
  document.getElementById('cp').textContent=item.desc||'';
  document.getElementById('ct').textContent=vids.length>1?(idx+1)+' / '+vids.length:'';
  document.getElementById('mb').innerHTML=mi(muted);
  document.getElementById('nb').disabled=idx<=0;
  document.getElementById('pb').disabled=idx>=vids.length-1;
  document.getElementById('nv').style.display=vids.length>1?'flex':'none';
}

const v=document.getElementById('v');
v.addEventListener('contextmenu',e=>{e.preventDefault();v.paused?v.play().catch(()=>{}):v.pause();});
document.getElementById('x').addEventListener('click',()=>window.close());
document.getElementById('mb').addEventListener('click',()=>{
  muted=!muted; v.muted=muted; document.getElementById('mb').innerHTML=mi(muted);
});
document.getElementById('nb').addEventListener('click',()=>{if(idx>0){idx--;render();}});
document.getElementById('pb').addEventListener('click',()=>{if(idx<vids.length-1){idx++;render();}});
document.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowRight'){if(idx<vids.length-1){idx++;render();}}
  else if(e.key==='ArrowUp'||e.key==='ArrowLeft'){if(idx>0){idx--;render();}}
  else if(e.key==='Escape'){if(document.querySelector('.picker'))closePicker();else window.close();}
});
let sy=0;
document.addEventListener('touchstart',e=>{sy=e.touches[0].clientY;},{passive:true});
document.addEventListener('touchend',e=>{
  const dy=sy-e.changedTouches[0].clientY;
  if(Math.abs(dy)<50){v.paused?v.play().catch(()=>{}):v.pause();return;}
  if(dy>0&&idx<vids.length-1){idx++;render();}
  else if(dy<0&&idx>0){idx--;render();}
},{passive:true});
render();
<\/script></body></html>`);
    win.document.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NAV INJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTHOR TABS — click a username to see all of that author's videos
  // ═══════════════════════════════════════════════════════════════════════════

  let authorViewEl   = null;
  let activeAuthorId = null;
  const openAuthors  = [];   // { id, name }, in nav-tab order

  function setAuthorLink(el, name) {
    el.textContent = '@' + name;
    el.classList.add('sp-author-link');
    el.title = 'All videos by @' + name;
    el.onclick = e => { e.stopPropagation(); openAuthorByName(name); };
  }

  function clearAuthorLink(el) {
    el.textContent = '';
    el.classList.remove('sp-author-link');
    el.onclick = null;
  }

  function openAuthorByName(name, after) {
    if (!_dbCache) {
      archiveDbPromise().then(() => openAuthorByName(name, after)).catch(() => {});
      return;
    }
    const id = authorIdForName(name);
    if (id) { showAuthorTab(id, name); if (after) after(); }
  }

  function authorViewOpen() {
    return Boolean(activeAuthorId && authorViewEl && authorViewEl.style.display !== 'none');
  }

  // ── Where did focus come from? ────────────────────────────────────────────
  // Each username tab remembers the view that was showing the last time it was focused, so closing
  // it returns there (browser-style) instead of always landing on the same tab.
  const authorReturn = new Map();   // author id -> { kind, id? }

  function currentViewDescriptor() {
    if (activeAuthorId) return { kind: 'author', id: activeAuthorId };
    if (autotagTabActive) return { kind: 'autotag' };
    if (logTabActive) return { kind: 'log' };
    if (starsTabActive) return { kind: 'stars' };
    return { kind: 'react' };   // the app's own pages (Likes, Favorites, Following, Explain)
  }

  // Where to go when username tab `id` closes: its remembered view, skipping username tabs that are
  // gone themselves (follow where those came from); Stars if nothing usable is left.
  function resolveReturn(id) {
    let d = authorReturn.get(id);
    for (let hops = 0; d && d.kind === 'author' && hops < 10; hops++) {
      if (d.id !== id && openAuthors.some(a => a.id === d.id)) return d;
      d = authorReturn.get(d.id);
    }
    return d && d.kind !== 'author' ? d : { kind: 'stars' };
  }

  function restoreView(d) {
    if (isMobilePlayer()) return;
    switch (d && d.kind) {
      case 'author': {
        const a = openAuthors.find(x => x.id === d.id);
        if (a) { showAuthorTab(a.id, a.name, true); return; }
        break;
      }
      case 'autotag': showAutotagTab(); return;
      case 'log':     showLogTab();     return;
      case 'react':   showMainContent(); return;   // the app keeps its own tab selected underneath
    }
    showStarsTab();
  }

  function showAuthorTab(id, name, keepReturn) {
    if (!keepReturn) {
      const from = currentViewDescriptor();
      if (!(from.kind === 'author' && from.id === id)) authorReturn.set(id, from);
    }
    if (autotagTabActive) hideAutotagView();
    if (logTabActive) hideLogView();
    if (!openAuthors.some(a => a.id === id)) openAuthors.push({ id, name });
    activeAuthorId = id;
    closeVideoOverlay();
    closePanel();
    document.body.classList.add('sp-author-open');

    const main = document.querySelector('main');
    if (isMobilePlayer()) {
      // Mobile: the view overlays whatever is underneath. A player launched from an
      // author view sits above it, so close that one; otherwise just silence the feed.
      if (playerReturnTab === '__author__') { closePlayer(); playerReturnTab = null; }
      if (endFeedVisit) endFeedVisit();
      document.querySelectorAll('#player-view video').forEach(v => v.pause());
    } else {
      if (starsTabActive) {
        starsTabActive = false;
        if (starsViewEl) { releaseGridPreviews(starsViewEl); starsViewEl.style.display = 'none'; }
        document.querySelector('nav .stars-tab')?.classList.remove('active');
      }
      main?.style.setProperty('display', 'none');
      toggleBtn.style.display = 'none';
    }

    if (!authorViewEl) {
      authorViewEl = document.createElement('div');
      authorViewEl.id = 'author-view';
      if (main) main.parentNode.insertBefore(authorViewEl, main);
      else document.body.appendChild(authorViewEl);
    }
    authorViewEl.style.display = 'flex';
    renderAuthorView();
    syncAuthorTabs();
    autosaveSession();
  }

  function hideAuthorView(resumePlayback = true) {
    releaseGridPreviews(authorViewEl);
    activeAuthorId = null;
    if (authorViewEl) authorViewEl.style.display = 'none';
    document.body.classList.remove('sp-author-open');
    syncAuthorTabs();
    if (resumePlayback && isMobilePlayer() && playerOpen && playerViewEl && playerViewEl.style.display !== 'none') {
      playerViewEl.querySelectorAll('video')[(playerColumnOffsets[0] || 0) - playerWinStart]?.play().catch(() => {});
    }
  }

  function closeAuthorTab(id) {
    const i = openAuthors.findIndex(a => a.id === id);
    if (i >= 0) openAuthors.splice(i, 1);
    if (activeAuthorId === id) {
      const back = resolveReturn(id);
      hideAuthorView();
      // Closing the tab you were on returns to the one you came from (on a phone the view just closes)
      restoreView(back);
    }
    syncAuthorTabs();
    autosaveSession();
  }

  function renderAuthorView() {
    if (!authorViewEl || !activeAuthorId) return;
    const author = openAuthors.find(a => a.id === activeAuthorId);
    const videos = sortVideos(authorVideos(activeAuthorId), 'author');
    releaseGridPreviews(authorViewEl);
    authorViewEl.innerHTML = '';

    const grid = document.createElement('div');
    grid.id = 'author-grid';
    grid.classList.add('preview-grid');

    const header = document.createElement('div');
    header.id = 'author-view-header';
    const title = document.createElement('span');
    title.className = 'stars-main-title';
    title.textContent = '@' + author.name;
    const count = document.createElement('span');
    count.className = 'stars-main-count';
    count.textContent = `${videos.length} video${videos.length !== 1 ? 's' : ''}`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'author-view-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => closeAuthorTab(activeAuthorId));
    header.append(title, count, buildGridControls('author', grid, authorViewEl), closeBtn);
    authorViewEl.appendChild(header);

    if (!videos.length) {
      const empty = document.createElement('div');
      empty.className = 'author-empty';
      empty.textContent = 'No downloaded videos found for this author.';
      grid.appendChild(empty);
    }
    fillGrid(grid, videos, (v, idx) => buildAuthorCard(v, idx, videos));
    authorViewEl.appendChild(grid);
    observeGridPreviews(grid);
  }

  function buildAuthorCard(v, idx, list) {
    const card = document.createElement('div');
    card.className = 'stars-grid-card';

    const cover = document.createElement('div');
    cover.className = 'stars-grid-cover';
    attachPreview(cover, v.videoPath);
    cover.addEventListener('click', () => openVideoOverlay(idx, list));
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = v.coverSrc;
    img.onerror = () => { img.style.display = 'none'; };
    cover.appendChild(img);

    cover.appendChild(buildThumbTools(v.id, v.coverSrc, v.authorName, v.desc));
    card.appendChild(cover);

    if (v.desc) {
      const d = document.createElement('div');
      d.className = 'stars-grid-desc';
      d.textContent = v.desc.length > 80 ? v.desc.slice(0, 80) + '…' : v.desc;
      card.appendChild(d);
    }
    return card;
  }

  // Keep the nav's author tabs in sync with openAuthors (React may rebuild the nav)
  function syncAuthorTabs() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    nav.querySelectorAll('.author-tab').forEach(t => {
      if (!openAuthors.some(a => a.id === t.dataset.id)) t.remove();
    });
    openAuthors.forEach(a => {
      let tab = nav.querySelector(`.author-tab[data-id="${a.id}"]`);
      if (!tab) {
        tab = document.createElement('div');
        tab.className = 'author-tab pressable';
        tab.dataset.id = a.id;
        tab.title = '@' + a.name + ' — double-click to open the profile';
        const label = document.createElement('span');
        label.className = 'author-tab-label';
        label.textContent = '@' + a.name;
        const x = document.createElement('span');
        x.className = 'author-tab-close';
        x.textContent = '✕';
        x.title = 'Close tab';
        x.addEventListener('click', e => { e.stopPropagation(); closeAuthorTab(a.id); });
        tab.append(label, x);
        tab.addEventListener('click', () => { if (activeAuthorId !== a.id) showAuthorTab(a.id, a.name); });
        tab.addEventListener('dblclick', e => {
          if (e.target.closest('.author-tab-close')) return;
          window.open('https://www.tiktok.com/@' + encodeURIComponent(a.name), '_blank', 'noopener');
        });
        const last = [...nav.querySelectorAll('.author-tab')].pop()
          || nav.querySelector('.player-tab') || nav.querySelector('.stars-tab');
        last?.insertAdjacentElement('afterend', tab);
      }
      tab.classList.toggle('active', a.id === activeAuthorId);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB SESSIONS — open username tabs are autosaved and can be restored later
  // ═══════════════════════════════════════════════════════════════════════════

  let tabSessions       = [];    // { id, name, createdAt, updatedAt, tabs: [{id, name}], activeId }
  let currentSessionId  = null;  // the session open tabs are autosaved into
  let sessionsMenuEl    = null;
  let _sessionSyncTimer = null;

  function saveSessions() {
    try { localStorage.setItem('sp_sessions', JSON.stringify(tabSessions)); } catch (_) {}
    clearTimeout(_sessionSyncTimer);
    _sessionSyncTimer = setTimeout(() => {
      fetch('/api/sessions', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: tabSessions }),
      }).catch(() => { /* no server — localStorage is fine */ });
    }, 400);
  }

  (() => {
    try { tabSessions = JSON.parse(localStorage.getItem('sp_sessions') || '[]'); } catch (_) {}
    if (!Array.isArray(tabSessions)) tabSessions = [];
    fetch('/api/sessions').then(r => r.ok ? r.json() : null).then(d => {
      if (!d || !Array.isArray(d.sessions)) return;
      if (d.sessions.length || !tabSessions.length) {
        const cur = tabSessions.find(x => x.id === currentSessionId);
        tabSessions = d.sessions;
        if (cur && !tabSessions.some(x => x.id === cur.id)) tabSessions.unshift(cur);
        try { localStorage.setItem('sp_sessions', JSON.stringify(tabSessions)); } catch (_) {}
      } else {
        saveSessions();   // first run against a server: push what is stored locally
      }
      renderSessionsMenu();
    }).catch(() => { /* no server */ });
  })();

  function sessionLabel(s) {
    return s.name || s.tabs.map(t => '@' + t.name).join(', ');
  }

  // Called whenever the set of open username tabs changes
  function autosaveSession() {
    if (!openAuthors.length) { currentSessionId = null; return; }  // the last non-empty state stays saved
    let s = tabSessions.find(x => x.id === currentSessionId);
    if (!s) {
      s = { id: uid(), name: '', createdAt: Date.now(), tabs: [], activeId: null };
      tabSessions.unshift(s);
      currentSessionId = s.id;
    }
    s.tabs = openAuthors.map(a => ({ id: a.id, name: a.name }));
    s.activeId = activeAuthorId;
    s.updatedAt = Date.now();
    saveSessions();
    renderSessionsMenu();
  }

  function restoreSession(id) {
    const s = tabSessions.find(x => x.id === id);
    if (!s || !s.tabs.length) return;
    closeSessionsMenu();
    // The author data must be loaded before a view can be rendered
    archiveDbPromise().then(() => {
      openAuthors.length = 0;
      s.tabs.forEach(t => openAuthors.push({ id: t.id, name: t.name }));
      currentSessionId = s.id;
      const target = s.tabs.find(t => t.id === s.activeId) || s.tabs[s.tabs.length - 1];
      syncAuthorTabs();
      showAuthorTab(target.id, target.name);
    }).catch(() => {});
  }

  function startNewSession() {
    openAuthors.length = 0;
    currentSessionId = null;
    if (activeAuthorId) {
      const back = resolveReturn(activeAuthorId);
      hideAuthorView();
      restoreView(back);
    }
    syncAuthorTabs();
    closeSessionsMenu();
  }

  function renameSession(id) {
    const s = tabSessions.find(x => x.id === id);
    if (!s) return;
    const name = prompt('Session name (leave empty to use the usernames)', s.name || '');
    if (name === null) return;
    s.name = name.trim();
    saveSessions();
    renderSessionsMenu();
  }

  function deleteSession(id) {
    const s = tabSessions.find(x => x.id === id);
    if (!s || !confirm(`Delete session "${sessionLabel(s)}"?`)) return;
    tabSessions = tabSessions.filter(x => x.id !== id);
    if (currentSessionId === id) currentSessionId = null;
    saveSessions();
    renderSessionsMenu();
  }

  function renderSessionsMenu() {
    if (!sessionsMenuEl) return;
    sessionsMenuEl.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'sessions-head';
    const title = document.createElement('span');
    title.textContent = 'Tab sessions';
    const newBtn = document.createElement('button');
    newBtn.className = 'sessions-new';
    newBtn.textContent = '+ New';
    newBtn.title = 'Close all username tabs and start a new session';
    newBtn.addEventListener('click', startNewSession);
    head.append(title, newBtn);
    sessionsMenuEl.appendChild(head);

    const list = document.createElement('div');
    list.className = 'sessions-list';
    const sorted = [...tabSessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'sessions-empty';
      empty.textContent = 'No sessions yet. Open a username tab and it is saved here automatically.';
      list.appendChild(empty);
    }
    sorted.forEach(s => {
      const isCurrent = s.id === currentSessionId;
      const row = document.createElement('div');
      row.className = 'sessions-row' + (isCurrent ? ' current' : '');
      row.title = s.tabs.map(t => '@' + t.name).join('\n');
      row.addEventListener('click', () => restoreSession(s.id));

      const info = document.createElement('div');
      info.className = 'sessions-info';
      const label = document.createElement('div');
      label.className = 'sessions-label';
      label.textContent = sessionLabel(s);
      const when = new Date(s.updatedAt || s.createdAt || Date.now())
        .toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const meta = document.createElement('div');
      meta.className = 'sessions-meta';
      meta.textContent = `${s.tabs.length} tab${s.tabs.length !== 1 ? 's' : ''} · ${when}${isCurrent ? ' · open now' : ''}`;
      info.append(label, meta);

      const mk = (text, title, fn) => {
        const b = document.createElement('button');
        b.className = 'sessions-act';
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        return b;
      };
      row.append(info, mk('✎', 'Rename', () => renameSession(s.id)), mk('✕', 'Delete', () => deleteSession(s.id)));
      list.appendChild(row);
    });
    sessionsMenuEl.appendChild(list);
  }

  const sessionsOutside = e => {
    if (sessionsMenuEl && !sessionsMenuEl.contains(e.target) && !e.target.closest('.session-tab')) closeSessionsMenu();
  };
  const sessionsEscape = e => { if (e.key === 'Escape') closeSessionsMenu(); };

  function closeSessionsMenu() {
    if (!sessionsMenuEl) return;
    sessionsMenuEl.remove();
    sessionsMenuEl = null;
    document.removeEventListener('mousedown', sessionsOutside, true);
    document.removeEventListener('keydown', sessionsEscape, true);
    document.querySelector('nav .session-tab')?.classList.remove('menu-open');
  }

  function toggleSessionsMenu() {
    if (sessionsMenuEl) { closeSessionsMenu(); return; }
    const btn = document.querySelector('nav .session-tab');
    if (!btn) return;
    sessionsMenuEl = document.createElement('div');
    sessionsMenuEl.id = 'sessions-menu';
    document.body.appendChild(sessionsMenuEl);
    renderSessionsMenu();
    const r = btn.getBoundingClientRect();
    sessionsMenuEl.style.top = (r.bottom + 6) + 'px';
    sessionsMenuEl.style.right = Math.max(8, window.innerWidth - r.right - 4) + 'px';
    btn.classList.add('menu-open');
    document.addEventListener('mousedown', sessionsOutside, true);
    document.addEventListener('keydown', sessionsEscape, true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE LOG — ttpull's log, polled through the Starplayer server (/api/ttpull/logs)
  // ═══════════════════════════════════════════════════════════════════════════

  let logTabActive  = false;
  let logViewEl     = null;
  let logBodyEl     = null;
  let logStatusEl   = null;
  let logPaused     = false;
  let logFollow     = true;
  let logFilter     = '';
  let logLastRaw    = null;     // last real line seen, used to find where new lines start
  let logTimer      = null;
  let logPollGen    = 0;
  const logEntries  = [];       // { raw, time, level, msg, marker }
  const logLevels   = { info: true, warn: true, error: true };
  const LOG_KEEP    = 2000;

  function parseLogLine(raw) {
    const m = /^\[([^\]]+)\] \[(\w+)\] ([\s\S]*)$/.exec(raw);
    if (!m) return { raw, time: '', level: 'info', msg: raw };
    const d = new Date(m[1]);
    const time = isNaN(d) ? m[1] : d.toLocaleTimeString([], { hour12: false });
    return { raw, time, level: (m[2] === 'warn' || m[2] === 'error') ? m[2] : 'info', msg: m[3] };
  }

  function logEntryVisible(e) {
    if (e.marker) return true;
    if (!logLevels[e.level]) return false;
    return !logFilter || e.msg.toLowerCase().includes(logFilter);
  }

  function logLineEl(e) {
    const row = document.createElement('div');
    if (e.marker) {
      row.className = 'log-line log-marker';
      row.textContent = e.msg;
      return row;
    }
    row.className = 'log-line lvl-' + e.level;
    const ts = document.createElement('span');
    ts.className = 'log-ts';
    ts.textContent = e.time;
    const msg = document.createElement('span');
    msg.textContent = e.msg;
    row.append(ts, msg);
    return row;
  }

  function scrollLogToEnd() { if (logBodyEl) logBodyEl.scrollTop = logBodyEl.scrollHeight; }

  function renderLogAll() {
    if (!logBodyEl) return;
    logBodyEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    logEntries.forEach(e => { if (logEntryVisible(e)) frag.appendChild(logLineEl(e)); });
    logBodyEl.appendChild(frag);
    if (logFollow) scrollLogToEnd();
  }

  // Take the lines ttpull returned and append only the ones we haven't shown yet
  function ingestLog(lines) {
    let start = 0;
    const fresh = [];
    if (logLastRaw !== null) {
      const i = lines.lastIndexOf(logLastRaw);
      if (i >= 0) start = i + 1;
      else if (lines.length) fresh.push({ marker: true, msg: '… log restarted or lines were missed …' });
    }
    lines.slice(start).forEach(raw => fresh.push(parseLogLine(raw)));
    if (!fresh.length) return;
    if (lines.length) logLastRaw = lines[lines.length - 1];

    fresh.forEach(e => logEntries.push(e));
    while (logEntries.length > LOG_KEEP) logEntries.shift();
    if (!logBodyEl) return;
    fresh.forEach(e => { if (logEntryVisible(e)) logBodyEl.appendChild(logLineEl(e)); });
    while (logBodyEl.childElementCount > LOG_KEEP) logBodyEl.firstChild.remove();
    if (logFollow) scrollLogToEnd();
  }

  function setLogStatus(kind, text) {
    if (!logStatusEl) return;
    logStatusEl.className = 'log-status ' + kind;
    logStatusEl.textContent = text;
  }

  async function pollLog() {
    const gen = logPollGen;
    try {
      const r = await fetch('/api/ttpull/logs', { cache: 'no-store' });
      const d = await r.json();
      if (gen !== logPollGen) return;
      if (d.ok) {
        ingestLog(d.lines);
        const st = d.status;
        setLogStatus('ok', st ? 'ttpull · ' + (st.running ? 'running' + (st.phase ? ': ' + st.phase : '') : 'idle') : 'ttpull · connected');
      } else {
        setLogStatus('error', d.error || 'ttpull unreachable');
      }
    } catch (_) {
      if (gen !== logPollGen) return;
      setLogStatus('error', 'Starplayer server unreachable (the live log needs the server)');
    }
    if (gen === logPollGen && logTabActive && !logPaused) logTimer = setTimeout(pollLog, 2000);
  }

  function startLogPolling() {
    stopLogPolling();
    if (!logPaused) pollLog();
  }

  function stopLogPolling() {
    logPollGen++;
    clearTimeout(logTimer);
    logTimer = null;
  }

  function buildLogView() {
    logViewEl = document.createElement('div');
    logViewEl.id = 'log-view';

    const head = document.createElement('div');
    head.id = 'log-head';
    const title = document.createElement('span');
    title.className = 'stars-main-title';
    title.textContent = 'ttpull log';
    logStatusEl = document.createElement('span');
    logStatusEl.className = 'log-status';
    logStatusEl.textContent = 'connecting…';

    const controls = document.createElement('div');
    controls.className = 'log-controls';
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.className = 'log-filter';
    filter.placeholder = 'Filter';
    filter.addEventListener('input', () => { logFilter = filter.value.trim().toLowerCase(); renderLogAll(); });
    controls.appendChild(filter);

    ['info', 'warn', 'error'].forEach(level => {
      const b = document.createElement('button');
      b.className = 'log-btn log-level lvl-' + level + (logLevels[level] ? ' on' : '');
      b.textContent = level;
      b.title = 'Show or hide ' + level + ' lines';
      b.addEventListener('click', () => {
        logLevels[level] = !logLevels[level];
        b.classList.toggle('on', logLevels[level]);
        renderLogAll();
      });
      controls.appendChild(b);
    });

    const follow = document.createElement('button');
    follow.className = 'log-btn log-follow' + (logFollow ? ' on' : '');
    follow.textContent = '↓ Follow';
    follow.title = 'Keep the newest line in view';
    follow.addEventListener('click', () => {
      logFollow = !logFollow;
      follow.classList.toggle('on', logFollow);
      if (logFollow) scrollLogToEnd();
    });
    controls.appendChild(follow);

    const pause = document.createElement('button');
    pause.className = 'log-btn log-pause';
    const paintPause = () => {
      pause.textContent = logPaused ? '▶ Resume' : '⏸ Pause';
      pause.classList.toggle('on', logPaused);
    };
    paintPause();
    pause.addEventListener('click', () => {
      logPaused = !logPaused;
      paintPause();
      if (logPaused) { stopLogPolling(); setLogStatus('paused', 'paused'); }
      else startLogPolling();
    });
    controls.appendChild(pause);

    const clear = document.createElement('button');
    clear.className = 'log-btn';
    clear.textContent = 'Clear';
    clear.title = 'Clear the view (the log on the server is not affected)';
    clear.addEventListener('click', () => { logEntries.length = 0; if (logBodyEl) logBodyEl.innerHTML = ''; });
    controls.appendChild(clear);

    head.append(title, logStatusEl, controls);

    logBodyEl = document.createElement('div');
    logBodyEl.id = 'log-body';
    // Scrolling up turns Follow off; scrolling back to the bottom turns it on again
    logBodyEl.addEventListener('scroll', () => {
      const atEnd = logBodyEl.scrollHeight - logBodyEl.scrollTop - logBodyEl.clientHeight < 24;
      if (atEnd !== logFollow) {
        logFollow = atEnd;
        follow.classList.toggle('on', logFollow);
      }
    });

    logViewEl.append(head, logBodyEl);
    const main = document.querySelector('main');
    if (main) main.parentNode.insertBefore(logViewEl, main);
    else document.body.appendChild(logViewEl);
    renderLogAll();
  }

  function showLogTab() {
    if (isMobilePlayer() || logTabActive) return;
    if (autotagTabActive) hideAutotagView();
    if (activeAuthorId) hideAuthorView();
    if (starsTabActive) {
      starsTabActive = false;
      if (starsViewEl) { releaseGridPreviews(starsViewEl); starsViewEl.style.display = 'none'; }
      document.querySelector('nav .stars-tab')?.classList.remove('active');
    }
    closeVideoOverlay();
    closePanel();
    logTabActive = true;
    document.querySelector('main')?.style.setProperty('display', 'none');
    toggleBtn.style.display = 'none';
    document.body.classList.add('sp-log-open');
    document.querySelector('nav .log-tab')?.classList.add('active');
    if (!logViewEl) buildLogView();
    logViewEl.style.display = 'flex';
    if (logFollow) scrollLogToEnd();
    startLogPolling();
  }

  // Hide only; the caller decides what to show next
  function hideLogView() {
    if (!logTabActive) return;
    logTabActive = false;
    stopLogPolling();
    if (logViewEl) logViewEl.style.display = 'none';
    document.body.classList.remove('sp-log-open');
    document.querySelector('nav .log-tab')?.classList.remove('active');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTOTAGTT — review suggestions made by the local autotagTT batch job
  // Accept: records the decision, then adds the video to the tag's group (explicit click only).
  // Reject: records the decision only; group membership is never changed.
  // ═══════════════════════════════════════════════════════════════════════════

  let autotagTabActive = false;
  let autotagViewEl    = null;
  let atTag            = 'braces';
  let atMode           = 'pending';   // 'pending' | 'accepted' | 'rejected'
  let atData           = null;        // last /api/autotag response
  let atError          = '';
  let atBusy           = new Set();

  function atGroupName(tag) {
    const g = groups.find(x => String(x.name).trim().toLowerCase() === tag);
    return g ? g.name : tag;
  }

  async function atLoad() {
    atError = '';
    try {
      const r = await fetch('/api/autotag?tag=' + encodeURIComponent(atTag), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      atData = await r.json();
    } catch (_) { atData = null; atError = 'Could not load suggestions.'; }
    renderAutotagView();
  }

  async function atSendFeedback(id, decision, change, tag = atTag) {
    const r = await fetch('/api/autotag/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, id, decision, change: !!change }),
    });
    if (!r.ok) throw new Error(r.status);
  }

  async function atDecide(id, decision, card) {
    if (atBusy.has(id)) return;
    atBusy.add(id);
    card.querySelectorAll('.at-btn').forEach(b => { b.disabled = true; });
    try {
      await atSendFeedback(id, decision, atMode !== 'pending');
      if (decision === 'accepted') {
        // Only now, after the explicit click and a recorded decision, touch the group
        const name = atGroupName(atTag);
        if (!inQuickGroup(id, name)) toggleQuickGroup(id, name);
      }
      await atLoad();
    } catch (_) {
      card.querySelectorAll('.at-btn').forEach(b => { b.disabled = false; });
      atError = 'Could not save that decision; nothing was changed.';
      renderAutotagView();
    } finally { atBusy.delete(id); }
  }

  function buildAutotagCard(item, idx, list) {
    const id = item.id;
    const coverSrc = coverSrcFor(id);
    const info = getVideoInfo(id);
    const card = document.createElement('div');
    card.className = 'stars-grid-card';
    card.dataset.id = id;

    const cover = document.createElement('div');
    cover.className = 'stars-grid-cover';
    attachPreview(cover, getVideoPath(coverSrc));
    cover.addEventListener('click', () => openVideoOverlay(list.findIndex(v => v.id === id), list));
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = coverSrc;
    img.onerror = () => { img.style.display = 'none'; };
    cover.appendChild(img);
    cover.appendChild(buildThumbTools(id, coverSrc, info.authorName, info.desc));
    const un = info.authorName || '';
    if (un) {
      const u = document.createElement('span');
      u.className = 'at-user';
      setAuthorLink(u, un);
      cover.appendChild(u);
    }
    if (item.score != null) {
      const sc = document.createElement('span');
      sc.className = 'at-score';
      sc.title = 'Model score (higher = more like the tagged examples; not a probability)';
      sc.textContent = item.score.toFixed(2);
      cover.appendChild(sc);
    }
    card.appendChild(cover);

    const row = document.createElement('div');
    row.className = 'at-actions';
    const mk = (cls, text, title, fn) => {
      const b = document.createElement('button');
      b.className = 'at-btn ' + cls; b.textContent = text; b.title = title;
      b.addEventListener('click', e => { e.stopPropagation(); fn(); });
      return b;
    };
    const accept = () => mk('accept', '✓', 'Accept: add to "' + atGroupName(atTag) + '"', () => atDecide(id, 'accepted', card));
    const reject = () => mk('reject', '✕', 'Reject: not ' + atTag, () => atDecide(id, 'rejected', card));
    if (atMode === 'pending') {
      row.append(accept(),
        mk('unsure', '?', 'Not sure: set aside, no label for training', () => atDecide(id, 'unsure', card)),
        reject());
    } else if (atMode === 'unsure') {
      row.append(accept(), reject(), mk('', '↺', 'Move back to pending', () => atDecide(id, 'pending', card)));
    } else if (atMode === 'rejected') {
      row.append(mk('', 'Restore', 'Move back to pending', () => atDecide(id, 'pending', card)));
    } else {
      const n = document.createElement('div');
      n.className = 'at-note';
      n.textContent = inQuickGroup(id, atGroupName(atTag)) ? 'in "' + atGroupName(atTag) + '"' : 'accepted (no longer in group)';
      card.appendChild(n);
    }
    if (row.childNodes.length) card.appendChild(row);
    return card;
  }

  function renderAutotagView() {
    if (!autotagViewEl) return;
    releaseGridPreviews(autotagViewEl);
    autotagViewEl.innerHTML = '';

    const head = document.createElement('div');
    head.id = 'autotag-head';
    const title = document.createElement('span');
    title.className = 'stars-main-title';
    title.textContent = 'autotagTT';
    const sel = document.createElement('select');
    sel.title = 'Tag';
    const tags = (atData && atData.tags && atData.tags.length) ? atData.tags : [atTag];
    if (!tags.includes(atTag)) tags.push(atTag);
    tags.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t; o.selected = t === atTag;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { atTag = sel.value; atMode = 'pending'; atLoad(); });

    const modes = document.createElement('div');
    modes.className = 'at-modes';
    const counts = atData ? { pending: atData.pending.length, accepted: atData.accepted.length, rejected: atData.rejected.length, unsure: (atData.unsure || []).length } : {};
    const labels = { pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected', unsure: 'Not sure' };
    ['pending', 'unsure', 'accepted', 'rejected'].forEach(m => {
      const b = document.createElement('button');
      b.className = 'at-mode' + (atMode === m ? ' on' : '');
      b.textContent = labels[m] + (counts[m] != null ? ' ' + counts[m] : '');
      b.addEventListener('click', () => { atMode = m; renderAutotagView(); });
      modes.appendChild(b);
    });
    const pick = document.createElement('button');
    pick.className = 'at-mode'; pick.textContent = 'Tags…'; pick.title = 'Choose which of your groups the AI tagger learns';
    pick.addEventListener('click', openTagPicker);
    head.append(title, sel, modes, pick);

    const grid = document.createElement('div');
    grid.id = 'autotag-grid';
    grid.className = 'preview-grid';
    const msg = text => {
      const d = document.createElement('div'); d.id = 'autotag-msg'; d.textContent = text; grid.appendChild(d);
    };
    const list = sortVideos(atData && atData[atMode] ? atData[atMode] : [], 'autotag');  // unsure may be missing on an older server
    if (atError) msg(atError);
    if (!atData) { if (!atError) msg('Loading…'); }
    else if (!atData.available) msg('No suggestions yet. Run the autotagTT job first.');
    else if (!list.length) msg(atMode === 'pending' ? 'No pending suggestions for "' + atTag + '".' : 'Nothing here yet.');
    else {
      const ctx = list.map(it => {
        const cs = coverSrcFor(it.id), inf = getVideoInfo(it.id);
        return { id: it.id, coverSrc: cs, videoPath: getVideoPath(cs), authorName: inf.authorName || '', desc: inf.desc || '' };
      });
      fillGrid(grid, list, (it, i) => buildAutotagCard(it, i, ctx));
    }
    head.appendChild(buildGridControls('autotag', grid, autotagViewEl));
    autotagViewEl.append(head, grid);
    observeGridPreviews(grid);
  }

  function showAutotagTab() {
    if (autotagTabActive) return;
    if (activeAuthorId) hideAuthorView();
    if (logTabActive) hideLogView();
    if (starsTabActive) {
      starsTabActive = false;
      if (starsViewEl) { releaseGridPreviews(starsViewEl); starsViewEl.style.display = 'none'; }
      document.querySelector('nav .stars-tab')?.classList.remove('active');
    }
    closeVideoOverlay();
    closePanel();
    autotagTabActive = true;
    document.querySelector('main')?.style.setProperty('display', 'none');
    toggleBtn.style.display = 'none';
    document.body.classList.add('sp-autotag-open');
    if (isMobilePlayer()) { activeMobileTab = 'review'; updateMobileNavActive(); }
    else document.querySelector('nav .autotag-tab')?.classList.add('active');
    if (!autotagViewEl) {
      autotagViewEl = document.createElement('div');
      autotagViewEl.id = 'autotag-view';
      const main = document.querySelector('main');
      if (main) main.parentNode.insertBefore(autotagViewEl, main); else document.body.appendChild(autotagViewEl);
    }
    autotagViewEl.style.display = 'flex';
    ensureArchiveDb();
    if (_dbCache) { renderAutotagView(); atLoad(); }
    else { renderAutotagView(); archiveDbPromise().catch(() => {}).then(() => { if (autotagTabActive) atLoad(); }); }
  }

  function hideAutotagView() {
    if (!autotagTabActive) return;
    autotagTabActive = false;
    releaseGridPreviews(autotagViewEl);
    if (autotagViewEl) autotagViewEl.style.display = 'none';
    document.body.classList.remove('sp-autotag-open');
    document.querySelector('nav .autotag-tab')?.classList.remove('active');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LABEL BUBBLES — human group labels or AI tags under each Stars thumbnail
  // AI tags are the model's guesses, kept apart from human groups. ✓ promotes one into the human
  // group (explicit click only); ✕ records a rejection and never touches groups.
  // ═══════════════════════════════════════════════════════════════════════════

  let labelMode   = (() => { try { return localStorage.getItem('sp_label_mode') === 'ai' ? 'ai' : 'human'; } catch (_) { return 'human'; } })();
  let aiVideos    = null;          // { videoId: [[tag, score], ...] } from /api/autotag/ai
  let aiLoading   = false;
  const aiDone    = new Set();     // "tag|id" decided in this session (hidden at once)

  function loadAiVideos(force) {
    if (aiLoading || (aiVideos && !force)) return;
    aiLoading = true;
    fetch('/api/autotag/ai', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
      aiVideos = (d && d.videos) || {};
    }).catch(() => { aiVideos = {}; }).finally(() => {
      aiLoading = false;
      if (starsTabActive && labelMode === 'ai') renderStarsView();
    });
  }

  function buildLabelToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'grid-sort sp-label-toggle';
    wrap.setAttribute('role', 'group');
    wrap.title = 'Labels shown under each thumbnail: your groups, or the AI tagger\'s guesses';
    [['human', 'Human'], ['ai', 'AI']].forEach(([mode, text]) => {
      const b = document.createElement('button');
      b.className = 'grid-sort-btn' + (labelMode === mode ? ' on' : '');
      b.textContent = text;
      b.setAttribute('aria-pressed', labelMode === mode ? 'true' : 'false');
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (labelMode === mode) return;
        labelMode = mode;
        try { localStorage.setItem('sp_label_mode', mode); } catch (_) {}
        if (mode === 'ai') loadAiVideos(true);
        renderStarsView();
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function groupDisplayName(tag) {
    const g = groups.find(x => String(x.name).trim().toLowerCase() === tag);
    return g ? g.name : tag;
  }

  function makeBubble(text, cls) {
    const b = document.createElement('span');
    b.className = 'sp-bubble ' + cls;
    const t = document.createElement('span');
    t.className = 'sp-bubble-name';
    t.textContent = text;
    b.appendChild(t);
    return b;
  }

  async function aiBubbleDecide(bubble, id, tag, decision) {
    if (bubble._busy) return;
    bubble._busy = true;
    bubble.classList.add('busy');
    try {
      await atSendFeedback(id, decision, false, tag);
      aiDone.add(tag + '|' + id);
      if (decision === 'accepted') {
        const name = atGroupName(tag);
        if (!inQuickGroup(id, name)) toggleQuickGroup(id, name);   // re-renders the stars view
      }
      if (bubble.isConnected) bubble.remove();
      if (autotagTabActive) atLoad();
    } catch (_) {
      bubble._busy = false;
      bubble.classList.remove('busy');
      bubble.classList.add('err');
      bubble.title = 'Could not save; nothing was changed';
    }
  }

  function appendLabelBubbles(cover, videoId) {
    const items = [];
    if (labelMode === 'ai') {
      if (!aiVideos) { loadAiVideos(); return; }
      (aiVideos[videoId] || []).slice().sort((a, b) => b[1] - a[1]).forEach(([tag, score]) => {
        if (aiDone.has(tag + '|' + videoId) || inQuickGroup(videoId, groupDisplayName(tag))) return;
        items.push({ tag, score });
      });
    } else {
      groups.forEach(g => { if (g.videoIds.includes(videoId)) items.push({ name: g.name }); });
    }
    if (!items.length) return;
    const box = document.createElement('div');
    box.className = 'sp-bubbles';
    box.addEventListener('click', e => e.stopPropagation());
    items.slice(0, 5).forEach(it => {
      if (it.name != null) { box.appendChild(makeBubble(it.name, 'human')); return; }
      const b = makeBubble(groupDisplayName(it.tag), 'ai');
      b.title = 'AI tag "' + groupDisplayName(it.tag) + '" (score ' + it.score.toFixed(2) + '). ✓ add to your group, ✕ not this tag';
      const ok = document.createElement('button');
      ok.className = 'sp-bubble-act ok'; ok.textContent = '✓'; ok.title = 'Accept: add to "' + groupDisplayName(it.tag) + '"';
      ok.addEventListener('click', e => { e.stopPropagation(); aiBubbleDecide(b, videoId, it.tag, 'accepted'); });
      const no = document.createElement('button');
      no.className = 'sp-bubble-act no'; no.textContent = '✕'; no.title = 'Reject: not ' + groupDisplayName(it.tag);
      no.addEventListener('click', e => { e.stopPropagation(); aiBubbleDecide(b, videoId, it.tag, 'rejected'); });
      b.append(ok, no);
      box.appendChild(b);
    });
    cover.appendChild(box);
  }

  // ── Tag picker: which of your groups the autotagTT job should train and tag ──
  async function openTagPicker() {
    const old = document.getElementById('at-picker');
    if (old) { old.remove(); return; }
    let enabled = [];
    try { enabled = (await (await fetch('/api/autotag/tags', { cache: 'no-store' })).json()).enabled || []; } catch (_) {}
    const sel = new Set(enabled);
    const panel = document.createElement('div');
    panel.id = 'at-picker';
    const h = document.createElement('div');
    h.className = 'at-picker-head';
    h.textContent = 'Tags for the AI tagger';
    const note = document.createElement('div');
    note.className = 'at-note';
    note.textContent = 'Ticked groups are learned and suggested on the next autotagTT run. Choose visual, non-sensitive tags only; a group needs about 30 videos.';
    const list = document.createElement('div');
    list.className = 'at-picker-list';
    [...groups].sort((a, b) => a.name.localeCompare(b.name)).forEach(g => {
      const key = String(g.name).trim().toLowerCase();
      const row = document.createElement('label');
      row.className = 'at-picker-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = sel.has(key);
      cb.addEventListener('change', () => { cb.checked ? sel.add(key) : sel.delete(key); });
      const nm = document.createElement('span');
      nm.textContent = g.name;
      const ct = document.createElement('span');
      ct.className = 'at-note';
      ct.textContent = g.videoIds.length + (g.videoIds.length < 30 ? ' (too few)' : '');
      row.append(cb, nm, ct);
      list.appendChild(row);
    });
    const msg = document.createElement('span');
    msg.className = 'at-note';
    const save = document.createElement('button');
    save.className = 'at-mode on'; save.textContent = 'Save';
    save.addEventListener('click', async () => {
      try {
        const r = await fetch('/api/autotag/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: [...sel] }) });
        if (!r.ok) throw new Error(r.status);
        msg.textContent = 'Saved. Takes effect on the next run.';
      } catch (_) { msg.textContent = 'Could not save.'; }
    });
    const close = document.createElement('button');
    close.className = 'at-mode'; close.textContent = 'Close';
    close.addEventListener('click', () => panel.remove());
    const foot = document.createElement('div');
    foot.className = 'at-picker-foot';
    foot.append(save, close, msg);
    panel.append(h, note, list, foot);
    autotagViewEl.appendChild(panel);
  }

  function makeNavTab(className, svgPath, label, onClick) {
    const tab = document.createElement('div');
    tab.className = className + ' pressable';
    tab.title = label;
    tab.innerHTML =
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="flex-shrink:0">${svgPath}</svg>${label}`;
    tab.addEventListener('click', onClick);
    return tab;
  }

  function injectNavTabs() {
    const nav = document.querySelector('nav');
    if (!nav) return;

    // Labels are hidden by CSS, so keep them available as tooltips
    nav.querySelectorAll('.pressable').forEach(t => {
      if (!t.title) t.title = t.textContent.trim();
    });

    // Stars tab — after .following
    if (!nav.querySelector('.stars-tab')) {
      const following = nav.querySelector('.following');
      if (following) {
        const tab = makeNavTab('stars-tab',
          '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
          'Stars',
          () => { if (!starsTabActive) showStarsTab(); }
        );
        if (starsTabActive) tab.classList.add('active');
        following.insertAdjacentElement('afterend', tab);
      }
    }

    // Player tab — after .stars-tab
    if (!nav.querySelector('.player-tab')) {
      const starsTab = nav.querySelector('.stars-tab');
      if (starsTab) {
        const tab = makeNavTab('player-tab',
          '<path d="M8 5v14l11-7z"/>',
          'Open player in a new window',
          () => {
            if (isMobilePlayer()) {
              if (!playerOpen) openPlayer(); else closePlayer();
            } else {
              launchPlayerWindow();
            }
          }
        );
        // A button, not a page tab: without .pressable the nav click handler leaves the current view alone
        tab.classList.remove('pressable');
        starsTab.insertAdjacentElement('afterend', tab);
      }
    }

    // Sessions button — next to Player
    if (!nav.querySelector('.session-tab')) {
      const playerTab = nav.querySelector('.player-tab');
      if (playerTab) {
        const tab = makeNavTab('session-tab',
          '<path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h10v4h8v10z"/>',
          'Tab sessions',
          toggleSessionsMenu
        );
        tab.classList.remove('pressable');
        playerTab.insertAdjacentElement('afterend', tab);
      }
    }

    // Live log tab — last in the nav, right-aligned so it sits against the search field
    if (!nav.querySelector('.log-tab')) {
      const tab = makeNavTab('log-tab',
        '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.58-2.59L7.5 9l4 4-4 4z"/>',
        'ttpull live log',
        () => showLogTab()
      );
      if (logTabActive) tab.classList.add('active');
      nav.appendChild(tab);
    }

    // autotagTT review tab — last in the nav, after the log tab
    if (!nav.querySelector('.autotag-tab')) {
      const tab = makeNavTab('autotag-tab',
        '<path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/><path d="M3 3h18v2H3z"/>',
        'autotagTT suggestions',
        () => showAutotagTab()
      );
      if (autotagTabActive) tab.classList.add('active');
      nav.appendChild(tab);
    }

    syncAuthorTabs();
  }

  function watchNavClicks() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    nav.addEventListener('click', e => {
      const tab = e.target.closest('.pressable');
      if (!tab || playerBuilding) return; // ignore clicks while collecting video IDs
      const isOwnTab = tab.classList.contains('stars-tab') || tab.classList.contains('author-tab') || tab.classList.contains('log-tab') || tab.classList.contains('autotag-tab');
      if (!isOwnTab && (starsTabActive || activeAuthorId || logTabActive || autotagTabActive)) showMainContent();
      if (!tab.classList.contains('player-tab') && playerOpen && isMobilePlayer()) closePlayer();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MUTATION OBSERVER
  // ═══════════════════════════════════════════════════════════════════════════

  let scanTimer = null;

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanCards, 50);
  }

  function startObserving() {
    const root = document.getElementById('archive');
    if (!root) { setTimeout(startObserving, 300); return; }

    new MutationObserver(scheduleScan).observe(root, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['src'],
    });
    scanCards();

    if (isMobilePlayer()) {
      setupPhoneChrome();
      createMobileNav();
      setupMobileSwipe();
      // Show loading overlay immediately, then open player
      showDefaultStarsView();
    } else {
      const nav = document.querySelector('nav');
      if (nav) new MutationObserver(injectNavTabs).observe(nav, { childList: true });
      injectNavTabs();
      watchNavClicks();
      ensureArchiveDb();
      showDefaultStarsView();
    }
  }

  // Desktop opens on the Stars page. Wait for the app's <main> so the view can be inserted next to it.
  let defaultViewShown = false;
  function showDefaultStarsView(tries = 0) {
    if (defaultViewShown) return;
    if (!document.querySelector('main') || (!isMobilePlayer() && !document.querySelector('nav .stars-tab'))) {
      if (tries < 50) setTimeout(() => showDefaultStarsView(tries + 1), 100);
      return;
    }
    defaultViewShown = true;
    if (!starsTabActive && !logTabActive && !autotagTabActive && !activeAuthorId) showStarsTab();
  }

  // ── Expose live API for pop-out windows ──────────────────────────────────
  window._mfttWin = {
    applyStars:  s  => { stars  = s;  saveStarsLocal();  refreshAllButtons(); updateToggleBtn(); if (starsTabActive) renderStarsView(); },
    applyGroups: g  => { groups = g;  saveGroupsLocal(); if (starsTabActive) renderStarsView(); },
    applyLevels: lv => { levels = lv; saveLevelsLocal(); if (starsTabActive) renderStarsView(); },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STYLES
  // ═══════════════════════════════════════════════════════════════════════════

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      /* ── Exact time after the viewer's "Last run: today." ── */
      p[data-sp-lastrun]::after { content: ' ' attr(data-sp-lastrun); opacity: 0.75; }

      /* ── Star buttons on main-list cards ── */
      div.cover { position: relative; }
      .star-btn {
        position: absolute; top: 3px; right: 3px; z-index: 10;
        background: none; border: none; padding: 0;
        width: 22px; height: 22px; font-size: 15px; line-height: 22px;
        text-align: center; color: rgba(255,255,255,0.4); cursor: pointer;
        text-shadow: 0 1px 3px rgba(0,0,0,0.9);
        transition: color .1s, transform .1s; opacity: 0;
      }
      div.cover:hover .star-btn, .star-btn.star-active { opacity: 1; }
      .star-btn:hover { color: gold; transform: scale(1.25); }
      .star-btn.star-active { color: gold; }

      /* ── Braces tag buttons ── */
      .braces-btn svg { display: block; pointer-events: none; }
      .braces-list-btn {
        position: absolute; top: 3px; right: 27px; z-index: 10;
        width: 22px; height: 22px; padding: 0; background: none; border: none;
        display: flex; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.4); cursor: pointer; opacity: 0;
        filter: drop-shadow(0 1px 3px rgba(0,0,0,.9));
        transition: color .1s, transform .1s;
      }
      div.cover:hover .braces-list-btn, .braces-list-btn.braces-on { opacity: 1; }
      .braces-list-btn:hover { color: #4fc3f7; transform: scale(1.2); }
      .braces-list-btn.braces-on, .overlay-braces-btn.braces-on, .player-braces-btn.braces-on { color: #4fc3f7; }
      .grid-braces-btn { right: 28px !important; }
      .grid-braces-btn:hover { background: rgba(30,110,160,.85) !important; color: #fff !important; }
      .grid-braces-btn.braces-on { color: #4fc3f7 !important; opacity: 1 !important; }

      /* ── Bottom-right toggle ── */
      #star-toggle {
        position: fixed; bottom: 20px; right: 20px; z-index: 1000;
        background: #222; color: #ddd; border: 1px solid #555;
        border-radius: 20px; padding: 6px 14px; font-size: 14px;
        cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.5);
        transition: background .15s, border-color .15s, color .15s;
      }
      #star-toggle:hover { background: #2e2e2e; }
      #star-toggle.star-toggle-active { color: gold; border-color: gold; }

      /* ── Bottom-right panel ── */
      #star-panel {
        position: fixed; bottom: 72px; right: 20px; z-index: 999;
        background: #1e1e1e; border: 1px solid #555; border-radius: 8px;
        width: 360px; max-height: 70vh; display: flex; flex-direction: column;
        box-shadow: 0 4px 20px rgba(0,0,0,.7); overflow: hidden;
      }
      #star-panel-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 14px; border-bottom: 1px solid #444;
        font-size: 14px; font-weight: bold; color: gold; flex-shrink: 0;
      }
      #star-panel-close { background: none; border: none; color: #aaa; cursor: pointer; font-size: 16px; padding: 0; }
      #star-panel-close:hover { color: #fff; }
      #star-panel-grid { overflow-y: auto; padding: 10px; display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; }
      #star-panel-empty { grid-column:1/-1; text-align:center; color:#777; padding:24px 0; font-size:13px; line-height:1.7; margin:0; }
      .star-panel-item { display:flex; flex-direction:column; gap:3px; min-width:0; }
      .star-panel-cover { position:relative; aspect-ratio:9/16; overflow:hidden; border-radius:4px; background:#2a2a2a; cursor:pointer; }
      .star-panel-cover img { width:100%; height:100%; object-fit:cover; display:block; transition:filter .15s; }
      .star-panel-cover:hover img { filter:brightness(.75); }
      .star-panel-cover::after { content:'▶'; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#fff; font-size:22px; opacity:0; pointer-events:none; transition:opacity .15s; text-shadow:0 1px 4px rgba(0,0,0,.8); }
      .star-panel-cover:hover::after { opacity:1; }
      .star-panel-remove { position:absolute; top:3px; right:3px; background:rgba(0,0,0,.6); border:none; border-radius:50%; color:#ccc; width:18px; height:18px; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .1s,background .1s; padding:0; }
      .star-panel-cover:hover .star-panel-remove { opacity:1; }
      .star-panel-remove:hover { background:rgba(180,0,0,.8); color:#fff; }
      .star-panel-author { font-size:11px; color:#aaa; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .star-panel-desc   { font-size:11px; color:#777; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* ── Stars & Player nav tabs ── */
      nav .stars-tab, nav .player-tab, nav .session-tab, nav .log-tab, nav .autotag-tab {
        display: flex; align-items: center;
        cursor: pointer; border-bottom: 3px solid transparent; color: inherit;
        white-space: nowrap;
      }

      /* ── Icon-only top nav (labels hidden; title tooltips added in JS) ── */
      nav { margin-left: 20px !important; }
      nav .likes, nav .bookmarked, nav .following, nav .readme,
      nav .stars-tab, nav .player-tab, nav .session-tab, nav .log-tab, nav .autotag-tab {
        font-size: 0 !important; gap: 0 !important;
        margin: 3.3px 2px 0 !important; padding: 0 14px !important;
        justify-content: center; border-radius: 6px 6px 0 0;
        transition: color .15s, background .15s;
      }
      nav .likes svg, nav .bookmarked svg, nav .following svg, nav .readme svg,
      nav .stars-tab svg, nav .player-tab svg, nav .session-tab svg, nav .log-tab svg, nav .autotag-tab svg {
        width: 20px !important; height: 20px !important; margin: 0 !important;
      }
      nav .likes:not(.active):hover, nav .bookmarked:not(.active):hover,
      nav .following:not(.active):hover, nav .readme:not(.active):hover,
      nav .stars-tab:not(.active):hover, nav .player-tab:not(.active):hover, nav .session-tab:not(.menu-open):hover, nav .log-tab:not(.active):hover, nav .autotag-tab:not(.active):hover {
        color: var(--active, #d7d7d7); background: rgba(255,255,255,.05);
      }
      nav .likes.active, nav .bookmarked.active, nav .following.active, nav .readme.active,
      nav .stars-tab.active, nav .player-tab.active, nav .session-tab.menu-open, nav .log-tab.active, nav .autotag-tab.active {
        color: var(--active, #d7d7d7); background: rgba(255,255,255,.09);
        border-bottom: 3px solid var(--active, #d7d7d7); cursor: default;
      }

      /* ── Author tabs + view ── */
      nav .author-tab {
        display: flex; align-items: center; gap: 6px;
        margin: 3.3px 2px 0; padding: 0 8px 0 12px; max-width: 160px;
        font-size: 13px; cursor: pointer; color: inherit;
        border-bottom: 3px solid transparent; border-radius: 6px 6px 0 0;
        transition: color .15s, background .15s;
      }
      nav .author-tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      nav .author-tab-close { font-size: 10px; line-height: 1; padding: 3px 5px; border-radius: 50%; opacity: .55; flex-shrink: 0; }
      nav .author-tab-close:hover { opacity: 1; background: rgba(255,255,255,.15); }
      nav .author-tab:not(.active):hover { color: var(--active, #d7d7d7); background: rgba(255,255,255,.05); }
      nav .author-tab.active {
        color: var(--active, #d7d7d7); background: rgba(255,255,255,.09);
        border-bottom: 3px solid var(--active, #d7d7d7); cursor: default;
      }
      nav .log-tab { margin-left: auto !important; }
      nav .stars-tab { order: -1; }
      nav .autotag-tab { order: 100; }
      /* the app keeps its own tab marked active underneath; hide that highlight while Stars is showing */
      nav:has(.stars-tab.active) .pressable.active:not(.stars-tab) {
        color: var(--inactive, rgb(160,160,160)) !important;
        background: none !important; border-bottom-color: transparent !important;
      }
      body.sp-log-open nav .pressable.active:not(.log-tab),
      body.sp-autotag-open nav .pressable.active:not(.autotag-tab),
      body.sp-author-open nav .pressable.active:not(.author-tab) {
        color: var(--inactive, rgb(160,160,160)) !important;
        background: none !important; border-bottom-color: transparent !important;
      }
      /* ── Player + Explain tabs sit to the right of the search field ──
         They stay in the nav DOM (React owns Explain, other code looks up
         "nav .player-tab") and are positioned out of the flow instead. */
      @media (min-width: 769px) {
        header:has(> nav) {
          position: relative;
          padding-right: calc(var(--left-padding, 20px) + 168px) !important;
        }
        header:has(> nav) nav .readme,
        header:has(> nav) nav .player-tab,
        header:has(> nav) nav .session-tab {
          position: absolute !important; z-index: 2; top: 3.3px !important; bottom: 0; margin: 0 !important;
          box-sizing: border-box; width: 52px; padding: 0 !important;
        }
        header:has(> nav) nav .readme     { right: var(--left-padding, 20px); }
        header:has(> nav) nav .player-tab  { right: calc(var(--left-padding, 20px) + 56px); }
        header:has(> nav) nav .session-tab { right: calc(var(--left-padding, 20px) + 112px); }
      }

      #autotag-view { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; position: relative; }
      #autotag-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 18px 10px; flex-shrink: 0; border-bottom: 1px solid #333; }
      #autotag-head select { background: #1e1e1e; border: 1px solid #444; border-radius: 12px; color: #ddd; font-size: 12px; padding: 2px 8px; height: 24px; }
      .at-modes { display: flex; gap: 6px; }
      .at-mode { background: rgba(255,255,255,.06); border: 1px solid #444; color: #999; border-radius: 12px; padding: 2px 10px; font-size: 12px; line-height: 18px; cursor: pointer; }
      .at-mode.on { color: #fff; background: rgba(255,255,255,.14); }
      #autotag-grid { flex: 1; overflow-y: auto; padding: 14px 18px; display: grid; grid-template-columns: repeat(auto-fill,minmax(150px,1fr)); gap: 14px; align-content: start; }
      #autotag-msg { grid-column: 1 / -1; color: #888; text-align: center; padding: 40px 10px; font-size: 13px; line-height: 1.6; }
      .at-score { position: absolute; bottom: 4px; left: 4px; background: rgba(0,0,0,.7); color: #ddd; border-radius: 8px; padding: 1px 7px; font-size: 11px; pointer-events: none; z-index: 2; }
      .sp-bubbles { position: absolute; left: 4px; right: 4px; bottom: 4px; z-index: 3; display: flex; flex-wrap: wrap; gap: 3px; align-items: flex-end; pointer-events: none; max-height: 70%; overflow: hidden; }
      .sp-bubble { pointer-events: auto; display: inline-flex; align-items: center; max-width: 100%; background: rgba(0,0,0,.72); color: #ddd; border-radius: 10px; padding: 1px 7px; font-size: 11px; line-height: 16px; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
      .sp-bubble.ai { background: rgba(60,40,120,.82); }
      .sp-bubble-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sp-bubble-act { display: none; border: none; background: none; color: #ddd; font-size: 12px; line-height: 16px; padding: 0 0 0 5px; cursor: pointer; }
      .sp-bubble-act.ok:hover { color: #4caf50; } .sp-bubble-act.no:hover { color: #f44336; }
      .sp-bubble:hover .sp-bubble-act { display: inline; }
      .sp-bubble.busy { opacity: .5; } .sp-bubble.err { outline: 1px solid #f44336; }
      @media (hover: none) { .sp-bubble-act { display: inline; } }
      .stars-grid-cover .sp-bubble:nth-child(n+6) { display: none; }
      [data-cap="1"] .sp-bubble:nth-child(n+2), [data-cap="2"] .sp-bubble:nth-child(n+3),
      [data-cap="3"] .sp-bubble:nth-child(n+4), [data-cap="4"] .sp-bubble:nth-child(n+5) { display: none; }
      .sp-label-toggle { margin: 8px 10px 4px; align-self: flex-start; }
      #at-picker { position: absolute; top: 52px; right: 12px; z-index: 20; width: min(340px, calc(100% - 24px)); max-height: 70%; overflow: auto; background: #1e1e1e; border: 1px solid #555; border-radius: 8px; padding: 10px; box-shadow: 0 4px 20px rgba(0,0,0,.7); }
      .at-picker-head { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
      .at-picker-list { max-height: 300px; overflow: auto; margin: 8px 0; }
      .at-picker-row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 13px; cursor: pointer; }
      .at-picker-row .at-note { margin-left: auto; }
      .at-picker-foot { display: flex; align-items: center; gap: 8px; }
      .at-user { position: absolute; top: 6px; right: 6px; z-index: 5; max-width: 85%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgba(0,0,0,.7); color: #ddd; border-radius: 8px; padding: 1px 7px; font-size: 11px; }
      #autotag-view .thumb-tools { top: 30px; }
      .at-btn.unsure:hover { color: #ffc107; border-color: #ffc107; }
      .at-actions { display: flex; gap: 6px; }
      .at-btn { flex: 1; border: 1px solid #444; background: #1e1e1e; color: #ccc; border-radius: 6px; padding: 7px 0; font-size: 16px; line-height: 1; cursor: pointer; min-height: 34px; }
      .at-btn.accept:hover { color: #4caf50; border-color: #4caf50; }
      .at-btn.reject:hover { color: #f44336; border-color: #f44336; }
      .at-btn:disabled { opacity: .4; cursor: default; }
      .at-note { font-size: 11px; color: #777; text-align: center; }
      #log-view { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
      #log-head { display: flex; align-items: center; gap: 12px; padding: 12px 18px 10px; flex-shrink: 0; border-bottom: 1px solid #333; }
      .log-status { font-size: 12px; color: #888; display: flex; align-items: center; gap: 6px; min-width: 0; }
      .log-status::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #666; flex-shrink: 0; }
      .log-status.ok::before { background: #4caf50; }
      .log-status.error { color: #ff8a80; }
      .log-status.error::before { background: #f44336; }
      .log-status.paused::before { background: #e5c07b; }
      .log-controls { margin-left: auto; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .log-filter { width: 150px; height: 24px; padding: 0 8px; background: #1e1e1e; border: 1px solid #444; border-radius: 12px; color: #ddd; font-size: 12px; outline: none; }
      .log-btn { background: rgba(255,255,255,.06); border: 1px solid #444; color: #999; border-radius: 12px; padding: 2px 10px; font-size: 12px; line-height: 18px; cursor: pointer; }
      .log-btn:hover { background: rgba(255,255,255,.14); color: #fff; }
      .log-btn.on { background: rgba(255,255,255,.18); border-color: #888; color: #fff; }
      .log-level.lvl-warn.on { color: #e5c07b; border-color: #e5c07b; }
      .log-level.lvl-error.on { color: #ff6b6b; border-color: #ff6b6b; }
      #log-body { flex: 1; overflow-y: auto; padding: 8px 18px 14px; background: #121212; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .log-line { white-space: pre-wrap; overflow-wrap: anywhere; color: #c8c8c8; }
      .log-line.lvl-warn { color: #e5c07b; }
      .log-line.lvl-error { color: #ff6b6b; }
      .log-line.log-marker { color: #777; font-style: italic; }
      .log-ts { color: #6d6d6d; margin-right: 10px; }
      #sessions-menu {
        position: fixed; z-index: 10000; width: 300px; max-height: 70vh;
        display: flex; flex-direction: column; overflow: hidden;
        background: #1e1e1e; border: 1px solid #444; border-radius: 8px;
        box-shadow: 0 8px 28px rgba(0,0,0,.6); color: #ddd; font-size: 13px;
      }
      .sessions-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #333; font-weight: 600; }
      .sessions-new { background: rgba(255,255,255,.08); border: 1px solid #444; color: #ccc; border-radius: 12px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
      .sessions-new:hover { background: rgba(255,255,255,.16); color: #fff; }
      .sessions-list { overflow-y: auto; padding: 4px 0; }
      .sessions-empty { padding: 14px 12px; color: #888; line-height: 1.4; }
      .sessions-row { display: flex; align-items: center; gap: 6px; padding: 7px 12px; cursor: pointer; }
      .sessions-row:hover { background: #2a2a2a; }
      .sessions-row.current { background: #262626; box-shadow: inset 3px 0 0 var(--active, #d7d7d7); }
      .sessions-info { flex: 1; min-width: 0; }
      .sessions-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sessions-meta { font-size: 11px; color: #888; margin-top: 2px; }
      .sessions-act { background: none; border: none; color: #888; cursor: pointer; font-size: 13px; padding: 2px 5px; border-radius: 4px; }
      .sessions-act:hover { color: #fff; background: rgba(255,255,255,.12); }
      .sp-author-link { cursor: pointer; pointer-events: auto !important; }
      .sp-author-link:hover { color: #fff; text-decoration: underline; }
      #author-view { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
      #author-view-header { display: flex; align-items: baseline; gap: 10px; padding: 14px 18px 10px; flex-shrink: 0; border-bottom: 1px solid #333; }
      .grid-controls { display: flex; align-items: center; gap: 8px; align-self: center; }
      .grid-playall { background: rgba(255,255,255,.08); border: 1px solid #444; color: #ccc; border-radius: 12px; padding: 1px 10px; font-size: 12px; line-height: 18px; cursor: pointer; }
      .grid-playall:hover { background: rgba(255,255,255,.16); color: #fff; }
      .grid-playall.on { background: rgba(255,255,255,.2); border-color: #888; color: #fff; }
      .grid-sort { display: inline-flex; flex-shrink: 0; border: 1px solid #444; border-radius: 12px; overflow: hidden; }
      .grid-sort-btn { background: transparent; border: none; border-left: 1px solid #444; color: #999; font-size: 12px; line-height: 22px; padding: 0 9px; cursor: pointer; white-space: nowrap; }
      .grid-sort-btn:first-child { border-left: none; }
      .grid-sort-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
      .grid-sort-btn.on { background: rgba(255,255,255,.2); color: #fff; }
      .grid-size { width: 110px; height: 16px; margin: 0; accent-color: #aaa; cursor: pointer; }
      .preview-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
      .stars-grid-cover.is-playing::after { display: none; }
      .player-feed-mode {
        position: absolute; top: 12px; left: 12px; pointer-events: auto;
        background: rgba(0,0,0,.55); color: #ddd; border: none; border-radius: 14px;
        padding: 4px 11px; font-size: 12px; line-height: 18px; cursor: pointer;
      }
      .player-slide.needs-tap::after {
        content: '▶'; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 64px; height: 64px; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff;
        font-size: 28px; line-height: 64px; text-align: center; pointer-events: none;
      }
      .author-view-close { display: none; margin-left: auto; background: none; border: none; color: #ccc; font-size: 18px; cursor: pointer; padding: 0 4px; }
      #author-grid { flex: 1; overflow-y: auto; padding: 14px 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; align-content: start; }
      .author-empty { color: #777; font-size: 14px; grid-column: 1 / -1; }
      #author-view .stars-grid-remove, #author-view .stars-grid-add-group { opacity: 1; }
      .thumb-tools {
        position: absolute; right: 6px; top: 6px; z-index: 4;
        display: flex; flex-direction: column; align-items: center;
        gap: calc(var(--tool, 28px) * 0.25);
      }
      .thumb-tool {
        width: var(--tool, 28px); height: var(--tool, 28px); padding: 0;
        border: none; border-radius: 50%; background: rgba(0,0,0,.62); color: #ddd;
        font-size: calc(var(--tool, 28px) * 0.52); line-height: 1; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 1px 5px rgba(0,0,0,.5); opacity: 0;
        transition: opacity .1s, background .1s, color .1s;
      }
      .thumb-tool svg { width: 62%; height: 62%; }
      .stars-grid-remove.stars-grid-x { right: auto; left: 4px; }
      .stars-grid-cover:hover .thumb-tool, .thumb-tool.on, .thumb-tool.braces-on { opacity: 1; }
      .thumb-tool:hover { background: rgba(0,0,0,.9); color: #fff; }
      .thumb-star.on { color: gold; }
      .thumb-lvl { font-size: calc(var(--tool, 28px) * 0.36); font-weight: 700; letter-spacing: -.5px; }
      .thumb-lvl.on { color: #fe2c55; }
      .thumb-tool.braces-on { color: #4fc3f7; }
      @media (hover: none) { .thumb-tool { opacity: .9; } }
      @media (max-width: 768px) {
        #autotag-view { position: fixed; inset: 0; bottom: calc(77px + env(safe-area-inset-bottom, 0px)); z-index: 500; background: #0d0d0d; }
        #autotag-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 8px; }
        #autotag-head { padding: 8px 10px; }
        #author-view { position: fixed; inset: 0; bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 3500; background: #0d0d0d; }
        .author-view-close { display: block; flex-shrink: 0; }
        /* the controls (play, size, sort buttons) get their own row under the title */
        #author-view-header { flex-wrap: wrap; align-items: center; row-gap: 6px; }
        #author-view-header .author-view-close { order: 1; margin-left: auto; }
        #author-view-header .grid-controls { order: 2; flex: 0 0 100%; }
        #author-view-header .stars-main-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #author-view-header .stars-main-count, #author-view-header .grid-controls { flex-shrink: 0; }
        #author-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; padding: 8px; }
      }

      /* ── Stars view ── */
      #stars-view { display:none; flex-direction:row; flex:1; min-height:0; overflow:hidden; }
      #stars-sidebar { width:200px; flex-shrink:0; background:#1a1a1a; border-right:1px solid #3a3a3a; display:flex; flex-direction:column; overflow-y:auto; padding:8px 0; }
      .grid-sentinel { grid-column: 1 / -1; height: 1px; }
      .stars-sidebar-divider { border:none; border-top:1px solid #3a3a3a; margin:6px 0; }
      .stars-group-item { display:flex; align-items:center; justify-content:space-between; padding:7px 14px; cursor:pointer; font-size:13px; transition:background .1s; gap:6px; }
      .stars-group-item:hover { background:#262626; }
      .stars-group-item.active { background:#2e2e2e; color:var(--active,#d7d7d7); }
      .stars-group-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .stars-group-count { font-size:11px; color:#666; flex-shrink:0; }
      .stars-group-item.active .stars-group-count { color:#999; }
      .stars-group-row { display:flex; align-items:center; gap:2px; padding-right:6px; }
      .stars-group-row .stars-group-item { flex:1; min-width:0; }
      .stars-group-action { background:none; border:none; color:#555; cursor:pointer; font-size:13px; padding:4px 3px; transition:color .1s; flex-shrink:0; }
      .stars-group-action:hover { color:#aaa; }
      .stars-group-delete:hover { color:#e55; }
      #stars-new-group-btn { margin:8px 10px 4px; padding:6px 10px; background:none; border:1px dashed #444; border-radius:5px; color:#666; cursor:pointer; font-size:12px; transition:border-color .15s,color .15s; text-align:left; }
      #stars-new-group-btn:hover { border-color:#777; color:#aaa; }
      #stars-group-sort { margin:4px 10px 8px; padding:4px 6px; background:#1e1e1e; border:1px solid #3a3a3a; border-radius:4px; color:#888; font-size:11px; cursor:pointer; width:calc(100% - 20px); }
      #stars-group-sort:hover { border-color:#666; color:#ccc; }
      .stars-inline-form { display:flex; align-items:center; gap:4px; padding:6px 8px; margin:4px 8px; }
      .stars-inline-input { flex:1; min-width:0; background:#2a2a2a; border:1px solid #555; border-radius:4px; color:#ddd; font-size:12px; padding:4px 6px; outline:none; }
      .stars-inline-input:focus { border-color:#888; }
      .stars-inline-confirm { background:none; border:none; cursor:pointer; font-size:13px; padding:2px 4px; color:#6c6; }
      .stars-inline-cancel  { background:none; border:none; cursor:pointer; font-size:13px; padding:2px 4px; color:#c66; }
      #stars-main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
      #stars-main-header { display:flex; align-items:baseline; gap:10px; padding:14px 18px 10px; flex-shrink:0; border-bottom:1px solid #333; }
      #stars-mobile-header { display: none; }
      .stars-main-title { font-size:16px; font-weight:600; }
      .stars-main-count { font-size:12px; color:#666; }
      #stars-grid { flex:1; overflow-y:auto; padding:14px 18px; display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:14px; align-content:start; }
      #stars-empty { grid-column:1/-1; text-align:center; color:#555; padding:48px 20px; font-size:14px; line-height:1.8; }
      .stars-grid-card { display:flex; flex-direction:column; gap:4px; }
      .stars-grid-cover { position:relative; aspect-ratio:9/16; overflow:hidden; border-radius:5px; background:#2a2a2a; cursor:pointer; }
      .stars-grid-cover img { width:100%; height:100%; object-fit:cover; display:block; transition:filter .15s; }
      .stars-grid-cover:hover img { filter:brightness(.7); }
      .stars-grid-cover::after { content:'▶'; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:#fff; font-size:26px; opacity:0; pointer-events:none; transition:opacity .15s; text-shadow:0 1px 6px rgba(0,0,0,.9); }
      .stars-grid-cover:hover::after { opacity:1; }
      .stars-grid-remove { position:absolute; top:4px; right:4px; background:rgba(0,0,0,.65); border:none; border-radius:50%; color:#bbb; width:20px; height:20px; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .1s,background .1s; padding:0; }
      .stars-grid-cover:hover .stars-grid-remove { opacity:1; }
      .stars-grid-remove:hover { background:rgba(180,0,0,.8); color:#fff; }
      .stars-grid-add-group { position:absolute; top:4px; left:4px; background:rgba(0,0,0,.65); border:none; border-radius:50%; color:#bbb; width:20px; height:20px; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .1s,background .1s; padding:0; line-height:1; }
      .stars-grid-cover:hover .stars-grid-add-group { opacity:1; }
      .stars-grid-add-group:hover { background:rgba(0,100,200,.7); color:#fff; }
      .stars-grid-author { font-size:11px; color:#999; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .stars-grid-desc   { font-size:11px; color:#666; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* ── Group picker popup ── */
      #stars-group-picker {
        position:fixed; z-index:9999; background:#252525; border:1px solid #555;
        border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,.7);
        display:flex; flex-direction:column; min-width:180px; max-height:320px; overflow:hidden;
      }
      .grp-picker-list { overflow-y:auto; max-height:220px; display:flex; flex-direction:column; gap:1px; padding:4px 0; }
      .grp-picker-empty { padding:8px 14px; font-size:12px; color:#555; }
      .grp-picker-row { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:13px; cursor:pointer; color:#ccc; border-radius:0; }
      .grp-picker-row:hover { background:#333; }
      .grp-picker-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .grp-picker-count { font-size:11px; color:#666; flex-shrink:0; }
      .grp-picker-new-row { border-top:1px solid #333; padding:6px 8px; flex-shrink:0; }
      .grp-picker-add-btn { background:none; border:none; color:#888; font-size:12px; cursor:pointer; padding:2px 4px; width:100%; text-align:left; }
      .grp-picker-add-btn:hover { color:#ccc; }
      .grp-picker-inp { display:flex; gap:4px; align-items:center; }
      .grp-picker-inp input { flex:1; background:#1a1a1a; border:1px solid #444; border-radius:4px; color:#ccc; font-size:12px; padding:4px 6px; outline:none; }
      .grp-picker-ok { background:#333; border:none; border-radius:4px; color:#aaa; cursor:pointer; font-size:13px; padding:3px 7px; }
      .grp-picker-ok:hover { background:#444; color:#fff; }

      /* ── Level picker popup ── */
      #level-picker {
        position:fixed; z-index:9999; background:#252525; border:1px solid #555;
        border-radius:8px; padding:6px; box-shadow:0 4px 20px rgba(0,0,0,.7);
        display:grid; grid-template-columns:repeat(2,1fr); gap:4px;
      }
      .lvl-picker-btn {
        background:#1e1e1e; border:1px solid #3a3a3a; border-radius:4px;
        color:#bbb; font-size:12px; font-weight:700; padding:5px 10px;
        cursor:pointer; transition:background .1s, color .1s;
      }
      .lvl-picker-btn:hover { background:#2a2a2a; color:#fff; }
      .lvl-picker-btn.cur   { background:#fe2c55; border-color:#fe2c55; color:#fff; }

      /* ── Overlay lvl button ── */
      .overlay-lvl-btn { font-size:11px; font-weight:700; letter-spacing:.5px; }

      /* ── Stars sidebar lvl numbered filter ── */
      #stars-lvl-grid {
        display:grid; grid-template-columns:repeat(4,1fr); gap:4px;
        padding:2px 6px 8px;
      }
      .stars-lvl-btn {
        background:#1e1e1e; border:1px solid #3a3a3a; border-radius:4px;
        color:#bbb; font-size:12px; font-weight:600; padding:4px 0;
        cursor:pointer; transition:background .1s, color .1s, border-color .1s;
      }
      .stars-lvl-btn:hover  { background:#2a2a2a; color:#fff; }
      .stars-lvl-btn.active { background:#fe2c55; border-color:#fe2c55; color:#fff; }

      /* ── Lvl groups main-area cards ── */
      #stars-grid:has(.stars-lvl-group-card) { grid-template-columns: repeat(auto-fill, minmax(130px,1fr)); }
      .stars-lvl-group-card {
        position:relative; aspect-ratio:9/16; border-radius:8px; overflow:hidden;
        cursor:pointer; background:#1a1a1a; transition:transform .15s;
      }
      .stars-lvl-group-card:hover { transform:scale(1.03); }
      .stars-lvl-group-img { width:100%; height:100%; object-fit:cover; display:block; }
      .stars-lvl-group-badge {
        position:absolute; bottom:28px; left:0; right:0; text-align:center;
        font-size:32px; font-weight:900; color:#fff;
        text-shadow:0 2px 8px rgba(0,0,0,1);
      }
      .stars-lvl-group-count {
        position:absolute; bottom:8px; left:0; right:0; text-align:center;
        font-size:11px; font-weight:600; color:rgba(255,255,255,.8);
        text-shadow:0 1px 4px rgba(0,0,0,.9);
      }

      /* ── Video overlay (unified player) ── */
      #video-overlay {
        position: fixed; inset: 0; z-index: 4000;
        background: rgba(0,0,0,0.92);
        display: flex; align-items: center; justify-content: center;
        cursor: default;
      }
      #video-overlay-content {
        position: relative; width: 100%; max-width: 480px;
        height: 90vh; max-height: 90vh;
        display: flex; align-items: center; justify-content: center;
      }
      .overlay-video {
        width: 100%; height: 100%; object-fit: contain; display: block;
        border-radius: 8px;
      }
      .overlay-close {
        position: absolute; top: 16px; right: 16px; z-index: 10;
        background: rgba(0,0,0,.5); border: none; border-radius: 50%;
        color: #fff; width: 36px; height: 36px; font-size: 18px;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity .2s;
      }
      #video-overlay:hover .overlay-close { opacity: 1; }
      .overlay-close:hover { background: rgba(0,0,0,.8); }
      .overlay-controls-layer {
        position: absolute; inset: 0; pointer-events: none;
      }
      .overlay-controls-layer::after {
        content: ''; position: absolute; bottom: 0; left: 0; right: 0;
        height: 120px; background: linear-gradient(transparent, rgba(0,0,0,.6));
        pointer-events: none;
      }
      .overlay-right-center {
        position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
        display: flex; flex-direction: column; gap: 12px;
        pointer-events: auto; align-items: center;
      }
      .overlay-ctrl-btn {
        background: rgba(0,0,0,.55); border: none; border-radius: 50%;
        color: #ddd; width: 46px; height: 46px; font-size: 20px;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: background .15s, transform .1s; pointer-events: auto;
        box-shadow: 0 2px 8px rgba(0,0,0,.4);
      }
      .overlay-ctrl-btn:hover { background: rgba(0,0,0,.8); transform: scale(1.08); }
      .overlay-star-btn.active { color: gold; }
      .overlay-meta {
        position: absolute; bottom: 16px; left: 16px;
        max-width: 55%; pointer-events: none;
      }
      .overlay-author {
        font-size: 14px; font-weight: 600; color: #fff;
        text-shadow: 0 1px 4px rgba(0,0,0,.9);
        margin-bottom: 4px;
      }
      .overlay-caption {
        font-size: 12px; color: rgba(255,255,255,.85);
        text-shadow: 0 1px 3px rgba(0,0,0,.8);
        line-height: 1.4; display: -webkit-box;
        -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
      }
      .overlay-mute-btn {
        position: absolute; bottom: 14px; right: 14px; pointer-events: auto;
      }
      .overlay-counter {
        position: absolute; top: 16px; left: 50%; transform: translateX(-50%);
        font-size: 12px; color: rgba(255,255,255,.4); pointer-events: none;
      }
      .overlay-nav-btns {
        position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 8px; pointer-events: auto;
      }
      .overlay-nav-btn {
        width: 36px !important; height: 36px !important; font-size: 20px !important;
      }
      .overlay-nav-btn:disabled { opacity: .25; cursor: default; }

      @media (max-width: 768px) {
        #video-overlay { align-items: stretch; }
        #video-overlay-content {
          max-width: 100%; width: 100%; height: 100%;
          max-height: 100%;
        }
        .overlay-video { border-radius: 0; }
        .overlay-close { opacity: 1; }
        #video-overlay { bottom: 72px; } /* above bottom nav */
      }

      /* ── Player overlay ── */
      #player-overlay {
        position: fixed; inset: 0; z-index: 3000;
        background: #0d0d0d; display: flex; flex-direction: column;
      }
      #player-header {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 14px; background: #1a1a1a;
        border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
      }
      #player-title-group { flex: 1; display: flex; align-items: baseline; gap: 10px; justify-content: center; }
      #player-title { font-size: 15px; font-weight: 600; }
      #player-counter { font-size: 12px; color: #666; }
      #player-header-right { display: flex; align-items: center; gap: 6px; }
      .player-nav-btn {
        background: none; border: 1px solid #444; border-radius: 4px;
        color: #ccc; cursor: pointer; padding: 5px 13px; font-size: 16px; line-height: 1;
        transition: background .15s;
      }
      .player-nav-btn:hover { background: #2a2a2a; }
      .player-nav-btn:disabled { opacity: .3; cursor: default; }
      .player-header-btn {
        background: none; border: 1px solid #444; border-radius: 4px;
        color: #ccc; cursor: pointer; padding: 5px 8px;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      .player-header-btn:hover { background: #2a2a2a; color: #fff; }
      #player-stage { flex: 1; display: flex; min-height: 0; }
      .player-column {
        flex: 1; position: relative; background: #000;
        border-right: 1px solid #1a1a1a; overflow: hidden;
        display: flex; align-items: stretch;
      }
      .player-column:last-child { border-right: none; }
      .player-column-empty { background: #0a0a0a; }
      .player-video-wrap { flex: 1; position: relative; }
      .player-video { width: 100%; height: 100%; object-fit: contain; display: block; }
      .player-controls { position: absolute; inset: 0; pointer-events: none; }
      .player-right-center {
        position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
        display: flex; flex-direction: column; gap: 12px;
        pointer-events: auto; align-items: center;
      }
      .player-ctrl-btn {
        background: rgba(0,0,0,.6); border: none; border-radius: 50%;
        color: #ddd; width: 46px; height: 46px; font-size: 20px;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        transition: background .15s, transform .1s; pointer-events: auto;
        box-shadow: 0 2px 8px rgba(0,0,0,.5);
      }
      .player-ctrl-btn:hover { background: rgba(0,0,0,.85); transform: scale(1.08); }
      .player-star-btn.active { color: gold; }
      .player-lvl-btn { font-size: 11px; font-weight: 700; letter-spacing: .5px; }
      .player-lvl-btn.active { color: #fe2c55; }
      .player-author {
        position: absolute; bottom: 32px; left: 14px;
        font-size: 14px; font-weight: 600; pointer-events: none;
        text-shadow: 0 1px 4px rgba(0,0,0,.9); color: #fff;
        max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .player-caption {
        position: absolute; bottom: 14px; left: 14px;
        font-size: 12px; color: rgba(255,255,255,.85); pointer-events: none;
        text-shadow: 0 1px 3px rgba(0,0,0,.8);
        max-width: 55%; line-height: 1.4;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .player-mute-btn { position: absolute; bottom: 10px; right: 10px; pointer-events: auto; }

      /* Per-column navigation buttons — horizontal row on desktop */
      .player-col-nav {
        position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
        display: flex; flex-direction: row; gap: 8px;
        pointer-events: auto; align-items: center;
      }
      .player-col-nav-btn {
        width: 34px !important; height: 34px !important; font-size: 18px !important;
      }
      .player-col-nav-btn:disabled { opacity: .25; cursor: default; }

      /* Hotkey legend in header */
      #player-hotkeys {
        font-size: 11px; color: #444; letter-spacing: .5px; user-select: none;
        font-family: monospace; padding: 0 6px;
      }

      /* ── Mobile scroll-snap feed ── */
      #player-feed {
        flex: 1; overflow-y: scroll; overflow-x: hidden;
        scroll-snap-type: y mandatory;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
      }
      .player-slide {
        /* height set via JS after layout; scroll-snap handles full-view snapping */
        scroll-snap-align: start; scroll-snap-stop: always;
        position: relative; background: #000; overflow: hidden;
        flex-shrink: 0;
      }

      /* ── Responsive / mobile ── */

      /* Tablets and small desktops: tighten the star panel */
      @media (max-width: 768px) {
        /* Player: only first column visible */
        .player-column:not([data-col="0"]) { display: none; }
        /* Hotkeys are desktop-only */
        #player-hotkeys { display: none; }
        /* Hide header bar on mobile — bottom nav replaces it */
        #player-header { display: none !important; }
        /* Slightly bigger touch targets */
        .player-ctrl-btn { width: 52px; height: 52px; font-size: 22px; }
        .player-col-nav-btn { width: 42px !important; height: 42px !important; font-size: 20px !important; }
        /* Stars: hide sidebar, show compact mobile header instead */
        #stars-view { flex-direction: column; }
        #stars-sidebar { display: none !important; }
        #stars-main-header { display: none !important; }
        #stars-grid { padding: 10px 12px; gap: 10px; }
        /* ── Mobile stars: title-only header ── */
        #stars-main { position: relative; overflow: hidden; }
        #stars-mobile-header {
          display: flex; flex-direction: column; gap: 0;
          flex-shrink: 0; z-index: 10;
          padding: 12px 14px 10px;
          background: rgba(13,13,13,0.97);
          box-shadow: 0 2px 16px rgba(0,0,0,0.5);
          pointer-events: none; user-select: none;
        }
        #stars-mobile-header > :first-child { display: flex; align-items: center; }
        #stars-mobile-title {
          display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
          pointer-events: none;
        }
        #stars-mobile-title .stars-main-title {
          font-size: 18px; font-weight: 700; color: #fff;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #stars-mobile-title .stars-main-count { font-size: 12px; color: #666; flex-shrink: 0; }
        #stars-mobile-header .grid-controls { pointer-events: auto; flex-shrink: 0; }
        #stars-mobile-header > :first-child { flex-wrap: wrap; row-gap: 6px; }
        #stars-mobile-title { flex: 1 1 100%; }
        .grid-size { width: 56px; }
        .grid-controls { gap: 5px; }
        .grid-sort-btn { font-size: 11px; padding: 0 6px; }

        /* ── Filter buttons: fixed bottom-right stack (like player controls) ── */
        #stars-mobile-filters {
          position: fixed;
          bottom: calc(77px + env(safe-area-inset-bottom, 0px) + 16px);
          right: 14px;
          display: flex; flex-direction: column; gap: 10px;
          z-index: 210; pointer-events: auto;
          align-items: center;
        }
        .stars-filter-btn {
          width: 42px; height: 42px;
          background: rgba(20,20,20,0.82); border: 1px solid rgba(80,80,80,0.5);
          border-radius: 50%; color: #aaa; cursor: pointer;
          font-size: 18px; font-weight: 700; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          transition: color .15s, border-color .15s, background .15s;
          flex-shrink: 0; padding: 0;
        }
        .stars-filter-btn.active { color: #fff; border-color: rgba(255,255,255,0.6); background: rgba(60,60,60,0.92); }
        .stars-filter-btn.stars-filter-thumb-up.active  { color: #4caf50; border-color: #4caf50; }
        .stars-filter-btn.stars-filter-thumb-down.active { color: #f44336; border-color: #f44336; }

        /* ── Group picker: bottom sheet ── */
        #stars-mobile-groups-wrap {
          position: fixed;
          bottom: calc(77px + env(safe-area-inset-bottom, 0px));
          left: 0; right: 0;
          max-height: 52vh;
          overflow-y: auto; -webkit-overflow-scrolling: touch;
          background: rgba(13,13,13,0.97);
          padding: 14px 14px 18px;
          z-index: 209; border-top: 1px solid #2a2a2a;
          pointer-events: auto; scrollbar-width: none;
        }
        #stars-mobile-groups-wrap::-webkit-scrollbar { display: none; }
        #stars-mobile-groups { display: flex; flex-wrap: wrap; gap: 8px; }
        .stars-mobile-group-pill {
          background: rgba(35,35,35,0.9); border: 1px solid rgba(70,70,70,0.6);
          border-radius: 20px; color: #888; cursor: pointer; padding: 5px 13px;
          font-size: 12px; white-space: nowrap;
          transition: color .15s, border-color .15s, background .15s;
        }
        .stars-mobile-group-pill.active { color: #fff; border-color: rgba(255,255,255,0.5); background: rgba(55,55,55,0.95); }
        /* ── Lvl number strip ── */
        #stars-mobile-lvl-strip {
          display: flex; gap: 6px; overflow-x: auto; padding: 8px 0 6px;
          scrollbar-width: none; pointer-events: auto; flex-shrink: 0;
        }
        #stars-mobile-lvl-strip::-webkit-scrollbar { display: none; }
        .stars-filter-lvl-num {
          min-width: 34px; padding: 5px 8px; font-size: 13px; border-radius: 8px;
        }

        /* ── Recents grid (mobile) ── */
        #recents-grid-view {
          position: fixed; inset: 0;
          bottom: calc(77px + env(safe-area-inset-bottom, 0px));
          z-index: 500; background: #0d0d0d;
          flex-direction: column; overflow-y: auto;
          -webkit-overflow-scrolling: touch;
        }
        #recents-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2px; padding: 2px;
        }
        .recents-card { position: relative; }
        /* reuse stars-grid-cover for the cover wrapper */
        .recents-cover-wrap { border-radius: 0; }
        /* always show star + group buttons on mobile (no hover) */
        .recents-cover-wrap .stars-grid-remove,
        .recents-cover-wrap .stars-grid-add-group { opacity: 0.8 !important; }
        .recents-star-btn { font-size: 13px !important; }
        .recents-star-active { color: #ffe234 !important; }
        #recents-grid-loading {
          flex: 1; display: flex; align-items: center; justify-content: center;
          color: #555; font-size: 15px;
        }
        /* ── Recents: stats button (bottom-right, like stars filters) ── */
        #recents-stats-btn {
          position: fixed;
          bottom: calc(77px + env(safe-area-inset-bottom, 0px) + 16px);
          right: 14px; z-index: 210;
          width: 42px; height: 42px; border-radius: 50%;
          background: rgba(20,20,20,0.82); border: 1px solid rgba(80,80,80,0.5);
          color: #fff; font-size: 18px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        }
        /* ── Recents: stats bottom sheet ── */
        #recents-stats-overlay {
          position: fixed;
          bottom: calc(77px + env(safe-area-inset-bottom, 0px));
          left: 0; right: 0;
          background: rgba(13,13,13,0.97);
          padding: 14px 16px 18px; z-index: 209;
          border-top: 1px solid #2a2a2a;
          font-size: 14px; display: none;
          pointer-events: auto;
        }
        #recents-stats-overlay.recents-stats-open { display: block; }

        /* ── Hide star bubble on mobile ── */
        #star-toggle { display: none !important; }

        /* ── Mobile player: fixed full-screen view (display toggled via JS) ── */
        #player-view {
          position: fixed; inset: 0; bottom: 72px; z-index: 3000;
          background: #0d0d0d; flex-direction: column;
          /* display controlled entirely by JS (style.display = 'flex' / 'none') */
        }
        #player-view-loading {
          flex: 1; display: flex; align-items: center; justify-content: center;
          color: #666; font-size: 15px;
        }
        #player-view-header {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; background: #1a1a1a;
          border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
        }
        #player-view-back {
          background: none; border: 1px solid #444; border-radius: 4px;
          color: #ccc; cursor: pointer; padding: 5px 10px; font-size: 13px;
        }
        #player-view #player-counter { font-size: 12px; color: #666; flex: 1; text-align: center; }
        #player-view #player-feed { flex: 1; min-height: 0; }

        /* ── Collapse header on mobile; nav is position:fixed so escapes overflow:hidden ── */
        header {
          height: 0 !important; min-height: 0 !important;
          padding: 0 !important; margin: 0 !important;
          border: none !important; background: transparent !important;
          overflow: hidden !important;
        }

        /* ── Prevent text selection during swipes ── */
        #sp-mobile-nav, #sp-swipe-hint, #player-view, #stars-view,
        .sp-nav-btn, #stars-mobile-header {
          user-select: none; -webkit-user-select: none;
        }

        /* ── Hide original React nav entirely on mobile ── */
        nav { display: none !important; }

        /* ── Custom bottom nav bar ── */
        #sp-mobile-nav {
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 600;
          background: #1a1a1a; border-top: 1px solid #2a2a2a;
          display: flex; height: 72px; align-items: stretch;
          padding-bottom: 10px; box-sizing: border-box;
        }
        .sp-nav-btn {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 3px; background: none; border: none;
          color: #555; font-size: 10px; cursor: pointer;
          border-top: 3px solid transparent; transition: color .15s;
          padding: 5px 4px 3px;
        }
        .sp-nav-btn.sp-active { color: #fff; border-top-color: #fff; }
        .sp-nav-btn svg { flex-shrink: 0; }

        /* ── Swipe hint indicator ── */
        #sp-swipe-hint {
          position: fixed; top: 50%; transform: translateY(-50%);
          background: rgba(40,40,40,0.85); backdrop-filter: blur(10px);
          color: #fff; display: flex; align-items: center; gap: 6px;
          padding: 10px 16px; z-index: 700; pointer-events: none;
          opacity: 0; font-size: 14px; font-weight: 600;
          border: 1px solid rgba(255,255,255,0.12);
          transition: opacity 0.05s;
        }
        .sp-sh-arrow { font-size: 22px; line-height: 1; }

        /* ── View entrance animations ── */
        @keyframes sp-enter-from-right { from { transform: translateX(100vw); } to { transform: translateX(0); } }
        @keyframes sp-enter-from-left  { from { transform: translateX(-100vw); } to { transform: translateX(0); } }
        .sp-enter-from-right { animation: sp-enter-from-right 0.25s cubic-bezier(0.4,0,0.2,1) both; }
        .sp-enter-from-left  { animation: sp-enter-from-left  0.25s cubic-bezier(0.4,0,0.2,1) both; }

        /* Push all page content above the fixed bottom nav */
        body { padding-bottom: 72px !important; }
        /* Stars view: fixed full-screen overlay (avoids dead space from header parent) */
        #stars-view {
          position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important;
          bottom: 72px !important; max-height: none !important; z-index: 500;
        }
        /* ── Mobile card grid layout ── */
        main { overflow-x: hidden !important; }
        main > * { min-width: 0 !important; }

        /* Hide header row (column titles) on mobile */
        main [style*="position: absolute"][style*="height: 40px"] { display: none !important; }

        /* Card rows: fill width, show cover as card */
        .mobile-card-row {
          border-radius: 8px !important; overflow: hidden !important;
        }
        .mobile-card-row > .text,
        .mobile-card-row > .column-titles { display: none !important; }

        /* Cover fills the card */
        div.cover {
          width: 100% !important; height: 100% !important;
          border-radius: 8px !important; overflow: hidden !important;
        }
        div.cover img.thumbnail {
          width: 100% !important; height: 100% !important;
          object-fit: cover !important; border-radius: 8px !important;
        }

        /* Hide all text columns — card shows only cover + overlay */
        div.cover ~ * { display: none !important; }

        /* Caption overlay injected by applyMobileCards() */
        .sp-cap {
          position: absolute; bottom: 0; left: 0; right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,.85));
          color: #fff; font-size: 10px; line-height: 1.35;
          padding: 20px 6px 6px; white-space: pre-line;
          pointer-events: none; z-index: 5;
          overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 3; -webkit-box-orient: vertical;
        }

        /* Metadata overlay (like count, date) */
        .sp-meta {
          position: absolute; top: 4px; left: 4px;
          font-size: 9px; color: rgba(255,255,255,.7);
          text-shadow: 0 1px 2px rgba(0,0,0,.8);
          pointer-events: none; z-index: 5;
        }

        /* Explain button: hide via CSS as belt-and-suspenders */
        [class*="explain"], [id*="explain"] { display: none !important; }
      }

      /* Phones: star panel and toggle sit above the bottom nav */
      @media (max-width: 480px) {
        #star-panel {
          width: calc(100vw - 24px);
          right: 12px; left: 12px; bottom: 74px;
        }
        #star-toggle { bottom: 70px; right: 12px; }
        /* Smaller grid min so more columns fit */
        #stars-grid { grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); }

        /* ── Mobile player: controls fixed to overlay, not scrolling with slide ── */
        #player-overlay { overflow: hidden; }
        .player-controls { display: none; }    /* hide per-slide controls */
        #player-overlay-controls {              /* single fixed controls layer */
          position: absolute; inset: 0; pointer-events: none; z-index: 10;
        }
        #player-overlay-controls .player-right-center {
          position: absolute; right: 10px; bottom: 120px;
          top: auto; transform: none;
          display: flex; flex-direction: column; gap: 10px;
          pointer-events: auto; align-items: center;
        }
        #player-overlay-controls .player-ctrl-btn {
          width: 41px; height: 41px; font-size: 18px;
        }
        #player-overlay-controls .player-author {
          position: absolute; bottom: 32px; left: 12px;
          font-size: 13px; font-weight: 600; pointer-events: none;
          text-shadow: 0 1px 4px rgba(0,0,0,.9); color: #fff;
          max-width: 58%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        #player-overlay-controls .player-caption {
          position: absolute; bottom: 14px; left: 12px;
          font-size: 11px; color: rgba(255,255,255,.85); pointer-events: none;
          text-shadow: 0 1px 3px rgba(0,0,0,.8);
          max-width: 58%; line-height: 1.4;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        #player-overlay-controls .player-mute-btn {
          position: absolute; bottom: 14px; right: 10px;
          pointer-events: auto; width: 41px; height: 41px; font-size: 18px;
        }
        #player-overlay-controls .player-overlay-close {
          position: absolute; top: 10px; right: 10px;
          pointer-events: auto; width: 36px; height: 36px; font-size: 18px;
          background: rgba(0,0,0,0.45); border: none; color: #fff;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
        }
        #player-overlay-controls .player-thumb-up.active  { color: #4caf50; }
        #player-overlay-controls .player-thumb-down.active { color: #f44336; }

        /* Safe area inset for iPhone home indicator */
        #sp-mobile-nav {
          padding-bottom: calc(15px + env(safe-area-inset-bottom, 0px)) !important;
          height: calc(77px + env(safe-area-inset-bottom, 0px)) !important;
        }
        body { padding-bottom: calc(77px + env(safe-area-inset-bottom, 0px)) !important; }
        #stars-view {
          bottom: calc(77px + env(safe-area-inset-bottom, 0px)) !important;
        }
      }

      /* Very small phones: 2-col star panel grid */
      @media (max-width: 360px) {
        #star-panel-grid { grid-template-columns: repeat(2, 1fr); }
      }

      /* ═══ PHONE UI v2: edge-to-edge feed, white icon buttons, seek bar above the tab bar ═══ */
      .sp-seek { display: none; }
      @media (max-width: 768px) {
        :root {
          --sp-nav-h: calc(77px + env(safe-area-inset-bottom, 0px));
          --sp-top: env(safe-area-inset-top, 0px);
        }
        html, body { background: #000; }

        /* tab bar: black, white icons, the active tab full white */
        #sp-mobile-nav {
          background: #000 !important; border-top: 1px solid rgba(255,255,255,.14) !important;
          height: var(--sp-nav-h) !important;
        }
        .sp-nav-btn { color: rgba(255,255,255,.55); border-top: none !important; font-weight: 600; }
        .sp-nav-btn.sp-active { color: #fff; }
        .sp-nav-btn svg { width: 25px; height: 25px; }

        /* every full-screen view stops at the tab bar and keeps clear of the notch */
        #player-view { bottom: var(--sp-nav-h) !important; background: #000; }
        #author-view, #autotag-view, #recents-grid-view { bottom: var(--sp-nav-h) !important; padding-top: var(--sp-top); box-sizing: border-box; }
        #stars-view { bottom: var(--sp-nav-h) !important; padding-top: var(--sp-top) !important; box-sizing: border-box; }
        #author-view { box-shadow: -10px 0 28px rgba(0,0,0,.55); will-change: transform; }
        #player-view { will-change: transform; }

        /* video fills the screen; only landscape clips letterbox */
        #player-feed { background: #000; }
        #player-view .player-video { object-fit: cover; }
        #player-view .player-video.sp-wide { object-fit: contain; }
        .player-slide.sp-paused::before {
          content: ''; position: absolute; top: 50%; left: 50%; z-index: 3;
          transform: translate(-30%, -50%); pointer-events: none;
          border-style: solid; border-width: 28px 0 28px 48px;
          border-color: transparent transparent transparent rgba(255,255,255,.8);
          filter: drop-shadow(0 2px 6px rgba(0,0,0,.5));
        }

        /* soft shade behind the white text and icons */
        #player-view #player-overlay-controls::before {
          content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 280px;
          background: linear-gradient(to top, rgba(0,0,0,.6), rgba(0,0,0,0)); pointer-events: none;
        }
        #player-view #player-overlay-controls::after {
          content: ''; position: absolute; left: 0; right: 0; top: 0; height: calc(var(--sp-top) + 90px);
          background: linear-gradient(to bottom, rgba(0,0,0,.4), rgba(0,0,0,0)); pointer-events: none;
        }

        /* action buttons: plain white icons, no circles */
        #player-view #player-overlay-controls .player-ctrl-btn {
          background: none !important; box-shadow: none !important; border-radius: 0;
          width: 48px; height: 48px; font-size: 32px; line-height: 1; color: #fff; padding: 0;
          filter: drop-shadow(0 1px 3px rgba(0,0,0,.65)); transform: none !important;
        }
        #player-view #player-overlay-controls .player-ctrl-btn svg { width: 32px; height: 32px; }
        #player-view #player-overlay-controls .player-lvl-btn { font-size: 17px; font-weight: 800; }
        #player-view #player-overlay-controls .player-star-btn.active { color: gold; }
        #player-view #player-overlay-controls .player-ctrl-btn.braces-on { color: #4fc3f7; }
        #player-view #player-overlay-controls .player-right-center {
          right: 6px; bottom: 30px; gap: 4px; z-index: 1;
        }
        #player-view #player-overlay-controls .player-mute-btn {
          top: calc(var(--sp-top) + 8px); right: 6px; bottom: auto; width: 44px; height: 44px;
        }
        #player-view #player-overlay-controls .player-mute-btn svg { width: 24px; height: 24px; }
        #player-view #player-overlay-controls .player-overlay-close {
          top: calc(var(--sp-top) + 8px); left: 6px; right: auto; width: 44px; height: 44px; font-size: 24px;
        }
        #player-view #player-overlay-controls .player-feed-mode {
          top: calc(var(--sp-top) + 14px); left: 50%; transform: translateX(-50%);
          background: none; color: #fff; font-weight: 700; font-size: 15px;
          text-shadow: 0 1px 4px rgba(0,0,0,.7);
        }

        /* who and what, bottom-left like the reference */
        #player-view #player-overlay-controls .player-author {
          bottom: 70px; left: 14px; font-size: 17px; font-weight: 700; max-width: calc(100% - 90px);
        }
        #player-view #player-overlay-controls .player-caption {
          bottom: 22px; left: 14px; font-size: 14px; color: #fff; max-width: calc(100% - 90px);
        }

        /* seek bar: a hairline along the bottom that grows under the finger */
        .sp-seek {
          display: block; position: absolute; left: 0; right: 0; bottom: 0; height: 26px;
          z-index: 12; pointer-events: auto; touch-action: none; cursor: pointer;
        }
        .sp-seek-track { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgba(255,255,255,.28); transition: height .12s; }
        .sp-seek-fill { height: 100%; width: 0; background: #fff; }
        .sp-seek.scrubbing .sp-seek-track { height: 8px; }
        .sp-seek-time {
          position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%);
          font-size: 13px; font-weight: 700; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.8);
          opacity: 0; transition: opacity .12s; pointer-events: none;
        }
        .sp-seek.scrubbing .sp-seek-time { opacity: 1; }
      }
    `;
    document.head.appendChild(s);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    injectStyles();
    createToggleBtn();

    function tryInject() {
      if (document.querySelector('nav .following')) {
        injectNavTabs();
        startObserving();
      } else {
        setTimeout(tryInject, 200);
      }
    }
    tryInject();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
