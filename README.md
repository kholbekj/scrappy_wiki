# Scrappy Wiki

A peer-to-peer wiki that syncs in real-time between browsers using WebRTC.

[Try here!](https://wiki.drifting.ink)

This was an idea that came to me after creating [@drifting-ink/ledger](https://github.com/kholbekj/ledger). Combining it with [Parchment](https://github.com/kholbekj/parchment), a simple distributed wiki is born. This allows people to share a token and thereby a completely decentralized offline-first wiki. 

The current conflict resolution is weak, and simultaneous offline edits to the same page will have latest write win.

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
