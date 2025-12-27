# Scrappy Wiki

A peer-to-peer wiki that syncs in real-time between browsers using WebRTC.

## How It Works

- **Storage**: Pages are stored in SQLite (via IndexedDB) in your browser using [cr-sqlite](https://github.com/vlcn-io/cr-sqlite) for CRDT-based conflict resolution
- **Sync**: Changes sync directly between peers via WebRTC data channels
- **Signaling**: Initial peer discovery uses a lightweight WebSocket server (only for connection setup, no data passes through)
- **Rendering**: Markdown pages are rendered using [Parchment](https://github.com/kholbekj/parchment) with a custom SQLite resolver

## Usage

1. Open the wiki - a unique token is generated automatically
2. Share the URL to collaborate with others
3. Edit pages with the Edit button or press `E`
4. Create new pages by linking to them: `[new page](new-page)`
5. Search pages with `/` or `Cmd/Ctrl+K`

## Features

- Real-time P2P sync (no central server for data)
- Markdown editing with live preview
- Fuzzy search across all pages
- Works offline (syncs when peers reconnect)
- Each token = isolated wiki with its own database

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `E` | Edit current page |
| `Escape` | Cancel editing |
| `Cmd/Ctrl+S` | Save page |
| `/` or `Cmd/Ctrl+K` | Focus search |

## Dependencies

- [@drifting-ink/ledger](https://github.com/kholbekj/ledger) - P2P SQLite sync
- [@drifting-ink/parchment](https://github.com/kholbekj/parchment) - Markdown navigation
- [marked](https://github.com/markedjs/marked) - Markdown parser

## Running Locally

```bash
# Serve the wiki
npx serve .

# Open in browser
open http://localhost:3000
```

## Signaling Server

By default, the wiki connects to `wss://drifting.ink/ws/signal` for peer discovery.

To use a different signaling server, edit `SIGNALING_URL` in `wiki.js`:

```javascript
const SIGNALING_URL = 'wss://your-server.com/ws/signal';
```

The signaling server must implement Ledger's protocol:
- Accept WebSocket connections at `?token=<room>`
- Handle JSON messages: `join`, `offer`, `answer`, `ice`
- See [ledger/server/signaling.js](https://github.com/kholbekj/ledger/blob/main/server/signaling.js) for a Node.js reference implementation

## Architecture

```
Browser A                          Browser B
┌─────────────────┐               ┌─────────────────┐
│  SQLite (WASM)  │◄─────────────►│  SQLite (WASM)  │
│  + cr-sqlite    │   WebRTC      │  + cr-sqlite    │
└────────┬────────┘  DataChannel  └────────┬────────┘
         │                                  │
         └──────────┬───────────────────────┘
                    │
           Signaling Server
          (peer discovery only)
```

## License

MIT
