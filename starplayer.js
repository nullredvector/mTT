(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  const STARS_KEY  = 'myfavett_stars_v1';
  const GROUPS_KEY = 'myfavett_groups_v1';
  const OLD_KEY    = 'myfavett_favorites_v1';

  function loadStars() {
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

  function loadGroups() {
    try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function saveStars()  { localStorage.setItem(STARS_KEY,  JSON.stringify(stars)); }
  function saveGroups() { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); }

  let stars  = loadStars();
  let groups = loadGroups();

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function getVideoIdFromSrc(src) {
    const m = src && src.match(/covers\/(\d+)\.jpg/);
    return m ? m[1] : null;
  }

  function getVideoPath(coverSrc) {
    return coverSrc.replace('/covers/', '/videos/').replace(/\.jpg$/, '.mp4');
  }

  function getVideoInfo(videoId) {
    const E = window.E;
    if (!E) return { desc: '', authorName: '' };
    const v = E.videos && E.videos[videoId];
    if (!v) return { desc: '', authorName: '' };
    const a = E.authors && E.authors[v.authorId];
    return {
      desc: v.desc || '',
      authorName: (a && (a.uniqueIds?.[0] || a.nicknames?.[0])) || '',
    };
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

  function toggleStar(videoId, coverSrc) {
    if (stars[videoId]) {
      delete stars[videoId];
      groups.forEach(g => { g.videoIds = g.videoIds.filter(id => id !== videoId); });
      saveGroups();
    } else {
      stars[videoId] = { id: videoId, coverSrc };
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
    applyMobileCards();
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
    });

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

  // ═══════════════════════════════════════════════════════════════════════════
  // OPEN VIDEO (from panel or Stars tab)
  // ═══════════════════════════════════════════════════════════════════════════

  function openVideo(coverSrc) {
    closePanel();
    if (starsTabActive) showMainContent();

    const appTab = tabForCover(coverSrc);
    if (appTab) {
      const tabEl = document.querySelector(`nav div.${appTab}`);
      if (tabEl) tabEl.click();
    }

    setTimeout(() => {
      let found = null;
      document.querySelectorAll('img.thumbnail').forEach(img => {
        if (img.getAttribute('src') === coverSrc) found = img;
      });
      if (found) found.click();
      else window.open(getVideoPath(coverSrc));
    }, 300);
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
          groups.forEach(g => { g.videoIds = g.videoIds.filter(i => i !== star.id); });
          saveStars(); saveGroups();
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
  let activeGroupId  = 'all';

  function showStarsTab() {
    starsTabActive = true;
    closePlayer();
    document.querySelector('main')?.style.setProperty('display', 'none');
    toggleBtn.style.display = 'none';
    closePanel();

    document.querySelectorAll('nav .active').forEach(el => el.classList.remove('active'));
    document.querySelector('nav .stars-tab')?.classList.add('active');

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
    document.querySelector('nav .stars-tab')?.classList.remove('active');
  }

  function renderStarsView() {
    if (!starsViewEl) return;
    starsViewEl.innerHTML = '';

    // ── Sidebar ──────────────────────────────────────────────────────────────
    const sidebar = document.createElement('div');
    sidebar.id = 'stars-sidebar';

    function makeSidebarItem(id, label, count) {
      const item = document.createElement('div');
      item.className = 'stars-group-item' + (activeGroupId === id ? ' active' : '');
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

    const allItem = makeSidebarItem('all', 'All Stars', Object.keys(stars).length);
    allItem.addEventListener('click', () => { activeGroupId = 'all'; renderStarsView(); });
    sidebar.appendChild(allItem);

    const divider = document.createElement('hr');
    divider.className = 'stars-sidebar-divider';
    sidebar.appendChild(divider);

    groups.forEach(g => {
      const count = g.videoIds.filter(id => stars[id]).length;
      const row = document.createElement('div');
      row.className = 'stars-group-row';

      const item = makeSidebarItem(g.id, g.name, count);
      item.addEventListener('click', () => { activeGroupId = g.id; renderStarsView(); });

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
        if (activeGroupId === g.id) activeGroupId = 'all';
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

    starsViewEl.appendChild(sidebar);

    // ── Main area ─────────────────────────────────────────────────────────────
    const mainArea = document.createElement('div');
    mainArea.id = 'stars-main';

    const currentGroupName = activeGroupId === 'all'
      ? 'All Stars'
      : (groups.find(g => g.id === activeGroupId)?.name || 'Stars');

    const videosToShow = activeGroupId === 'all'
      ? Object.values(stars)
      : (groups.find(g => g.id === activeGroupId)?.videoIds || [])
          .filter(id => stars[id]).map(id => stars[id]);

    const mainHeader = document.createElement('div');
    mainHeader.id = 'stars-main-header';
    mainHeader.innerHTML =
      `<span class="stars-main-title">${currentGroupName}</span>` +
      `<span class="stars-main-count">${videosToShow.length} video${videosToShow.length !== 1 ? 's' : ''}</span>`;
    mainArea.appendChild(mainHeader);

    const grid = document.createElement('div');
    grid.id = 'stars-grid';

    if (!videosToShow.length) {
      const empty = document.createElement('div');
      empty.id = 'stars-empty';
      empty.innerHTML = activeGroupId === 'all'
        ? 'No starred videos yet.<br>Click ★ on any video in Likes, Favorites, or Following.'
        : 'No videos in this group yet.<br>Star videos and use ⊕ to add them here.';
      grid.appendChild(empty);
    } else {
      videosToShow.forEach(star => {
        const { desc, authorName } = getVideoInfo(star.id);
        grid.appendChild(buildStarsGridCard(star, authorName, desc));
      });
    }

    mainArea.appendChild(grid);
    starsViewEl.appendChild(mainArea);
  }

  function buildStarsGridCard(star, authorName, desc) {
    const card = document.createElement('div');
    card.className = 'stars-grid-card';

    const cover = document.createElement('div');
    cover.className = 'stars-grid-cover';
    cover.addEventListener('click', () => openVideo(star.coverSrc));

    const img = document.createElement('img');
    img.src = star.coverSrc;
    img.loading = 'lazy';
    cover.appendChild(img);

    const rmBtn = document.createElement('button');
    rmBtn.className = 'stars-grid-remove';
    rmBtn.title = activeGroupId === 'all' ? 'Remove from Stars' : 'Remove from group';
    rmBtn.textContent = '✕';
    rmBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (activeGroupId === 'all') {
        toggleStar(star.id, star.coverSrc);
      } else {
        const g = groups.find(x => x.id === activeGroupId);
        if (g) { g.videoIds = g.videoIds.filter(id => id !== star.id); saveGroups(); renderStarsView(); }
      }
    });
    cover.appendChild(rmBtn);

    if (activeGroupId === 'all' && groups.length > 0) {
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
    document.getElementById('stars-group-picker')?.remove();
    if (!groups.length) return;

    const picker = document.createElement('div');
    picker.id = 'stars-group-picker';

    groups.forEach(g => {
      const row = document.createElement('label');
      row.className = 'stars-picker-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = g.videoIds.includes(videoId);
      cb.addEventListener('change', () => {
        if (cb.checked) { if (!g.videoIds.includes(videoId)) g.videoIds.push(videoId); }
        else g.videoIds = g.videoIds.filter(id => id !== videoId);
        saveGroups();
        if (starsTabActive) renderStarsView();
      });
      row.appendChild(cb);
      row.appendChild(document.createTextNode(' ' + g.name));
      picker.appendChild(row);
    });

    const rect = anchorBtn.getBoundingClientRect();
    picker.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    picker.style.left = (rect.left  + window.scrollX)     + 'px';
    document.body.appendChild(picker);

    setTimeout(() => {
      document.addEventListener('click', function h(e) {
        if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', h); }
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

    function walk(fiber) {
      if (!fiber || walked++ > 50000) return;
      const p = fiber.memoizedProps;
      // Log any component that looks list-like so we can see what's available
      if (p && typeof p.itemCount === 'number' && p.itemCount > 0) {
        console.log('[Fiber] list-like node itemCount=' + p.itemCount +
          ' hasItemKey=' + (typeof p.itemKey === 'function') +
          ' hasItemSize=' + (typeof p.itemSize === 'function'));
        if (typeof p.itemKey === 'function') {
          for (let i = 2; i < p.itemCount; i++) {
            const id = p.itemKey(i);
            if (typeof id === 'string' && id.length > 8) ids.push(id);
          }
          return;
        }
      }
      walk(fiber.child);
      walk(fiber.sibling);
    }

    walk(rootFiber);
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

      // Collect author names from whichever rows are currently visible in the DOM.
      const authorMap = {};
      const covers = document.querySelectorAll('div.cover');

      // Log the first video row (one that has an actual thumbnail)
      const firstVideoRow = [...covers].find(c => c.querySelector('img.thumbnail'));
      if (firstVideoRow) {
        console.log('[Player author debug] first video row HTML:', firstVideoRow.parentElement?.innerHTML?.slice(0, 2000));
      }

      covers.forEach(coverDiv => {
        const imgId = getVideoIdFromSrc(coverDiv.querySelector('img.thumbnail')?.getAttribute('src') || '');
        if (!imgId) return;
        const row = coverDiv.parentElement;
        if (!row) return;
        // Try every likely candidate — anchor tags, .link, .searchable, .underline,
        // or any element whose text looks like a short single-word handle
        const scope = row.querySelector('.column-titles') || row;
        const candidates = [
          scope.querySelector('a'),
          scope.querySelector('.link'),
          scope.querySelector('.searchable'),
          scope.querySelector('.underline'),
          scope.querySelector('[class*="author"]'),
          scope.querySelector('[class*="Author"]'),
          scope.querySelector('[class*="nick"]'),
          scope.querySelector('[class*="Nick"]'),
          scope.querySelector('[class*="user"]'),
          scope.querySelector('[class*="User"]'),
        ];
        for (const el of candidates) {
          const t = el?.textContent?.trim();
          if (t && t.length >= 2 && t.length <= 40 && !t.includes('\n')) {
            authorMap[imgId] = t.replace(/^@/, '');
            break;
          }
        }
      });
      console.log('[Player] author map sample:', Object.entries(authorMap).slice(0, 3));

      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        list.push({ id, videoPath: videoPath(id), coverSrc: coverPath(id), authorName: authorMap[id] || '' });
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

  async function openPlayer() {
    if (starsTabActive) showMainContent();
    playerOpen = true;

    if (isMobilePlayer()) {
      // Mobile: show the player-view immediately as a loading screen (position:fixed
      // covers everything visually) WITHOUT hiding <main>. This lets React continue
      // re-rendering <main> during tab-switching in buildVideoList without memory
      // pressure or crashes. After collection, swap the loading screen for the feed.
      document.querySelector('nav .player-tab')?.classList.add('active');
      showMobilePlayerLoading();
      playerVideoList = await buildVideoList();
      if (!playerOpen) { hideMobilePlayerView(); return; }
      playerColumnOffsets = [0];
      renderMobilePlayerContent();
    } else {
      // Desktop: show overlay immediately (loading state), then fill it.
      playerColumnOffsets = Array.from({ length: numCols() }, (_, i) => i);
      renderPlayerOverlay();
      document.querySelector('nav .player-tab')?.classList.add('active');
      playerVideoList = await buildVideoList();
      if (playerOpen) {
        playerColumnOffsets = Array.from({ length: numCols() }, (_, i) => i);
        renderPlayerOverlay();
      }
    }
  }

  function closePlayer() {
    playerOpen = false;
    document.getElementById('player-overlay')?.remove();
    hideMobilePlayerView();
    document.querySelector('nav .player-tab')?.classList.remove('active');
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

    // Minimal header: back button + counter
    const header = document.createElement('div');
    header.id = 'player-view-header';

    const backBtn = document.createElement('button');
    backBtn.id = 'player-view-back';
    backBtn.textContent = '← Back';
    backBtn.addEventListener('click', closePlayer);
    header.appendChild(backBtn);

    const counter = document.createElement('span');
    counter.id = 'player-counter';
    header.appendChild(counter);

    if (!playerVideoList.length) {
      const empty = document.createElement('div');
      empty.id = 'player-view-loading';
      empty.textContent = 'No videos found.';
      playerViewEl.appendChild(header);
      playerViewEl.appendChild(empty);
      return;
    }

    playerViewEl.appendChild(header);
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

    if (!total) return; // still loading — feed shows empty, counter says "Loading…"

    const videoEls = [];

    playerVideoList.forEach((item, idx) => {
      const slide = document.createElement('div');
      slide.className = 'player-slide';
      slide.dataset.idx = idx;

      // Video — preload=none so only the playing one downloads
      const video = document.createElement('video');
      video.src = item.videoPath;
      video.preload = 'none';
      video.muted = true;
      video.playsInline = true;
      video.poster = item.coverSrc;
      video.className = 'player-video';
      video.addEventListener('playing', () => { video.poster = ''; }, { once: true });
      video.addEventListener('ended',   () => { video.currentTime = 0; video.play().catch(() => {}); });
      slide.appendChild(video);

      // Controls overlay (same layout as desktop columns)
      const controls = document.createElement('div');
      controls.className = 'player-controls';

      const rightCenter = document.createElement('div');
      rightCenter.className = 'player-right-center';

      const starBtn = document.createElement('button');
      starBtn.className = 'player-ctrl-btn player-star-btn' + (stars[item.id] ? ' active' : '');
      starBtn.innerHTML = '★';
      starBtn.title = stars[item.id] ? 'Remove from Stars' : 'Add to Stars';
      starBtn.addEventListener('click', e => {
        e.stopPropagation();
        toggleStar(item.id, item.coverSrc);
        starBtn.classList.toggle('active', Boolean(stars[item.id]));
        starBtn.title = stars[item.id] ? 'Remove from Stars' : 'Add to Stars';
      });

      const groupBtn = document.createElement('button');
      groupBtn.className = 'player-ctrl-btn player-group-btn';
      groupBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
      groupBtn.title = 'Add to group';
      groupBtn.addEventListener('click', e => { e.stopPropagation(); showGroupPicker(groupBtn, item.id); });

      rightCenter.appendChild(starBtn);
      rightCenter.appendChild(groupBtn);
      controls.appendChild(rightCenter);

      if (item.authorName) {
        const auth = document.createElement('div');
        auth.className = 'player-author';
        auth.textContent = '@' + item.authorName;
        controls.appendChild(auth);
      }

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

      slide.appendChild(controls);
      feed.appendChild(slide);
      videoEls.push(video);
    });

    // Size each slide to exactly fill the feed container (resolved after layout)
    const setSlideHeights = () => {
      const h = feed.clientHeight;
      if (h > 0) {
        feed.querySelectorAll('.player-slide').forEach(s => { s.style.height = h + 'px'; });
      } else {
        // Retry once more if layout hasn't resolved yet
        requestAnimationFrame(setSlideHeights);
      }
    };
    requestAnimationFrame(setSlideHeights);

    // Restore last-viewed position without animation
    const startIdx = playerColumnOffsets[0] || 0;
    if (startIdx > 0 && feed.children[startIdx]) {
      feed.children[startIdx].scrollIntoView({ behavior: 'instant' });
    }

    // IntersectionObserver: play the centered slide, pause everything else
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const idx = parseInt(entry.target.dataset.idx);
        const vid = videoEls[idx];
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          playerColumnOffsets[0] = idx;
          vid.play().catch(() => {});
          if (counter) counter.textContent = `${idx + 1} / ${total}`;
        } else {
          vid.pause();
        }
      });
    }, { threshold: 0.6 });

    feed.querySelectorAll('.player-slide').forEach(s => io.observe(s));

    // Kick off the starting video
    videoEls[startIdx]?.play().catch(() => {});
    if (counter) counter.textContent = `${startIdx + 1} / ${total}`;
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
    // Drop the poster as soon as real frames start rendering — prevents thumbnail flash on loop
    video.addEventListener('playing', () => { video.poster = ''; }, { once: true });
    // Manual loop — avoids the black-frame flash that browser native loop produces
    video.addEventListener('ended', () => {
      video.currentTime = 0;
      video.play().catch(() => {});
    });
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

    // Bottom-left: author
    const auth = document.createElement('div');
    auth.className = 'player-author';
    auth.textContent = authorName ? '@' + authorName : '';
    controls.appendChild(auth);

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

  function popoutPlayer() {
    const cols = numCols();
    const w = cols * 390 + 2;
    const win = window.open(
      'about:blank', 'myfavett-player',
      `width=${w},height=740,resizable=yes,menubar=no,toolbar=no,location=no,status=no`
    );
    if (!win) { alert('Pop-out was blocked. Please allow pop-ups for this file and try again.'); return; }

    const safeJson = obj => JSON.stringify(obj).replace(/<\/script>/gi, '<\\/script>');

    win.document.write(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Player — myfaveTT</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:#111;color:#ddd;font-family:system-ui,sans-serif}
body{display:flex;flex-direction:column}
#ph{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#1a1a1a;border-bottom:1px solid #333;flex-shrink:0}
#ph-title{font-size:14px;font-weight:600;flex:1;text-align:center}
#ph-counter{font-size:12px;color:#666;min-width:80px;text-align:center}
.pnb{background:none;border:1px solid #444;border-radius:4px;color:#ccc;cursor:pointer;padding:4px 12px;font-size:15px;line-height:1}
.pnb:hover{background:#2a2a2a}.pnb:disabled{opacity:.3;cursor:default}
#ps{flex:1;display:flex;min-height:0}
.pc{flex:1;position:relative;background:#000;border-right:1px solid #1a1a1a;overflow:hidden}
.pc:last-child{border-right:none}
.pv{width:100%;height:100%;object-fit:contain;display:block}
.pctl{position:absolute;inset:0;pointer-events:none}
.prc{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:12px;pointer-events:auto;align-items:center}
.pb{background:rgba(0,0,0,.6);border:none;border-radius:50%;color:#ddd;width:44px;height:44px;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .1s;pointer-events:auto}
.pb:hover{background:rgba(0,0,0,.85);transform:scale(1.1)}
.pb.on{color:gold}
.pa{position:absolute;bottom:14px;left:14px;font-size:13px;font-weight:500;text-shadow:0 1px 4px rgba(0,0,0,.9);pointer-events:none}
.pm{position:absolute;bottom:10px;right:10px;pointer-events:auto}
#gp{position:fixed;background:#252525;border:1px solid #555;border-radius:6px;padding:6px 0;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,.7);z-index:999}
.gpr{display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:13px;cursor:pointer}
.gpr:hover{background:#333}
</style></head><body>
<div id="ph">
  <button class="pnb" id="pp">&#8592;</button>
  <span id="ph-counter"></span>
  <span id="ph-title">Player — myfaveTT</span>
  <span id="ph-counter2"></span>
  <button class="pnb" id="pn">&#8594;</button>
</div>
<div id="ps"></div>
<script>
const SK='myfavett_stars_v1',GK='myfavett_groups_v1';
let vids=${safeJson(playerVideoList)};
let off=${playerOffset};

function nc(){return window.innerWidth<768?1:3}
function ls(){try{return JSON.parse(localStorage.getItem(SK)||'{}')}catch(_){return{}}}
function ss(s){localStorage.setItem(SK,JSON.stringify(s))}
function lg(){try{return JSON.parse(localStorage.getItem(GK)||'[]')}catch(_){return[]}}
function sg(g){localStorage.setItem(GK,JSON.stringify(g))}

function mi(m){
  return m
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
}

function ci(){
  const cols=nc(),total=vids.length,end=Math.min(off+cols,total);
  const txt=total?(off+1)+'\u2013'+end+' / '+total:'No videos';
  document.getElementById('ph-counter').textContent=txt;
  document.getElementById('ph-counter2').textContent='';
  document.getElementById('pp').disabled=off===0;
  document.getElementById('pn').disabled=off+cols>=total;
}

function render(){
  const cols=nc(),total=vids.length;
  const stage=document.getElementById('ps');
  stage.querySelectorAll('video').forEach(v=>{v.pause();v.src='';});
  stage.innerHTML='';
  ci();
  for(let i=0;i<cols;i++){
    const idx=off+i;
    const col=document.createElement('div');
    col.className='pc';
    if(idx>=total){stage.appendChild(col);continue;}
    const item=vids[idx];
    const curStars=ls();

    const vid=document.createElement('video');
    vid.src=item.videoPath; vid.muted=true; vid.autoplay=true;
    vid.loop=true; vid.playsInline=true; vid.poster=item.coverSrc;
    vid.className='pv';
    col.appendChild(vid);

    const ctl=document.createElement('div'); ctl.className='pctl';

    const rc=document.createElement('div'); rc.className='prc';

    const sb=document.createElement('button');
    sb.className='pb'+(curStars[item.id]?' on':'');
    sb.innerHTML='★'; sb.title=curStars[item.id]?'Remove from Stars':'Add to Stars';
    sb.addEventListener('click',e=>{
      e.stopPropagation();
      const s=ls();
      if(s[item.id])delete s[item.id]; else s[item.id]={id:item.id,coverSrc:item.coverSrc};
      ss(s);
      sb.classList.toggle('on',Boolean(s[item.id]));
    });

    const gb=document.createElement('button');
    gb.className='pb';
    gb.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
    gb.title='Add to group';
    gb.addEventListener('click',e=>{ e.stopPropagation(); showPicker(gb,item.id); });

    rc.appendChild(sb); rc.appendChild(gb); ctl.appendChild(rc);

    if(item.authorName){
      const a=document.createElement('div'); a.className='pa';
      a.textContent='@'+item.authorName; ctl.appendChild(a);
    }

    let muted=true;
    const mb=document.createElement('button');
    mb.className='pb pm'; mb.innerHTML=mi(true); mb.title='Unmute';
    mb.addEventListener('click',e=>{
      e.stopPropagation(); muted=!muted; vid.muted=muted;
      mb.innerHTML=mi(muted); mb.title=muted?'Unmute':'Mute';
    });
    ctl.appendChild(mb);
    col.appendChild(ctl);
    stage.appendChild(col);
  }
}

function showPicker(btn,videoId){
  document.getElementById('gp')?.remove();
  const groups=lg(); if(!groups.length)return;
  const pk=document.createElement('div'); pk.id='gp';
  groups.forEach(g=>{
    const row=document.createElement('label'); row.className='gpr';
    const cb=document.createElement('input'); cb.type='checkbox';
    cb.checked=g.videoIds&&g.videoIds.includes(videoId);
    cb.addEventListener('change',()=>{
      const live=lg(); const f=live.find(x=>x.id===g.id);
      if(f){if(cb.checked&&!f.videoIds.includes(videoId))f.videoIds.push(videoId);
            else f.videoIds=f.videoIds.filter(i=>i!==videoId); sg(live);}
    });
    row.appendChild(cb); row.appendChild(document.createTextNode(' '+g.name));
    pk.appendChild(row);
  });
  const r=btn.getBoundingClientRect();
  pk.style.top=(r.bottom+4)+'px'; pk.style.left=r.left+'px';
  document.body.appendChild(pk);
  setTimeout(()=>{
    document.addEventListener('click',function h(e){
      if(!pk.contains(e.target)){pk.remove();document.removeEventListener('click',h);}
    });
  },0);
}

document.getElementById('pp').addEventListener('click',()=>{ off=Math.max(0,off-nc()); render(); });
document.getElementById('pn').addEventListener('click',()=>{ off=Math.min(vids.length-nc(),off+nc()); render(); });
document.addEventListener('keydown',e=>{
  if(e.key==='ArrowRight') document.getElementById('pn').click();
  if(e.key==='ArrowLeft')  document.getElementById('pp').click();
});
render();
</script></body></html>`);
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
          () => { if (!playerOpen) openPlayer(); else closePlayer(); }
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
      if (!tab.classList.contains('player-tab') && playerOpen)    closePlayer();
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

    const nav = document.querySelector('nav');
    if (nav) {
      new MutationObserver(injectNavTabs).observe(nav, { childList: true });
    }

    watchNavClicks();
  }

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
        position: fixed; bottom: 62px; right: 20px; z-index: 999;
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
      .stars-inline-form { display:flex; align-items:center; gap:4px; padding:6px 8px; margin:4px 8px; }
      .stars-inline-input { flex:1; min-width:0; background:#2a2a2a; border:1px solid #555; border-radius:4px; color:#ddd; font-size:12px; padding:4px 6px; outline:none; }
      .stars-inline-input:focus { border-color:#888; }
      .stars-inline-confirm { background:none; border:none; cursor:pointer; font-size:13px; padding:2px 4px; color:#6c6; }
      .stars-inline-cancel  { background:none; border:none; cursor:pointer; font-size:13px; padding:2px 4px; color:#c66; }
      #stars-main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
      #stars-main-header { display:flex; align-items:baseline; gap:10px; padding:14px 18px 10px; flex-shrink:0; border-bottom:1px solid #333; }
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
      #stars-group-picker { position:absolute; z-index:2000; background:#252525; border:1px solid #555; border-radius:6px; padding:6px 0; min-width:160px; box-shadow:0 4px 16px rgba(0,0,0,.6); }
      .stars-picker-row { display:flex; align-items:center; gap:8px; padding:6px 14px; font-size:13px; cursor:pointer; transition:background .1s; }
      .stars-picker-row:hover { background:#333; }

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
      .player-author {
        position: absolute; bottom: 14px; left: 14px;
        font-size: 13px; font-weight: 500; pointer-events: none;
        text-shadow: 0 1px 4px rgba(0,0,0,.9); color: #eee;
        max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
        /* Slightly bigger touch targets */
        .player-ctrl-btn { width: 52px; height: 52px; font-size: 22px; }
        .player-col-nav-btn { width: 42px !important; height: 42px !important; font-size: 20px !important; }
        /* Stars sidebar becomes a horizontal scrolling pill strip */
        #stars-view { flex-direction: column; }
        #stars-sidebar {
          width: 100%; flex-direction: row; flex-wrap: nowrap;
          overflow-x: auto; overflow-y: hidden;
          border-right: none; border-bottom: 1px solid #3a3a3a;
          padding: 4px 8px; gap: 4px;
        }
        #stars-sidebar::-webkit-scrollbar { height: 3px; }
        #stars-sidebar::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
        .stars-sidebar-divider { display: none; }
        .stars-group-item {
          white-space: nowrap; flex-shrink: 0;
          border-radius: 20px; background: #222;
          padding: 5px 12px;
        }
        .stars-group-item.active { background: #333; }
        .stars-group-row { flex-shrink: 0; }
        .stars-group-action { display: none; }
        #stars-new-group-btn { margin: 2px 0; white-space: nowrap; flex-shrink: 0; }
        #stars-main-header { padding: 10px 12px 8px; }
        #stars-grid { padding: 10px 12px; gap: 10px; }

        /* ── Hide star bubble on mobile ── */
        #star-toggle { display: none !important; }

        /* ── Mobile player: fixed full-screen view (display toggled via JS) ── */
        #player-view {
          position: fixed; inset: 0; bottom: 62px; z-index: 3000;
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

        /* ── Hide Explain nav tab on mobile ── */
        nav > div.explain-tab { display: none !important; }

        /* ── Bottom tab bar ── */
        nav {
          position: fixed !important;
          bottom: 0 !important; top: auto !important;
          left: 0 !important; right: 0 !important;
          /* 100vw escapes any width-constrained parent container */
          width: 100vw !important; height: 62px !important;
          flex-direction: row !important; align-items: stretch !important;
          border-top: 1px solid #2a2a2a !important; border-bottom: none !important;
          overflow-x: auto !important; overflow-y: hidden !important;
          z-index: 500 !important; padding: 0 !important;
          background: #1a1a1a !important;
          /* Reset any margin/transform that could shift it right */
          margin: 0 !important; transform: none !important;
        }
        /* Each tab: icon centred above label */
        nav > div {
          flex: 1 1 0 !important; min-width: 54px !important;
          flex-direction: column !important; align-items: center !important;
          justify-content: center !important; gap: 2px !important;
          padding: 5px 4px 3px !important;
          font-size: 10px !important; line-height: 1.2 !important;
          border-bottom: none !important; border-top: 3px solid transparent !important;
        }
        nav > div.active {
          border-bottom: none !important;
          border-top: 3px solid var(--active, currentColor) !important;
        }
        nav > div svg { width: 22px !important; height: 22px !important; }
        /* Flip injected-tab active indicator from bottom → top */
        nav .stars-tab, nav .player-tab {
          border-bottom: none !important; border-top: 3px solid transparent !important;
        }
        nav .stars-tab.active, nav .player-tab.active {
          border-bottom: none !important;
          border-top: 3px solid var(--active, #d7d7d7) !important;
        }
        /* Push all page content above the fixed bottom nav */
        body { padding-bottom: 62px !important; }
        /* Stars view must not slip behind nav */
        #stars-view { max-height: calc(100vh - 62px) !important; }
        /* ── Mobile card layout for video list ── */
        /* Stop forcing horizontal scroll — show cards instead */
        main { overflow-x: hidden !important; }
        main > * { min-width: 0 !important; }

        /* Cover thumbnails: taller so they feel like cards */
        div.cover { height: 110px !important; }

        /* Hide table columns after the first text column (keep cover + 1 sibling) */
        div.cover ~ * ~ * { display: none !important; }

        /* Caption overlay injected by applyMobileCards() */
        .sp-cap {
          position: absolute; bottom: 0; left: 0; right: 0;
          background: linear-gradient(transparent, rgba(0,0,0,.85));
          color: #fff; font-size: 10px; line-height: 1.35;
          padding: 18px 5px 5px; white-space: pre-line;
          pointer-events: none; z-index: 5;
          overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 4; -webkit-box-orient: vertical;
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
        /* Tighter player header */
        #player-header { padding: 6px 10px; gap: 4px; }
        #player-title { font-size: 13px; }
        #player-counter { display: none; }
        .player-nav-btn { padding: 6px 12px; }
        .player-header-btn { padding: 5px 6px; }
        /* Smaller grid min so more columns fit */
        #stars-grid { grid-template-columns: repeat(auto-fill, minmax(85px, 1fr)); }
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
