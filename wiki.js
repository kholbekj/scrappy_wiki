import { Ledger } from '@drifting-ink/ledger';
import { marked } from 'marked';

// Parchment is UMD, esm.sh wraps it - access via window after import
await import('@drifting-ink/parchment');
const Parchment = window.Parchment;

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

// State
let db = null;
let currentSlug = 'home';
let isEditing = false;
let originalContent = '';

// Configuration
const SIGNALING_URL = 'ws://localhost:8081';

// Status helpers
function setStatus(message, type = '') {
  statusMessage.textContent = message;
  statusBar.className = 'status-bar' + (type ? ` ${type}` : '');
}

function updatePeerStatus(count) {
  peerCount.textContent = `${count} peer${count !== 1 ? 's' : ''}`;
  peerIndicator.classList.toggle('connected', count > 0);
}

// Custom resolver for Parchment - queries SQLite
async function wikiResolver(path) {
  const slug = path.replace(/\.md$/, '') || 'home';
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

// Save page to database
async function savePage(slug, content) {
  const now = new Date().toISOString();
  await db.exec(
    `INSERT INTO pages (slug, content, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
    [slug, content, now]
  );
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

function updatePreview() {
  editorPreview.innerHTML = marked.parse(editorTextarea.value);
}

async function handleSave() {
  const content = editorTextarea.value;

  try {
    await savePage(currentSlug, content);
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
  // Copy URL to clipboard (token is always present)
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    setStatus('Link copied to clipboard!', 'success');
  } catch (err) {
    // Fallback for older browsers
    prompt('Share this URL:', url);
  }
}

// Initialize
async function init() {
  try {
    // Check URL params - token is required
    const params = new URLSearchParams(window.location.search);
    let token = params.get('token');

    // If no token, generate one and redirect
    if (!token) {
      token = crypto.randomUUID().slice(0, 8);
      params.set('token', token);
      window.location.search = params.toString();
      return;
    }

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

    // Set up event handlers
    db.on('peer-ready', (peerId) => {
      console.log('Peer connected:', peerId);
      updatePeerStatus(db.getPeers().length);
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
      setStatus(`Reconnecting... (attempt ${attempt})`);
    });

    // Initialize Parchment
    Parchment.init({
      target: '#wiki-content',
      resolver: wikiResolver,
      parser: (text) => marked.parse(text),
      linkSelector: 'a[href]:not([href^="http"]):not([href^="https"]):not([href^="mailto"]):not([href^="#"])',
      historyMode: 'param',
      paramName: 'path',
      onLoad: (path) => {
        const slug = path.replace(/\.md$/, '') || 'home';
        pageTitle.textContent = slug;
        currentSlug = slug;
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

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
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
  } else {
    // E to edit
    if (e.key === 'e' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      enterEditMode();
    }
  }
});

// Start
init();
