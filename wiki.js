import { Ledger } from '@drifting-ink/ledger';
import { marked } from 'marked';

// Parchment is UMD, esm.sh wraps it - access via window after import
await import('@drifting-ink/parchment');
const Parchment = window.Parchment;

// Wiki History IndexedDB helpers
const HISTORY_DB_NAME = 'scrappy-wiki-history';
const HISTORY_STORE_NAME = 'wikis';

async function openHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        const store = db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'token' });
        store.createIndex('lastVisited', 'lastVisited', { unique: false });
      }
    };
  });
}

async function saveWikiToHistory(token, name = null) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE_NAME);

    // Get existing entry to preserve name if not provided
    const getReq = store.get(token);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      store.put({
        token,
        name: name || existing?.name || token,
        lastVisited: new Date().toISOString()
      });
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getWikiHistory() {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readonly');
    const store = tx.objectStore(HISTORY_STORE_NAME);
    const index = store.index('lastVisited');
    const request = index.getAll();

    request.onsuccess = () => {
      db.close();
      // Sort by lastVisited descending
      resolve(request.result.sort((a, b) => b.lastVisited.localeCompare(a.lastVisited)));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function deleteWikiFromHistory(token) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE_NAME);
    store.delete(token);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// Active wiki session management
const ACTIVE_WIKI_KEY = 'scrappy-wiki-active';

async function getActiveWiki() {
  return localStorage.getItem(ACTIVE_WIKI_KEY);
}

async function setActiveWiki(token) {
  localStorage.setItem(ACTIVE_WIKI_KEY, token);
}

async function clearActiveWiki() {
  localStorage.removeItem(ACTIVE_WIKI_KEY);
}

// DOM elements
const wikiContent = document.getElementById('wiki-content');
const editorPane = document.getElementById('editor-pane');
const editorTextarea = document.getElementById('editor-textarea');
const editorPreview = document.getElementById('editor-preview');
const editBtn = document.getElementById('edit-btn');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');
const shareBtn = document.getElementById('share-btn');
const pageTitle = document.querySelector('.page-title');
const peerIndicator = document.querySelector('.peer-indicator');
const peerCount = document.querySelector('.peer-count');
const statusBar = document.getElementById('status-bar');
const statusMessage = statusBar.querySelector('.status-message');
const searchInput = document.getElementById('search-input');
const searchDropdown = document.getElementById('search-dropdown');

// Wiki picker elements
const wikiPicker = document.getElementById('wiki-picker');
const toolbar = document.getElementById('toolbar');
const mainContent = document.getElementById('main-content');
const homeBtn = document.getElementById('home-btn');
const newWikiBtn = document.getElementById('new-wiki-btn');
const joinTokenInput = document.getElementById('join-token-input');
const joinWikiBtn = document.getElementById('join-wiki-btn');
const pickerHistory = document.getElementById('picker-history');
const historyList = document.getElementById('history-list');

// Version history panel elements
const historyBtn = document.getElementById('history-btn');
const historyPanel = document.getElementById('history-panel');
const historyClose = document.getElementById('history-close');
const historyVersions = document.getElementById('history-versions');
const historyPreview = document.getElementById('history-preview');
const historyActions = document.getElementById('history-actions');
const historyRestore = document.getElementById('history-restore');
const historyCancel = document.getElementById('history-cancel');

// State
let db = null;
let currentSlug = 'home';
let currentToken = null;
let isEditing = false;
let originalContent = '';
let searchResults = [];
let selectedSearchIndex = -1;
let selectedVersionContent = null;
let currentPageContent = '';

// Configuration
const SIGNALING_URL = 'wss://drifting.ink/ws/signal';

// Status helpers
function setStatus(message, type = '') {
  statusMessage.textContent = message;
  statusBar.className = 'status-bar' + (type ? ` ${type}` : '');
}

function updatePeerStatus(count) {
  peerCount.textContent = `${count} peer${count !== 1 ? 's' : ''}`;
  peerIndicator.classList.toggle('connected', count > 0);
}

// Fuzzy search helper
function fuzzyMatch(query, text) {
  query = query.toLowerCase();
  text = text.toLowerCase();

  let queryIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;
  const matches = [];

  for (let i = 0; i < text.length && queryIdx < query.length; i++) {
    if (text[i] === query[queryIdx]) {
      matches.push(i);
      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) score += 10;
      // Bonus for match at start
      if (i === 0) score += 20;
      // Bonus for match after separator
      if (i > 0 && /[\s\-_]/.test(text[i - 1])) score += 15;
      score += 1;
      lastMatchIdx = i;
      queryIdx++;
    }
  }

  // All query chars must match
  if (queryIdx < query.length) return null;

  return { score, matches };
}

function highlightMatches(text, matches) {
  if (!matches || matches.length === 0) return text;

  let result = '';
  let lastIdx = 0;

  for (const idx of matches) {
    result += text.slice(lastIdx, idx);
    result += `<mark>${text[idx]}</mark>`;
    lastIdx = idx + 1;
  }
  result += text.slice(lastIdx);

  return result;
}

async function searchPages(query) {
  if (!query.trim()) {
    hideSearchDropdown();
    return;
  }

  try {
    const result = await db.exec('SELECT slug, content FROM pages');
    const pages = result.rows.map(([slug, content]) => ({ slug, content }));

    // Fuzzy match against slug and content
    const matches = [];
    for (const page of pages) {
      const slugMatch = fuzzyMatch(query, page.slug);
      const contentMatch = fuzzyMatch(query, page.content);

      if (slugMatch || contentMatch) {
        const score = Math.max(
          slugMatch ? slugMatch.score * 2 : 0, // Boost slug matches
          contentMatch ? contentMatch.score : 0
        );
        matches.push({
          ...page,
          score,
          slugMatches: slugMatch?.matches || [],
          preview: getPreview(page.content, query)
        });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    searchResults = matches.slice(0, 10);
    selectedSearchIndex = -1;
    renderSearchDropdown(query);
  } catch (err) {
    console.error('Search failed:', err);
  }
}

function getPreview(content, query) {
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const queryLower = query.toLowerCase();

  // Find line containing query
  for (const line of lines) {
    if (line.toLowerCase().includes(queryLower)) {
      const idx = line.toLowerCase().indexOf(queryLower);
      const start = Math.max(0, idx - 30);
      const end = Math.min(line.length, idx + query.length + 30);
      let preview = line.slice(start, end).trim();
      if (start > 0) preview = '...' + preview;
      if (end < line.length) preview += '...';
      return preview;
    }
  }

  // Fallback to first non-header line
  return lines[0]?.slice(0, 60) + (lines[0]?.length > 60 ? '...' : '') || '';
}

function renderSearchDropdown(query) {
  if (searchResults.length === 0) {
    searchDropdown.innerHTML = `
      <div class="search-create" data-create="${query}">
        Create page "<strong>${query}</strong>"
      </div>
    `;
  } else {
    const items = searchResults.map((r, i) => `
      <div class="search-item${i === selectedSearchIndex ? ' selected' : ''}" data-slug="${r.slug}">
        <div class="search-item-title">${highlightMatches(r.slug, r.slugMatches)}</div>
        <div class="search-item-preview">${r.preview}</div>
      </div>
    `).join('');

    searchDropdown.innerHTML = items + `
      <div class="search-create" data-create="${query}">
        Create page "<strong>${query}</strong>"
      </div>
    `;
  }

  searchDropdown.classList.remove('hidden');
}

function hideSearchDropdown() {
  searchDropdown.classList.add('hidden');
  searchResults = [];
  selectedSearchIndex = -1;
}

function navigateToPage(slug) {
  hideSearchDropdown();
  searchInput.value = '';
  Parchment.go(normalizeSlug(slug));
}

function selectSearchResult(index) {
  selectedSearchIndex = Math.max(-1, Math.min(index, searchResults.length));
  const items = searchDropdown.querySelectorAll('.search-item');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === selectedSearchIndex);
  });
}

// Debounce helper
function debounce(fn, ms) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

const debouncedSearch = debounce(searchPages, 150);

// Wiki picker functions
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

async function renderHistoryList() {
  const wikis = await getWikiHistory();

  if (wikis.length === 0) {
    pickerHistory.classList.add('empty');
    historyList.innerHTML = '';
    return;
  }

  pickerHistory.classList.remove('empty');
  historyList.innerHTML = wikis.map(wiki => `
    <div class="history-item" data-token="${wiki.token}">
      <div class="history-item-info">
        <span class="history-item-name">${wiki.name}</span>
        <span class="history-item-token">${wiki.token}</span>
      </div>
      <div class="history-item-time">${formatRelativeTime(wiki.lastVisited)}</div>
      <button class="history-item-delete" data-delete="${wiki.token}" title="Remove from history">&times;</button>
    </div>
  `).join('');
}

function showWikiPicker() {
  wikiPicker.classList.remove('hidden');
  toolbar.classList.add('hidden');
  mainContent.classList.add('hidden');
  statusBar.classList.add('hidden');
  renderHistoryList();
}

function hideWikiPicker() {
  wikiPicker.classList.add('hidden');
  toolbar.classList.remove('hidden');
  mainContent.classList.remove('hidden');
  statusBar.classList.remove('hidden');
}

async function goToWiki(token) {
  // Set as active wiki in storage
  await setActiveWiki(token);
  // Reload page without token in URL (init will pick up from storage)
  window.location.href = window.location.pathname;
}

// Simple line-based diff
function computeDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result = [];

  // Simple LCS-based diff
  const lcs = [];
  for (let i = 0; i <= oldLines.length; i++) {
    lcs[i] = [];
    for (let j = 0; j <= newLines.length; j++) {
      if (i === 0 || j === 0) {
        lcs[i][j] = 0;
      } else if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  let i = oldLines.length, j = newLines.length;
  const diff = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'context', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      diff.unshift({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }

  return diff;
}

function renderDiff(diff) {
  return diff.map(d => {
    const prefix = d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' ';
    const cls = d.type === 'add' ? 'diff-add' : d.type === 'remove' ? 'diff-remove' : 'diff-context';
    const escaped = d.line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="diff-line ${cls}">${prefix} ${escaped}</div>`;
  }).join('');
}

// Version history panel functions
async function openHistoryPanel() {
  historyPanel.classList.remove('hidden');
  selectedVersionContent = null;
  historyActions.classList.add('hidden');
  historyPreview.innerHTML = '<div class="history-preview-empty">Select a version to preview</div>';

  // Get current page content for diff
  const currentResult = await db.exec('SELECT content FROM pages WHERE slug = ?', [currentSlug]);
  currentPageContent = currentResult.rows.length > 0 ? currentResult.rows[0][0] : '';

  const versions = await getPageHistory(currentSlug);

  if (versions.length === 0) {
    historyVersions.innerHTML = '<div class="history-empty">No version history yet.<br>Save the page to create a version.</div>';
    return;
  }

  historyVersions.innerHTML = versions.map(v => `
    <div class="history-version" data-version-id="${v.id}" data-content="${encodeURIComponent(v.content)}">
      <div class="history-version-time">${formatRelativeTime(v.created_at)}</div>
      <div class="history-version-peer">by ${v.peer_id.slice(0, 8)}</div>
    </div>
  `).join('');
}

function selectVersion(versionEl) {
  // Deselect previous
  historyVersions.querySelectorAll('.history-version').forEach(el => el.classList.remove('selected'));
  versionEl.classList.add('selected');

  // Get content and show diff
  selectedVersionContent = decodeURIComponent(versionEl.dataset.content);
  const diff = computeDiff(currentPageContent, selectedVersionContent);

  historyPreview.innerHTML = `<div class="history-diff">${renderDiff(diff)}</div>`;
  historyActions.classList.remove('hidden');
}

function closeHistoryPanel() {
  historyPanel.classList.add('hidden');
  selectedVersionContent = null;
}

async function restoreVersion() {
  if (!selectedVersionContent) return;
  await savePageWithVersion(currentSlug, selectedVersionContent);
  closeHistoryPanel();
  Parchment.go(currentSlug);
  setStatus('Version restored', 'success');
}

// Normalize slug to lowercase, strip .md extension
function normalizeSlug(path) {
  return (path.replace(/\.md$/, '') || 'home').toLowerCase();
}

// Custom resolver for Parchment - queries SQLite
async function wikiResolver(path) {
  const slug = normalizeSlug(path);
  currentSlug = slug;

  try {
    const result = await db.exec(
      'SELECT content FROM pages WHERE slug = ?',
      [slug]
    );

    if (result.rows.length === 0) {
      return `# ${slug}\n\nThis page doesn't exist yet. Click **Edit** to create it.`;
    }

    return result.rows[0][0];
  } catch (err) {
    console.error('Failed to load page:', err);
    return `# Error\n\nFailed to load page: ${err.message}`;
  }
}

// Save page to database (without creating a version)
async function savePage(slug, content) {
  slug = normalizeSlug(slug);
  const now = new Date().toISOString();
  await db.exec(
    `INSERT INTO pages (slug, content, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    [slug, content, now]
  );
}

// Save page and create a version entry (for explicit user saves)
async function savePageWithVersion(slug, content) {
  slug = normalizeSlug(slug);
  const now = new Date().toISOString();
  const versionId = crypto.randomUUID();

  // Save current page
  await db.exec(
    `INSERT INTO pages (slug, content, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    [slug, content, now]
  );

  // Save to version history
  await db.exec(
    `INSERT INTO page_versions (id, slug, content, created_at, peer_id) VALUES (?, ?, ?, ?, ?)`,
    [versionId, slug, content, now, db.peerId || 'local']
  );
}

// Get page version history
async function getPageHistory(slug, limit = 50) {
  const result = await db.exec(
    `SELECT id, content, created_at, peer_id FROM page_versions
     WHERE slug = ? ORDER BY created_at DESC LIMIT ?`,
    [slug, limit]
  );
  return result.rows.map(([id, content, created_at, peer_id]) =>
    ({ id, content, created_at, peer_id }));
}

// Editor functions
function enterEditMode() {
  isEditing = true;
  wikiContent.classList.add('hidden');
  editorPane.classList.remove('hidden');
  editBtn.textContent = 'Editing...';
  editBtn.disabled = true;

  // Load current content into editor
  wikiResolver(currentSlug).then(content => {
    // If it's a "doesn't exist" page, start with just the title
    if (content.includes("doesn't exist yet")) {
      editorTextarea.value = `# ${currentSlug}\n\n`;
    } else {
      editorTextarea.value = content;
    }
    originalContent = editorTextarea.value;
    updatePreview();
    editorTextarea.focus();
  });
}

function exitEditMode() {
  isEditing = false;
  wikiContent.classList.remove('hidden');
  editorPane.classList.add('hidden');
  editBtn.textContent = 'Edit';
  editBtn.disabled = false;
}

async function updatePreview() {
  let html = marked.parse(editorTextarea.value);
  html = await resolveImageRefs(html);
  editorPreview.innerHTML = html;
}

// Image handling for drag & drop and paste
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function insertImageAtCursor(file) {
  if (!file.type.startsWith('image/')) {
    setStatus('Only image files are supported', 'error');
    return;
  }

  // Limit file size (2MB)
  if (file.size > 2 * 1024 * 1024) {
    setStatus('Image too large (max 2MB)', 'error');
    return;
  }

  setStatus('Processing image...');

  try {
    const base64 = await fileToBase64(file);
    const imageId = crypto.randomUUID().slice(0, 8);
    const name = file.name.replace(/\.[^.]+$/, '') || 'image';
    const now = new Date().toISOString();

    // Store image in database
    await db.exec(
      `INSERT INTO images (id, data, mime_type, name, created_at) VALUES (?, ?, ?, ?, ?)`,
      [imageId, base64, file.type, name, now]
    );

    // Use short reference in markdown
    const markdown = `![${name}](img:${imageId})`;

    // Insert at cursor position
    const start = editorTextarea.selectionStart;
    const end = editorTextarea.selectionEnd;
    const text = editorTextarea.value;
    editorTextarea.value = text.slice(0, start) + markdown + text.slice(end);

    // Move cursor after inserted image
    editorTextarea.selectionStart = editorTextarea.selectionEnd = start + markdown.length;
    editorTextarea.focus();

    updatePreview();
    setStatus('Image added', 'success');
  } catch (err) {
    console.error('Failed to process image:', err);
    setStatus('Failed to add image', 'error');
  }
}

// Resolve image references to data URLs
async function resolveImageRefs(html) {
  const imgRegex = /src="img:([a-f0-9-]+)"/g;
  const matches = [...html.matchAll(imgRegex)];

  for (const match of matches) {
    const imageId = match[1];
    try {
      const result = await db.exec('SELECT data FROM images WHERE id = ?', [imageId]);
      if (result.rows.length > 0) {
        const dataUrl = result.rows[0][0];
        html = html.replace(`src="img:${imageId}"`, `src="${dataUrl}"`);
      }
    } catch (err) {
      console.error('Failed to load image:', imageId, err);
    }
  }

  return html;
}

function handleEditorDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  editorTextarea.classList.add('drag-over');
}

function handleEditorDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  editorTextarea.classList.remove('drag-over');
}

async function handleEditorDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  editorTextarea.classList.remove('drag-over');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    for (const file of files) {
      await insertImageAtCursor(file);
    }
  }
}

async function handleEditorPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        await insertImageAtCursor(file);
      }
      return;
    }
  }
}

async function handleSave() {
  const content = editorTextarea.value;

  try {
    await savePageWithVersion(currentSlug, content);
    setStatus('Page saved', 'success');
    exitEditMode();
    // Refresh the view
    Parchment.go(currentSlug);
  } catch (err) {
    console.error('Failed to save:', err);
    setStatus(`Failed to save: ${err.message}`, 'error');
  }
}

function handleCancel() {
  if (editorTextarea.value !== originalContent) {
    if (!confirm('Discard unsaved changes?')) {
      return;
    }
  }
  exitEditMode();
}

async function handleShare() {
  // Generate invite URL with just the token (no path)
  const url = `${window.location.origin}${window.location.pathname}?token=${currentToken}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('Invite link copied to clipboard!', 'success');
  } catch (err) {
    // Fallback for older browsers
    prompt('Share this invite link:', url);
  }
}

// Initialize
async function init() {
  try {
    // Check URL params
    const params = new URLSearchParams(window.location.search);
    let token = params.get('token');

    // If token in URL, save it and strip from URL
    if (token) {
      // Save as active wiki
      await setActiveWiki(token);
      // Save to history
      saveWikiToHistory(token).catch(err => console.warn('Failed to save wiki history:', err));
      // Strip token from URL, keep path
      params.delete('token');
      const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    } else {
      // No token in URL - check for active wiki
      token = await getActiveWiki();
      if (!token) {
        showWikiPicker();
        return;
      }
    }

    // Store token in module state for share functionality
    currentToken = token;

    // Hide picker and show wiki interface immediately
    hideWikiPicker();

    // Database name includes token for isolation
    const dbName = `scrappy-wiki-${token}`;

    setStatus('Loading database...');

    // Create Ledger instance
    db = new Ledger({ dbName });
    await db.init();

    setStatus('Setting up schema...');

    // Create pages table
    // Note: cr-sqlite requires default values for non-nullable columns
    await db.exec(`
      CREATE TABLE IF NOT EXISTS pages (
        slug TEXT PRIMARY KEY NOT NULL,
        content TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await db.enableSync('pages');

    // Create page versions table for history
    await db.exec(`
      CREATE TABLE IF NOT EXISTS page_versions (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT DEFAULT '',
        content TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        peer_id TEXT DEFAULT ''
      )
    `);
    await db.enableSync('page_versions');

    // Create images table for embedded images
    await db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY NOT NULL,
        data TEXT DEFAULT '',
        mime_type TEXT DEFAULT '',
        name TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await db.enableSync('images');

    // Set up event handlers
    db.on('peer-ready', (peerId) => {
      console.log('Peer connected:', peerId);
      const peerCount = db.getPeers().length;
      updatePeerStatus(peerCount);
      peerIndicator.classList.remove('connecting');
      peerIndicator.classList.add('connected');
      setStatus(`Connected with ${peerCount} peer${peerCount !== 1 ? 's' : ''}`, 'success');
    });

    db.on('peer-leave', (peerId) => {
      console.log('Peer left:', peerId);
      updatePeerStatus(db.getPeers().length);
    });

    db.on('sync', (changeCount, peerId) => {
      console.log(`Synced ${changeCount} changes from ${peerId}`);
      setStatus(`Synced ${changeCount} change${changeCount !== 1 ? 's' : ''}`, 'success');
      // Refresh current page if in view mode
      if (!isEditing) {
        Parchment.go(currentSlug);
      }
    });

    db.on('connected', () => {
      peerIndicator.classList.add('connecting');
      setStatus('Connected to signaling server');
    });

    db.on('disconnected', () => {
      peerIndicator.classList.remove('connected', 'connecting');
      updatePeerStatus(0);
      setStatus('Disconnected from signaling server');
    });

    db.on('reconnecting', (attempt) => {
      peerIndicator.classList.add('connecting');
      peerIndicator.classList.remove('connected');
      setStatus(`Reconnecting... (attempt ${attempt})`);
    });

    db.on('reconnected', () => {
      peerIndicator.classList.add('connecting');
      setStatus('Reconnected to signaling server');
    });

    // Initialize Parchment
    Parchment.init({
      target: '#wiki-content',
      resolver: wikiResolver,
      parser: (text) => marked.parse(text),
      linkSelector: 'a[href]:not([href^="http"]):not([href^="https"]):not([href^="mailto"]):not([href^="#"])',
      historyMode: 'param',
      paramName: 'path',
      onLoad: async (path) => {
        const slug = normalizeSlug(path);
        pageTitle.textContent = slug;
        currentSlug = slug;

        // Resolve image references after render
        const images = wikiContent.querySelectorAll('img[src^="img:"]');
        for (const img of images) {
          const imageId = img.src.replace(/^.*img:/, '');
          try {
            const result = await db.exec('SELECT data FROM images WHERE id = ?', [imageId]);
            if (result.rows.length > 0) {
              img.src = result.rows[0][0];
            }
          } catch (err) {
            console.error('Failed to load image:', imageId, err);
          }
        }
      }
    });

    const path = params.get('path') || 'home';

    // Create default home page if needed
    const homeCheck = await db.exec('SELECT 1 FROM pages WHERE slug = ?', ['home']);
    if (homeCheck.rows.length === 0) {
      await savePage('home', `# Welcome to Scrappy Wiki

This is a peer-to-peer wiki. Any edits you make will sync automatically with anyone who has the same share link.

## Getting Started

1. Click **Edit** to modify this page
2. Create new pages by linking to them: [example](example)

## Features

- Real-time P2P sync via WebRTC
- Markdown editing with live preview
- Works offline (changes sync when reconnected)
- No server required for data storage

Your wiki token: \`${token}\`
`);
    }

    // Load initial page
    await Parchment.go(path);

    // Auto-connect with the token
    setStatus('Connecting to peers...');
    try {
      await db.connect(SIGNALING_URL, token);
      peerIndicator.classList.add('connecting');
      setStatus('Connected! Waiting for peers...');
    } catch (err) {
      console.error('Failed to connect:', err);
      setStatus(`Connection failed: ${err.message}`, 'error');
    }

  } catch (err) {
    console.error('Initialization failed:', err);
    setStatus(`Failed to initialize: ${err.message}`, 'error');
  }
}

// Event listeners
editBtn.addEventListener('click', enterEditMode);
saveBtn.addEventListener('click', handleSave);
cancelBtn.addEventListener('click', handleCancel);
shareBtn.addEventListener('click', handleShare);
editorTextarea.addEventListener('input', updatePreview);
editorTextarea.addEventListener('dragover', handleEditorDragOver);
editorTextarea.addEventListener('dragleave', handleEditorDragLeave);
editorTextarea.addEventListener('drop', handleEditorDrop);
editorTextarea.addEventListener('paste', handleEditorPaste);

// Wiki picker event listeners
homeBtn.addEventListener('click', async () => {
  // Clear active wiki and show picker
  await clearActiveWiki();
  // Disconnect from current database
  if (db) {
    try { db.disconnect(); } catch (e) { /* ignore */ }
  }
  // Clear URL params and show picker
  window.history.replaceState({}, '', window.location.pathname);
  showWikiPicker();
});

newWikiBtn.addEventListener('click', () => {
  const token = crypto.randomUUID().slice(0, 8);
  goToWiki(token);
});

joinWikiBtn.addEventListener('click', () => {
  const token = joinTokenInput.value.trim();
  if (token) {
    goToWiki(token);
  }
});

joinTokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const token = joinTokenInput.value.trim();
    if (token) {
      goToWiki(token);
    }
  }
});

historyList.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('.history-item-delete');
  if (deleteBtn) {
    e.stopPropagation();
    const token = deleteBtn.dataset.delete;
    await deleteWikiFromHistory(token);
    await renderHistoryList();
    return;
  }

  const item = e.target.closest('.history-item');
  if (item) {
    goToWiki(item.dataset.token);
  }
});

// Search event listeners
searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));

searchInput.addEventListener('keydown', (e) => {
  if (!searchDropdown.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectSearchResult(selectedSearchIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectSearchResult(selectedSearchIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedSearchIndex >= 0 && selectedSearchIndex < searchResults.length) {
        navigateToPage(searchResults[selectedSearchIndex].slug);
      } else if (searchInput.value.trim()) {
        // Create new page
        navigateToPage(searchInput.value.trim());
      }
    } else if (e.key === 'Escape') {
      hideSearchDropdown();
      searchInput.blur();
    }
  }
});

searchInput.addEventListener('blur', () => {
  // Delay to allow click on dropdown items
  setTimeout(hideSearchDropdown, 200);
});

searchDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.search-item');
  const createItem = e.target.closest('.search-create');

  if (item) {
    navigateToPage(item.dataset.slug);
  } else if (createItem) {
    navigateToPage(createItem.dataset.create);
  }
});

// Version history panel event listeners
historyBtn.addEventListener('click', openHistoryPanel);
historyClose.addEventListener('click', closeHistoryPanel);
historyCancel.addEventListener('click', closeHistoryPanel);
historyRestore.addEventListener('click', restoreVersion);

historyVersions.addEventListener('click', (e) => {
  const item = e.target.closest('.history-version');
  if (item) {
    selectVersion(item);
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Escape to close history panel
  if (e.key === 'Escape' && !historyPanel.classList.contains('hidden')) {
    closeHistoryPanel();
    return;
  }

  // Cmd/Ctrl+K to focus search
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  if (isEditing) {
    // Cmd/Ctrl+S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      handleCancel();
    }
  } else if (document.activeElement !== searchInput) {
    // E to edit (only when not in search)
    if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      enterEditMode();
    }
    // / to focus search (vim-style)
    if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      searchInput.focus();
    }
  }
});

// Start
init();
