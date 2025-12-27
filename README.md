# Scrappy Wiki

A peer-to-peer wiki that syncs in real-time between browsers using WebRTC.

[Try here!](https://wiki.drifting.ink)

This was an idea that came to me after creating [@drifting-ink/ledger](https://github.com/kholbekj/ledger). Combining it with [Parchment](https://github.com/kholbekj/parchment), a simple distributed wiki is born. This allows people to share a token and thereby a completely decentralized offline-first wiki.

The current conflict resolution is weak, and simultaneous offline edits to the same page will have latest write win. However, there's now version history so you can recover "lost" edits.

You can drag & drop or paste images into the editor - they're stored separately and sync across peers.

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

## Always-On Sync Daemon

Since this is P2P, data only syncs when peers are connected. To keep a wiki online 24/7, you can run a sync daemon on your server.

### Setup

```bash
# Install dependencies
npm install

# Run the daemon
node sync-daemon.js YOUR_TOKEN

# Or with a custom wiki URL
node sync-daemon.js YOUR_TOKEN http://localhost:3000
```

### Running as a Service

Using PM2:
```bash
npm install -g pm2
pm2 start sync-daemon.js -- YOUR_TOKEN
pm2 save
pm2 startup
```

Using systemd (create `/etc/systemd/system/scrappy-wiki.service`):
```ini
[Unit]
Description=Scrappy Wiki Sync Daemon
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/scrappy_wiki
ExecStart=/usr/bin/node sync-daemon.js YOUR_TOKEN
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable scrappy-wiki
sudo systemctl start scrappy-wiki
```

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
