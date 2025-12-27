# Scrappy Wiki - Agent Guide

A P2P wiki combining Ledger (WebRTC + SQLite sync) and Parchment (markdown navigation).

## Project Structure

```
scrappy_wiki/
├── index.html      # Main HTML with import maps
├── wiki.js         # Application logic (ES module)
├── wiki.css        # Styling
└── README.md       # User documentation
```

## Key Files

### wiki.js

Main application logic:
- **Ledger integration**: Database init, schema, sync events
- **Parchment integration**: Custom resolver that queries SQLite
- **Editor**: Toggle edit mode, live preview, save to DB
- **Search**: Fuzzy search with autocomplete dropdown

Key functions:
- `normalizeSlug(path)` - Lowercase slugs, strip .md
- `wikiResolver(path)` - Parchment resolver, queries SQLite
- `savePage(slug, content)` - Upsert page to database
- `searchPages(query)` - Fuzzy match against all pages
- `fuzzyMatch(query, text)` - Scoring algorithm for search

### Database Schema

```sql
CREATE TABLE pages (
  slug TEXT PRIMARY KEY NOT NULL,
  content TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Note: cr-sqlite requires DEFAULT values for all non-PK columns.

## URL Structure

```
?token=<room>&path=<page-slug>
```

- `token`: Required. Determines database name and sync room
- `path`: Optional. Page to display (default: "home")

Database name: `scrappy-wiki-{token}`

## Dependencies (via esm.sh)

- `@drifting-ink/ledger` - P2P SQLite sync
- `@drifting-ink/parchment@0.2.0` - Markdown navigation (must use 0.2.0+ for query param preservation)
- `marked` - Markdown parser

## Signaling Server

Production: `wss://drifting.ink/ws/signal`

Protocol (Ledger-compatible):
- Connect with `?token=<room>`
- Send: `{ type: 'join', peerId: '...' }`
- Receive: `{ type: 'peers', peerIds: [...] }`
- Relay: `offer/answer/ice` messages with `to`/`from` fields

## Common Tasks

### Adding a new page field

1. Update schema in `wiki.js` (remember DEFAULT value)
2. Update `savePage()` to include field
3. Schema changes won't sync - all peers need same schema

### Changing signaling server

Update `SIGNALING_URL` constant in `wiki.js`

### Modifying search behavior

- `fuzzyMatch()` - Adjust scoring weights
- `searchPages()` - Change result limit or matching logic
- `renderSearchDropdown()` - Modify dropdown UI

## Keyboard Shortcuts

Defined in the global `keydown` listener:
- `E` - Edit page (when not in search/edit mode)
- `/` or `Cmd/Ctrl+K` - Focus search
- `Escape` - Cancel edit or close search
- `Cmd/Ctrl+S` - Save (in edit mode)
- `Arrow Up/Down` - Navigate search results
- `Enter` - Select search result
