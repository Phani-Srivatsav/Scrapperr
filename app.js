/**
 * Glaido — Frontend Application
 * Follows the gemini.md schema strictly.
 * State is persisted to localStorage.
 */

'use strict';

// ═══════════════════════════════════════════════════
// CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════

const ARTICLES_PATH = '.tmp/articles.json';
const STORAGE_KEY   = 'glaido_state';

// Required fields per the gemini.md Scraper Output Payload schema
const REQUIRED_FIELDS = ['id', 'source', 'title', 'url', 'published_at', 'summary'];

// ═══════════════════════════════════════════════════
// APPLICATION STATE
// ═══════════════════════════════════════════════════

let state = {
  articles:     [],
  last_updated: null,
};

let ui = {
  activeFilter:       'all',   // 'all' | 'saved'
  activeSource:       'all',   // 'all' | "Ben's Bites" | "The AI Rundown"
  activeArticleId:    null,
  isLoading:          true,
};

// ═══════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════

const $ = id => document.getElementById(id);

const DOM = {
  feed:            $('feed'),
  emptyState:      $('empty-state'),
  errorState:      $('error-state'),
  errorSub:        $('error-sub'),
  staleBanner:     $('stale-banner'),
  feedDate:        $('feed-date'),
  lastUpdated:     $('last-updated-label'),
  refreshBtn:      $('refresh-btn'),

  // Nav
  navAll:          $('nav-all'),
  navSaved:        $('nav-saved'),
  countAll:        $('count-all'),
  countSaved:      $('count-saved'),

  // Sources
  srcAll:          $('src-all'),
  srcBens:         $('src-bens'),
  srcRundown:      $('src-rundown'),
  countBens:       $('count-bens'),
  countRundown:    $('count-rundown'),

  // Detail panel
  detailPanel:     $('detail-panel'),
  detailClose:     $('detail-close'),
  detailSourceTag: $('detail-source-tag'),
  detailTitle:     $('detail-title'),
  detailTimestamp: $('detail-timestamp'),
  detailSummary:   $('detail-summary'),
  detailLink:      $('detail-link'),
  detailSaveBtn:   $('detail-save-btn'),
  panelOverlay:    $('panel-overlay'),
};

// ═══════════════════════════════════════════════════
// DATA — LOAD & VALIDATE
// ═══════════════════════════════════════════════════

/**
 * Validates that an item matches the gemini.md Scraper Output Payload schema.
 */
function validateArticle(item) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in item) || item[field] === null || item[field] === undefined) {
      return { valid: false, reason: `Missing required field: "${field}"` };
    }
  }
  if (typeof item.id !== 'string' || !item.id.trim()) {
    return { valid: false, reason: '"id" must be a non-empty string' };
  }
  try {
    new URL(item.url);
  } catch {
    return { valid: false, reason: `"url" is not a valid URL: ${item.url}` };
  }
  return { valid: true };
}

/**
 * Loads state from localStorage. Returns null if none.
 */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Saves state to localStorage.
 */
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Glaido: localStorage save failed', e);
  }
}

/**
 * Fetches articles.json, validates, and merges with existing save states.
 */
async function loadArticles(isRefresh = false) {
  if (!isRefresh) showSkeletons();

  try {
    const response = await fetch(`${ARTICLES_PATH}?t=${Date.now()}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const raw = await response.json();

    if (!Array.isArray(raw)) {
      throw new SchemaError('"articles.json" must be a JSON array at the root level.');
    }
    if (raw.length === 0) {
      handleEmpty();
      return;
    }

    // Validate first item (fast-fail)
    const check = validateArticle(raw[0]);
    if (!check.valid) {
      throw new SchemaError(check.reason);
    }

    // Load previous save states
    const cached = loadFromStorage();
    const savedIds = new Set(
      (cached?.articles ?? [])
        .filter(a => a.is_saved)
        .map(a => a.id)
    );

    // Merge
    const articles = raw.map(item => ({
      ...item,
      is_saved: savedIds.has(item.id),
    }));

    state.articles     = articles;
    state.last_updated = new Date().toISOString();
    saveToStorage();

    DOM.staleBanner.classList.add('hidden');
    renderAll();

  } catch (err) {
    if (err instanceof SchemaError) {
      showError(err.message);
      return;
    }

    // Network/fetch failure — try cache fallback
    const cached = loadFromStorage();
    if (cached && cached.articles && cached.articles.length > 0) {
      state = cached;
      DOM.staleBanner.classList.remove('hidden');
      renderAll();
    } else {
      handleEmpty();
    }
  }
}

class SchemaError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SchemaError';
  }
}

// ═══════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════

function renderAll() {
  hideSkeletons();
  const filtered = getFilteredArticles();
  updateCounts();
  updateDateStamp();

  if (filtered.length === 0) {
    handleEmpty();
    return;
  }

  DOM.emptyState.classList.add('hidden');
  DOM.errorState.classList.add('hidden');
  DOM.feed.innerHTML = '';

  filtered.forEach(article => {
    DOM.feed.appendChild(buildCard(article));
  });
}

/**
 * Builds a single article card element.
 */
function buildCard(article) {
  const card = document.createElement('article');
  card.className    = 'article-card';
  card.dataset.id   = article.id;
  card.setAttribute('role', 'listitem');
  if (article.id === ui.activeArticleId) card.classList.add('active');

  const sourceClass = getSourceClass(article.source);
  const timeLabel   = formatRelativeTime(article.published_at);
  const savedClass  = article.is_saved ? 'saved' : '';
  const savedFill   = article.is_saved
    ? 'fill="currentColor" stroke="currentColor"'
    : 'fill="none" stroke="currentColor"';

  const imgHtml = article.image_url 
    ? `<div class="card-image-wrap"><img src="${escHtml(article.image_url)}" class="card-image" alt="Article image" loading="lazy"></div>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="card-source-tag ${sourceClass}">${escHtml(article.source)}</span>
      <button class="card-save-btn ${savedClass}" data-id="${escHtml(article.id)}" aria-label="Save article" title="${article.is_saved ? 'Unsave' : 'Save'}">
        <svg width="14" height="14" viewBox="0 0 24 24" ${savedFill} stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
    </div>
    <div class="card-body">
      ${imgHtml}
      <div class="card-content">
        <p class="card-title">${escHtml(article.title)}</p>
        <p class="card-summary">${escHtml(article.summary)}</p>
      </div>
    </div>
    <div class="card-meta">
      <span class="card-time mono">${timeLabel}</span>
      <span class="card-arrow">→</span>
    </div>
  `;

  // Listeners
  card.addEventListener('click', e => {
    if (e.target.closest('.card-save-btn')) return; // handled separately
    openDetail(article.id);
  });

  card.querySelector('.card-save-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleSave(article.id);
  });

  return card;
}

function renderSingleCard(id) {
  const existing = DOM.feed.querySelector(`[data-id="${id}"]`);
  const article = state.articles.find(a => a.id === id);
  if (!existing || !article) return;
  const newCard = buildCard(article);
  existing.replaceWith(newCard);
}

// ═══════════════════════════════════════════════════
// FILTERING
// ═══════════════════════════════════════════════════

function getFilteredArticles() {
  return state.articles.filter(a => {
    if (ui.activeFilter === 'saved' && !a.is_saved) return false;
    if (ui.activeSource !== 'all' && a.source !== ui.activeSource) return false;
    return true;
  });
}

function updateCounts() {
  const all   = state.articles.length;
  const saved = state.articles.filter(a => a.is_saved).length;
  const bens  = state.articles.filter(a => a.source === "Ben's Bites").length;
  const run   = state.articles.filter(a => a.source === "The AI Rundown").length;

  DOM.countAll.textContent     = all;
  DOM.countSaved.textContent   = saved;
  DOM.countBens.textContent    = bens;
  DOM.countRundown.textContent = run;
}

// ═══════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════

function openDetail(id) {
  const article = state.articles.find(a => a.id === id);
  if (!article) return;

  ui.activeArticleId = id;

  const sourceClass = getSourceClass(article.source);

  DOM.detailSourceTag.textContent = article.source;
  DOM.detailSourceTag.className   = `${sourceClass}`;
  DOM.detailTitle.textContent     = article.title;
  DOM.detailTimestamp.textContent = formatAbsoluteTime(article.published_at);
  DOM.detailSummary.textContent   = article.summary;
  DOM.detailLink.href             = article.url;

  // Image injection
  let detailImgContainer = document.getElementById('detail-image-container');
  if (!detailImgContainer) {
    detailImgContainer = document.createElement('div');
    detailImgContainer.id = 'detail-image-container';
    DOM.detailTitle.insertAdjacentElement('afterend', detailImgContainer);
  }
  
  if (article.image_url) {
    detailImgContainer.innerHTML = `<img src="${escHtml(article.image_url)}" class="detail-image" alt="Article banner">`;
  } else {
    detailImgContainer.innerHTML = '';
  }

  updateDetailSaveBtn(article.is_saved);

  DOM.detailPanel.classList.add('open');
  DOM.detailPanel.setAttribute('aria-hidden', 'false');
  DOM.panelOverlay.classList.add('visible');

  // Mark active card
  document.querySelectorAll('.article-card').forEach(c => c.classList.remove('active'));
  const activeCard = DOM.feed.querySelector(`[data-id="${id}"]`);
  if (activeCard) activeCard.classList.add('active');
}

function closeDetail() {
  DOM.detailPanel.classList.remove('open');
  DOM.detailPanel.setAttribute('aria-hidden', 'true');
  DOM.panelOverlay.classList.remove('visible');
  ui.activeArticleId = null;
  document.querySelectorAll('.article-card').forEach(c => c.classList.remove('active'));
}

function updateDetailSaveBtn(isSaved) {
  const btn = DOM.detailSaveBtn;
  if (isSaved) {
    btn.classList.add('saved');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      Saved
    `;
  } else {
    btn.classList.remove('saved');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      Save
    `;
  }
}

// ═══════════════════════════════════════════════════
// SAVE / UNSAVE
// ═══════════════════════════════════════════════════

function toggleSave(id) {
  const article = state.articles.find(a => a.id === id);
  if (!article) return;

  article.is_saved = !article.is_saved;
  saveToStorage();

  updateCounts();
  renderSingleCard(id);

  // If this is the article open in the detail panel, update it too
  if (ui.activeArticleId === id) {
    updateDetailSaveBtn(article.is_saved);
  }

  // If viewing saved filter and unsaved, close panel & re-render
  if (ui.activeFilter === 'saved' && !article.is_saved) {
    if (ui.activeArticleId === id) closeDetail();
    renderAll();
  }
}

// ═══════════════════════════════════════════════════
// UI STATES
// ═══════════════════════════════════════════════════

function showSkeletons() {
  DOM.feed.innerHTML = Array(5).fill(`
    <div class="skeleton-card" aria-hidden="true">
      <div class="sk-tag"></div>
      <div class="sk-title"></div>
      <div class="sk-title sk-short"></div>
      <div class="sk-meta"></div>
    </div>
  `).join('');
  DOM.emptyState.classList.add('hidden');
  DOM.errorState.classList.add('hidden');
}

function hideSkeletons() {
  // Real cards will replace them via renderAll
}

function handleEmpty() {
  DOM.feed.innerHTML = '';
  DOM.emptyState.classList.remove('hidden');
  DOM.errorState.classList.add('hidden');
  updateCounts();
  updateDateStamp();
}

function showError(message) {
  DOM.feed.innerHTML = '';
  DOM.emptyState.classList.add('hidden');
  DOM.errorState.classList.remove('hidden');
  DOM.errorSub.textContent = message;
}

// ═══════════════════════════════════════════════════
// DATE / TIME HELPERS
// ═══════════════════════════════════════════════════

function formatRelativeTime(isoString) {
  try {
    const date = new Date(isoString);
    const now  = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24)   return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  } catch {
    return isoString;
  }
}

function formatAbsoluteTime(isoString) {
  try {
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return isoString;
  }
}

function updateDateStamp() {
  const now = new Date();
  DOM.feedDate.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).toUpperCase();

  if (state.last_updated) {
    DOM.lastUpdated.textContent = `Updated ${formatRelativeTime(state.last_updated)}`;
  }
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function getSourceClass(source) {
  if (source === "Ben's Bites")       return 'tag-bens';
  if (source === "The AI Rundown")    return 'tag-rundown';
  return 'tag-bens';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════

// -- Nav filter (All / Saved)
[DOM.navAll, DOM.navSaved].forEach(btn => {
  btn.addEventListener('click', () => {
    ui.activeFilter = btn.dataset.filter;
    DOM.navAll.classList.toggle('active',   ui.activeFilter === 'all');
    DOM.navSaved.classList.toggle('active', ui.activeFilter === 'saved');
    closeDetail();
    renderAll();
  });
});

// -- Source filter
[DOM.srcAll, DOM.srcBens, DOM.srcRundown].forEach(btn => {
  btn.addEventListener('click', () => {
    ui.activeSource = btn.dataset.source;
    DOM.srcAll.classList.toggle('active',     ui.activeSource === 'all');
    DOM.srcBens.classList.toggle('active',    ui.activeSource === "Ben's Bites");
    DOM.srcRundown.classList.toggle('active', ui.activeSource === "The AI Rundown");
    closeDetail();
    renderAll();
  });
});

// -- Refresh
DOM.refreshBtn.addEventListener('click', async () => {
  DOM.refreshBtn.classList.add('spinning');
  await loadArticles(true);
  DOM.refreshBtn.classList.remove('spinning');
});

// -- Detail close
DOM.detailClose.addEventListener('click', closeDetail);
DOM.panelOverlay.addEventListener('click', closeDetail);

// -- Detail save
DOM.detailSaveBtn.addEventListener('click', () => {
  if (ui.activeArticleId) toggleSave(ui.activeArticleId);
});

// -- ESC to close panel
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.activeArticleId) closeDetail();
});

// ═══════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════

(async function init() {
  updateDateStamp();
  await loadArticles();
})();
