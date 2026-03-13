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

  function saveStars()  { saveStarsLocal();  syncToServer(); }
  function saveGroups() { saveGroupsLocal(); syncToServer(); }
  function saveLevels() { saveLevelsLocal(); syncToServer(); }

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
        const { s, g, l } = e.data || {};
        if (s) { stars  = s;  saveStarsLocal();  refreshAllButtons(); updateToggleBtn(); }
        if (g) { groups = g;  saveGroupsLocal(); }
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

  function getVideoInfo(videoId) {
    const id   = String(videoId);
    const data = findArchiveData();
    if (!data) return { desc: '', authorName: '' };

    const desc = (data.videoDescriptions[id] || data.videoDescriptions[videoId]) || '';
    const v    = data.videos[id] || data.videos[videoId];
    const a    = v && data.authors && data.authors[v.authorId];
    const authorName = (a && a.uniqueIds && a.uniqueIds[0]) || '';
    return { desc, authorName };
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
  }

  // Intercept thumbnail clicks to open our overlay instead of React's player.
  // We attach on BOTH the cover div AND the thumbnail img in the capture phase
  // with stopImmediatePropagation to ensure React's handlers never fire.
  function interceptCoverClick(coverDiv) {
    if (coverDiv._overlayBound) return;
    coverDiv._overlayBound = true;

    function handleClick(e) {
      // Don't intercept star button or other control clicks
      if (e.target.closest('.star-btn') || e.target.closest('.overlay-ctrl-btn')) return;
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
    if (starsTabActive && starsContextList.length > 0) {
      const idx = starsContextList.findIndex(v => v.id === videoId);
      openVideoOverlay(idx >= 0 ? idx : 0, starsContextList);
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
      playerReturnTab = activeMobileTab === 'stars' ? 'stars'
                     : activeMobileTab === 'recents' ? 'recents'
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
      authEl.textContent = '@' + authorName;
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
        const { desc, authorName } = getVideoInfo(star.id);
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
          a.textContent = '@' + authorName;
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
  // STARS TAB — NAV + CONTENT
  // ═══════════════════════════════════════════════════════════════════════════

  let starsTabActive = false;
  let starsViewEl    = null;
  let activeView       = null;        // null | '__lvl_groups__' | '__ungrouped__'
  let activeGroupIds   = new Set();   // empty = all stars; non-empty = union of selected groups
  let activeLvl        = new Set();   // empty = no filter; set of numbers = multi-select
  let lvlSectionOpen   = true;
  let mobileStarsLvlOpen = false;     // mobile: whether inline lvl strip is visible
  let mobileStarsGroupsOpen = false;  // mobile: whether group picker panel is expanded
  let groupSortOrder   = 'alpha';     // 'alpha' | 'count'
  let starsContextList = [];        // mirrors the currently rendered video grid order

  function showStarsTab() {
    starsTabActive = true;
    if (!isMobilePlayer()) closePlayer();
    document.querySelector('main')?.style.setProperty('display', 'none');
    toggleBtn.style.display = 'none';
    closePanel();

    if (isMobilePlayer()) { activeMobileTab = 'stars'; updateMobileNavActive(); }
    else {
      document.querySelectorAll('nav .active').forEach(el => el.classList.remove('active'));
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
    starsTabActive = false;
    document.querySelector('main')?.style.removeProperty('display');
    toggleBtn.style.display = '';
    if (starsViewEl) starsViewEl.style.display = 'none';
    if (!isMobilePlayer()) document.querySelector('nav .stars-tab')?.classList.remove('active');
  }

  function renderStarsView() {
    if (!starsViewEl) return;
    starsViewEl.innerHTML = '';

    // ── Sidebar ──────────────────────────────────────────────────────────────
    const sidebar = document.createElement('div');
    sidebar.id = 'stars-sidebar';

    function makeSidebarItem(id, label, count) {
      let isActive;
      if      (id === '__lvl_groups__') isActive = activeView === '__lvl_groups__';
      else if (id === '__ungrouped__')  isActive = activeView === '__ungrouped__';
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

    // ── All Stars ─────────────────────────────────────────────────────────────
    const allItem = makeSidebarItem('all', 'All Stars', Object.keys(stars).length);
    allItem.addEventListener('click', () => { activeView = null; activeGroupIds.clear(); renderStarsView(); });
    sidebar.appendChild(allItem);

    // ── Ungrouped ─────────────────────────────────────────────────────────────
    const groupedIds = new Set(groups.flatMap(g => g.videoIds));
    const ungroupedStarCount  = Object.keys(stars).filter(id => !groupedIds.has(id)).length;
    const ungroupedLvlCount   = Object.keys(levels).filter(id => !stars[id] && !groupedIds.has(id)).length;
    const ungroupedTotal      = ungroupedStarCount + ungroupedLvlCount;
    const ungroupedItem = makeSidebarItem('__ungrouped__', 'Ungrouped', ungroupedTotal);
    ungroupedItem.addEventListener('click', () => { activeView = '__ungrouped__'; activeGroupIds.clear(); renderStarsView(); });
    sidebar.appendChild(ungroupedItem);

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
    } else if (activeView === '__ungrouped__') {
      // ── Ungrouped view (ungrouped stars + lvl-only videos) ───────────────────
      const groupedIdsSet = new Set(groups.flatMap(g => g.videoIds));
      const ungroupedStars = Object.entries(stars)
        .filter(([id]) => !groupedIdsSet.has(id))
        .map(([key, s]) => ({ ...s, id: key }));
      const lvlOnlyVideos = Object.entries(levels)
        .filter(([id]) => !stars[id] && levels[id] != null && !groupedIdsSet.has(id))
        .map(([id, n]) => ({
          id,
          coverSrc: `data/Likes/covers/${id}.jpg`,
          authorName: '', desc: '', lvlOnly: true
        }));
      const baseVideos = [...ungroupedStars, ...lvlOnlyVideos];
      const videosToShow = activeLvl.size > 0
        ? baseVideos.filter(s => activeLvl.has(levels[s.id]))
        : baseVideos;

      mainHeader.innerHTML =
        `<span class="stars-main-title">Ungrouped</span>` +
        `<span class="stars-main-count">${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}</span>`;
      mobileTitle.innerHTML =
        `<span class="stars-main-title">Ungrouped</span><span class="stars-main-count">${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}</span>`;

      starsContextList = videosToShow.map(s => starItemToCtx(s.lvlOnly ? s : (stars[s.id] || s)));
      if (!videosToShow.length) {
        const empty = document.createElement('div');
        empty.id = 'stars-empty';
        empty.textContent = 'No ungrouped videos.';
        grid.appendChild(empty);
      } else {
        videosToShow.forEach(star => {
          const { desc, authorName } = star.lvlOnly ? { desc: '', authorName: '' } : getVideoInfo(star.id);
          const onRemove = star.lvlOnly
            ? () => { delete levels[star.id]; saveLevels(); renderStarsView(); }
            : null;
          grid.appendChild(buildStarsGridCard(star, authorName, desc, onRemove));
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
            .map(([id]) => ({ id, coverSrc: `data/Likes/covers/${id}.jpg`, authorName: '', desc: '', lvlOnly: true }));
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
              baseVideos.push({ id, coverSrc: `data/Likes/covers/${id}.jpg`, authorName: '', desc: '', lvlOnly: true });
            }
          });
        });
      }

      const videosToShow = activeLvl.size > 0
        ? baseVideos.filter(s => activeLvl.has(levels[s.id]))
        : baseVideos;

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

      starsContextList = videosToShow.map(s => starItemToCtx(s.lvlOnly ? s : (stars[s.id] || s)));
      if (!videosToShow.length) {
        const empty = document.createElement('div');
        empty.id = 'stars-empty';
        empty.innerHTML = isAll
          ? 'No starred videos yet.<br>Click ★ on any video in Likes, Favorites, or Following.'
          : 'No videos in this group yet.<br>Star videos and use ⊕ to add them here.';
        grid.appendChild(empty);
      } else {
        videosToShow.forEach(star => {
          const { desc, authorName } = star.lvlOnly ? { desc: '', authorName: '' } : getVideoInfo(star.id);
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
          grid.appendChild(buildStarsGridCard(star, authorName, desc, onRemove));
        });
      }
    }

    mainArea.appendChild(grid);
    starsViewEl.appendChild(mainArea);
  }

  function buildStarsGridCard(star, authorName, desc, onRemoveOverride) {
    const card = document.createElement('div');
    card.className = 'stars-grid-card';

    const cover = document.createElement('div');
    cover.className = 'stars-grid-cover';
    cover.addEventListener('click', () => openVideo(star.coverSrc));

    const img = document.createElement('img');
    img.src = star.coverSrc;
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; };
    cover.appendChild(img);

    const rmBtn = document.createElement('button');
    rmBtn.className = 'stars-grid-remove';
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
    cover.appendChild(rmBtn);

    if ((isGlobalView || activeView === '__ungrouped__' || isInGroup) && groups.length > 0) {
      const addBtn = document.createElement('button');
      addBtn.className = 'stars-grid-add-group';
      addBtn.title = 'Add to group';
      addBtn.textContent = '⊕';
      addBtn.addEventListener('click', e => { e.stopPropagation(); showGroupPicker(addBtn, star.id); });
      cover.appendChild(addBtn);
    }

    card.appendChild(cover);
    if (authorName) {
      const a = document.createElement('div');
      a.className = 'stars-grid-author';
      a.textContent = '@' + authorName;
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
  let playerColumnOffsets  = [];   // one index per column, independently navigable
  let playerBuilding       = false;
  let playerViewEl         = null;  // mobile tab-view element (like starsViewEl)
  let playerReturnTab      = null;  // tab to return to when player is closed via X button
  let playerStartId        = null;  // if set, player will start at this video ID
  let recentsGridEl        = null;  // custom recents grid element
  let recentsGridBuilt     = false; // true once grid has been populated

  // ── Mobile tab state ───────────────────────────────────────────────────────
  const MOBILE_TABS = ['home', 'stars', 'recents', 'favs'];
  let activeMobileTab = 'home';

  function updateMobileNavActive() {
    document.querySelectorAll('#sp-mobile-nav .sp-nav-btn').forEach(btn => {
      btn.classList.toggle('sp-active', btn.dataset.tab === activeMobileTab);
    });
  }

  function setMobileTab(tab, skipAnim) {
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

  function createMobileNav() {
    if (document.getElementById('sp-mobile-nav')) return;
    const nav = document.createElement('div');
    nav.id = 'sp-mobile-nav';
    const tabs = [
      { id: 'home',    label: 'Home',    svg: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>' },
      { id: 'stars',   label: 'Stars',   svg: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>' },
      { id: 'recents', label: 'Recents', svg: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L11 13.5V7h1.5v5.87l4.75 2.82-1.01 1.74z"/>' },
      { id: 'favs',    label: 'Favs',    svg: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' },
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

  const TAB_LABELS = { home: 'Home', stars: 'Stars', recents: 'Recents', favs: 'Favs' };

  function getSwipeViewEl() {
    if (activeMobileTab === 'home')    return playerViewEl;
    if (activeMobileTab === 'stars')   return document.getElementById('stars-view');
    if (activeMobileTab === 'recents') return recentsGridEl;
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

  function setupMobileSwipe() {
    initSwipeHint();
    let _tsx = 0, _tsy = 0, _swipeDir = null, _swiping = false, _outEl = null;

    document.addEventListener('touchstart', e => {
      _tsx = e.touches[0].clientX;
      _tsy = e.touches[0].clientY;
      _swipeDir = null; _swiping = false;
      _outEl = getSwipeViewEl();
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      const dx = e.touches[0].clientX - _tsx;
      const dy = e.touches[0].clientY - _tsy;
      if (!_swipeDir && (Math.abs(dx) > 8 || Math.abs(dy) > 8))
        _swipeDir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (_swipeDir !== 'h') return;
      const idx = MOBILE_TABS.indexOf(activeMobileTab);
      if ((dx < 0 && idx >= MOBILE_TABS.length - 1) || (dx > 0 && idx <= 0)) return;
      _swiping = true;
      if (_outEl) _outEl.style.transform = `translateX(${dx * 0.35}px)`;
      showSwipeHint(dx, idx);
    }, { passive: true });

    document.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _tsx;
      const dy = e.changedTouches[0].clientY - _tsy;
      hideSwipeHint();
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
    }, { passive: true });
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

    // Shuffle
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }

    console.log('[Player] total videos:', list.length);
    playerBuilding = false;
    return list;
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

        // ── Build stats directly from window.E (no DOM cloning needed) ──────
        const E = window.E;
        const total      = (E && E.likes && E.likes.total)                  || ids.length;
        const downloaded = (E && E.likes && E.likes.downloaded && E.likes.downloaded.size) || 0;

        // disappeared = downloaded videos no longer in officialList
        let disappeared = 0;
        if (E && E.likes && E.likes.downloaded && E.likes.officialList) {
          const offSet = new Set(E.likes.officialList);
          disappeared = [...E.likes.downloaded].filter(n => !offSet.has(n)).length;
        }

        // date from lastRun
        let lastRunDate = null;
        if (E && E.likes && E.likes.lastRun) {
          const { start, finish } = E.likes.lastRun;
          const ts = Math.max(start || 0, finish || 0);
          if (ts > 0) lastRunDate = ts;
        }

        // ── Find Redux dispatch to fire click_disappeared_video_count ────────
        function findDispatch() {
          const rootEl = [document.getElementById('archive'), document.querySelector('main'), document.body]
            .filter(Boolean).find(el => Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')));
          if (!rootEl) return null;
          const rootKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
          const stack = [rootEl[rootKey]]; let walked = 0;
          while (stack.length && walked < 200000) {
            const fiber = stack.pop(); if (!fiber) continue; walked++;
            const val = fiber.memoizedProps && fiber.memoizedProps.value;
            if (val && typeof val.dispatch === 'function' && typeof val.getState === 'function') return val.dispatch;
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

  async function openPlayer() {
    if (starsTabActive) showMainContent();

    if (isMobilePlayer()) {
      // Mobile: show loading screen, build list, then scroll-snap feed
      playerOpen = true;
      activeMobileTab = 'home'; updateMobileNavActive();
      showMobilePlayerLoading();
      playerVideoList = await buildVideoList();
      if (!playerOpen) { hideMobilePlayerView(); return; }
      // If a specific video was requested (e.g. tapped from recents grid), put it first
      if (playerStartId) {
        const si = playerVideoList.findIndex(v => v.id === playerStartId);
        if (si > 0) { const [it] = playerVideoList.splice(si, 1); playerVideoList.unshift(it); }
        playerStartId = null;
      }
      playerColumnOffsets = [0];
      renderMobilePlayerContent();
    } else {
      // Desktop: build list and open a new pop-out window each time
      playerVideoList = await buildVideoList();
      if (playerVideoList.length > 0) {
        popoutPlayer(playerVideoList, 0);
      }
    }
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
    if (!playerViewEl) return;
    // Pause any playing videos before hiding
    playerViewEl.querySelectorAll('video').forEach(v => v.pause());
    playerViewEl.style.display = 'none';
    playerViewEl.innerHTML = '';
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
    const renderList = total > MOBILE_CAP ? playerVideoList.slice(0, MOBILE_CAP) : playerVideoList;
    if (counter && total > MOBILE_CAP) {
      counter.title = `Showing first ${MOBILE_CAP} of ${total}`;
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
    muteBtn.addEventListener('click', e => {
      e.stopPropagation();
      currentMuted = !currentMuted;
      if (currentVid) currentVid.muted = currentMuted;
      muteBtn.innerHTML = muteIcon(currentMuted);
      muteBtn.title = currentMuted ? 'Unmute' : 'Mute';
    });

    rightCenter.appendChild(thumbUpBtn);
    rightCenter.appendChild(thumbDownBtn);
    rightCenter.appendChild(starBtn);
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
        setMobileTab(playerReturnTab);
        playerReturnTab = null;
      });
      ctrlLayer.appendChild(closeBtn);
    }

    overlay.appendChild(ctrlLayer);

    // Called by IntersectionObserver each time a new slide becomes dominant
    function updateControls(item, vid) {
      currentItem = item;
      currentVid  = vid;
      vid.muted   = currentMuted;

      thumbUpBtn.classList.toggle('active', inQuickGroup(item.id, 'liked'));
      thumbDownBtn.classList.toggle('active', inQuickGroup(item.id, 'disliked'));

      starBtn.classList.toggle('active', Boolean(stars[item.id]));
      starBtn.title = stars[item.id] ? 'Remove from Stars' : 'Add to Stars';

      lvlBtn.textContent = levels[item.id] != null ? String(levels[item.id]) : 'lvl';
      lvlBtn.classList.toggle('active', levels[item.id] != null);

      const info    = getVideoInfo(item.id);
      const name    = info.authorName || item.authorName || '';
      const caption = info.desc || '';
      authorEl.textContent  = name ? '@' + name : '';
      captionEl.textContent = caption.length > 120 ? caption.slice(0, 120) + '…' : caption;
    }
    // ── End fixed controls layer ─────────────────────────────────────────────

    const videoEls = [];

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
      video.addEventListener('ended',   () => { video.currentTime = 0; video.play().catch(() => {}); });
      video.addEventListener('contextmenu', e => { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); });

      let _stx = 0, _sty = 0;
      slide.addEventListener('touchstart', e => { _stx = e.touches[0].clientX; _sty = e.touches[0].clientY; }, { passive: true });
      slide.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - _stx;
        const dy = e.changedTouches[0].clientY - _sty;
        // Tap only — overlay handles horizontal swipe, feed handles vertical scroll
        if (Math.abs(dx) < 15 && Math.abs(dy) < 15) {
          video.paused ? video.play().catch(() => {}) : video.pause();
        }
      }, { passive: true });

      slide.appendChild(video);
      feed.appendChild(slide);
      videoEls.push(video);
    });

    // Size each slide to exactly fill the feed container (resolved after layout)
    const setSlideHeights = () => {
      const h = feed.clientHeight;
      if (h > 0) {
        feed.querySelectorAll('.player-slide').forEach(s => { s.style.height = h + 'px'; });
      } else {
        requestAnimationFrame(setSlideHeights);
      }
    };
    requestAnimationFrame(setSlideHeights);

    // Restore last-viewed position without animation
    const startIdx = playerColumnOffsets[0] || 0;
    if (startIdx > 0 && feed.children[startIdx]) {
      feed.children[startIdx].scrollIntoView({ behavior: 'instant' });
    }

    const rendered = renderList.length;

    // IntersectionObserver: play the centered slide, pause everything else
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const idx = parseInt(entry.target.dataset.idx);
        const vid = videoEls[idx];
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          playerColumnOffsets[0] = idx;
          updateControls(renderList[idx], vid);
          vid.play().catch(() => {});
          if (counter) counter.textContent = `${idx + 1} / ${rendered}`;
        } else {
          vid.pause();
        }
      });
    }, { threshold: 0.6 });

    feed.querySelectorAll('.player-slide').forEach(s => io.observe(s));

    // Kick off the starting video
    updateControls(renderList[startIdx], videoEls[startIdx]);
    videoEls[startIdx]?.play().catch(() => {});
    if (counter) counter.textContent = `${startIdx + 1} / ${rendered}`;
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
.blvl{font-size:12px;font-weight:700;letter-spacing:-.5px}
.bgrp svg{pointer-events:none}
.scrim{position:absolute;bottom:0;left:0;right:0;height:180px;background:linear-gradient(transparent,rgba(0,0,0,.8));pointer-events:none}
.meta{position:absolute;bottom:12px;left:12px;max-width:calc(100% - 70px);pointer-events:none}
.au{font-size:13px;font-weight:600;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.9);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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

  document.getElementById('au').textContent=item.authorName?'@'+item.authorName:'';
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

  function makeNavTab(className, svgPath, label, onClick) {
    const tab = document.createElement('div');
    tab.className = className + ' pressable';
    tab.innerHTML =
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="flex-shrink:0">${svgPath}</svg>${label}`;
    tab.addEventListener('click', onClick);
    return tab;
  }

  function injectNavTabs() {
    const nav = document.querySelector('nav');
    if (!nav) return;

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
          'Player',
          () => {
            if (isMobilePlayer()) {
              if (!playerOpen) openPlayer(); else closePlayer();
            } else {
              openPlayer(); // always launches a new pop-out on desktop
            }
          }
        );
        if (playerOpen) tab.classList.add('active');
        starsTab.insertAdjacentElement('afterend', tab);
      }
    }
  }

  function watchNavClicks() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    nav.addEventListener('click', e => {
      const tab = e.target.closest('.pressable');
      if (!tab || playerBuilding) return; // ignore clicks while collecting video IDs
      if (!tab.classList.contains('stars-tab') && starsTabActive) showMainContent();
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
      createMobileNav();
      setupMobileSwipe();
      // Show loading overlay immediately, then open player
      showMobilePlayerLoading();
      setTimeout(() => { if (!playerOpen) setMobileTab('home'); }, 300);
    } else {
      const nav = document.querySelector('nav');
      if (nav) new MutationObserver(injectNavTabs).observe(nav, { childList: true });
      injectNavTabs();
      watchNavClicks();
    }
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
      nav .stars-tab, nav .player-tab {
        display: flex; align-items: center; gap: 6px;
        padding: 0 16px; cursor: pointer; font-size: 14px;
        border-bottom: 3px solid transparent; color: inherit;
        white-space: nowrap; transition: color .15s;
      }
      nav .stars-tab:hover, nav .player-tab:hover { color: var(--active, #d7d7d7); }
      nav .stars-tab.active, nav .player-tab.active {
        border-bottom: 3px solid var(--active, #d7d7d7);
        color: var(--active, #d7d7d7); cursor: default;
      }

      /* ── Stars view ── */
      #stars-view { display:none; flex-direction:row; flex:1; min-height:0; overflow:hidden; }
      #stars-sidebar { width:200px; flex-shrink:0; background:#1a1a1a; border-right:1px solid #3a3a3a; display:flex; flex-direction:column; overflow-y:auto; padding:8px 0; }
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
