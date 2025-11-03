# SSE Migration Guide

## Overview

This document describes the migration from WebSocket to Server-Sent Events (SSE) protocol for the Draw.io MCP server.

## What Changed

### Communication Protocol

**Before (WebSocket):**
- Full-duplex communication via WebSocket on port 3333
- Single connection for bidirectional messaging
- Used `uWebSockets.js` library

**After (SSE + HTTP):**
- Server-to-client: SSE via `GET /events`
- Client-to-server: HTTP POST via `POST /message`
- Uses native Node.js `http` module

### Benefits of SSE

1. **Simplicity**: No external dependencies required (removed `uWebSockets.js`)
2. **Standard HTTP**: Works with standard HTTP infrastructure
3. **Automatic Reconnection**: Browsers handle SSE reconnection automatically
4. **Firewall Friendly**: Uses standard HTTP/HTTPS ports and protocols
5. **Lighter Weight**: Native Node.js implementation, smaller bundle size

## API Endpoints

### SSE Endpoint (Server → Client)

```
GET http://localhost:3333/events
```

**Response Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Format:**
```
data: {"event": "example", "payload": {...}}\n\n
```

### Message Endpoint (Client → Server)

```
POST http://localhost:3333/message
Content-Type: application/json

{"event": "example", "payload": {...}}
```

**Response:**
```json
{"success": true}
```

## Browser Extension Changes Required

If you're using a browser extension to connect to this server, update it to:

1. **Replace WebSocket connection** with EventSource for receiving events:
```javascript
// Old
const ws = new WebSocket('ws://localhost:3333');

// New
const eventSource = new EventSource('http://localhost:3333/events');
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // handle event
};
```

2. **Replace WebSocket send** with HTTP POST for sending messages:
```javascript
// Old
ws.send(JSON.stringify(message));

// New
fetch('http://localhost:3333/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(message)
});
```

## Code Changes Summary

### Files Modified

1. **src/index.ts**
   - Removed `uWebSockets.js` import
   - Added Node.js `http` module
   - Replaced `conns: uWS.WebSocket[]` with `sseClients: http.ServerResponse[]`
   - Replaced `start_websocket_server()` with `start_http_server()`
   - Implemented SSE endpoint (`/events`)
   - Implemented HTTP POST endpoint (`/message`)
   - Updated event forwarding to use SSE format

2. **package.json**
   - Removed `uWebSockets.js` dependency

3. **Documentation**
   - Updated `README.md` with new Communication Protocol section
   - Updated `ARCHITECTURE.md` with SSE details
   - Updated `TROUBLESHOOTING.md` with SSE-specific troubleshooting

## Testing

To verify the migration:

1. Start the server:
```bash
npm run build
node build/index.js
```

2. Test SSE connection:
```bash
curl -N http://localhost:3333/events
```

3. Test POST endpoint:
```bash
curl -X POST http://localhost:3333/message \
  -H "Content-Type: application/json" \
  -d '{"test": "message"}'
```

## Rollback

To rollback to WebSocket:

1. Restore `uWebSockets.js` dependency in `package.json`
2. Revert `src/index.ts` to use WebSocket implementation
3. Update browser extension to use WebSocket

## Notes

- SSE is unidirectional (server to client), so we use HTTP POST for client-to-server communication
- CORS is enabled by default for development
- Connection management is handled automatically by the HTTP module
- Client disconnections are detected via the `close` event on the request

