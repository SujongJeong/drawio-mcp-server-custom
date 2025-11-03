# Architecture

## Core Capabilities
- **Bi-directional Communication**: Real-time interaction between MCP clients and Draw.io
- **SSE Bridge**: Built-in HTTP server (port 3333) for browser extension connectivity using Server-Sent Events
- **Standardized Protocol**: Full MCP compliance for seamless agent integration
- **Debugging Support**: Integrated with Chrome DevTools via `--inspect` flag

## Architecture Highlights
- Event-driven system using Node.js EventEmitter
- Server-Sent Events (SSE) for efficient server-to-client streaming
- HTTP POST endpoint for client-to-server messaging
- Zod schema validation for all tool parameters
- Plugin-ready design for additional tool development

## Communication Protocol
The server uses a hybrid approach for bi-directional communication:
- **Server → Client**: SSE endpoint (`GET /events`) for real-time event streaming
- **Client → Server**: HTTP POST endpoint (`POST /message`) for sending messages
- **MCP Client ↔ Server**: stdio transport for MCP protocol communication

*Note: Additional tools can be easily added by extending the server implementation.*
