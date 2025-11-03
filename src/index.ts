#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import { z } from "zod";
import EventEmitter from "node:events";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

import {
  bus_reply_stream,
  bus_request_stream,
  Context,
} from "./types.js";
import { create_bus } from "./emitter_bus.js";
import { default_tool } from "./tool.js";
import { nanoid_id_generator } from "./nanoid_id_generator.js";
import { create_logger as create_console_logger } from "./mcp_console_logger.js";

const PORT = 3333; // Browser extension port (SSE + WebSocket)
const MCP_PORT = 3334; // MCP client port

const emitter = new EventEmitter();
const sseClients: http.ServerResponse[] = [];
const wsClients: WebSocket[] = [];

const log = create_console_logger();
const bus = create_bus(log)(emitter);
const id_generator = nanoid_id_generator();

const context: Context = {
  bus,
  id_generator,
  log,
};

// Create FastMCP server
const server = new FastMCP({
  name: "drawio-mcp-server",
  version: "1.2.1",
});

// Helper to adapt MCP tools to FastMCP
function adaptTool(name: string) {
  const tool = default_tool(name, context);
  return async (args: any) => {
    const result = await tool(args, {} as any);
    return JSON.stringify(result);
  };
}

// Register all Draw.io tools
server.addTool({
  name: "get-selected-cell",
  description: "Retrieve selected cell (vertex or edge) on the current page of a Draw.io diagram",
  parameters: z.object({}),
  execute: adaptTool("get-selected-cell"),
});

server.addTool({
  name: "add-rectangle",
  description: "Add new Rectangle vertex cell on the current page of a Draw.io diagram",
  parameters: z.object({
    x: z.number().default(100).describe("X-axis position"),
    y: z.number().default(100).describe("Y-axis position"),
    width: z.number().default(200).describe("Width"),
    height: z.number().default(100).describe("Height"),
    text: z.string().default("New Cell").describe("Text content"),
    style: z.string().default("whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;").describe("Draw.io visual styles"),
  }),
  execute: adaptTool("add-rectangle"),
});

server.addTool({
  name: "add-edge",
  description: "Create an edge (relation) between two vertexes (cells)",
  parameters: z.object({
    source_id: z.string().describe("Source cell ID"),
    target_id: z.string().describe("Target cell ID"),
    text: z.string().optional().describe("Text content"),
    style: z.string().default("edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;").describe("Edge visual styles"),
  }),
  execute: adaptTool("add-edge"),
});

server.addTool({
  name: "delete-cell-by-id",
  description: "Delete a cell (vertex or edge) by ID",
  parameters: z.object({
    cell_id: z.string().describe("Cell ID to delete"),
  }),
  execute: adaptTool("delete-cell-by-id"),
});

server.addTool({
  name: "get-shape-categories",
  description: "Retrieve available shape categories from the diagram's library",
  parameters: z.object({}),
  execute: adaptTool("get-shape-categories"),
});

server.addTool({
  name: "get-shapes-in-category",
  description: "Retrieve all shapes in a category from the diagram's library",
  parameters: z.object({
    category_id: z.string().describe("Category ID"),
  }),
  execute: adaptTool("get-shapes-in-category"),
});

server.addTool({
  name: "get-shape-by-name",
  description: "Retrieve a specific shape by its name",
  parameters: z.object({
    shape_name: z.string().describe("Shape name"),
  }),
  execute: adaptTool("get-shape-by-name"),
});

server.addTool({
  name: "add-cell-of-shape",
  description: "Add new vertex cell by shape name",
  parameters: z.object({
    shape_name: z.string().describe("Shape name"),
    x: z.number().default(100).describe("X-axis position"),
    y: z.number().default(100).describe("Y-axis position"),
    width: z.number().default(200).describe("Width"),
    height: z.number().default(100).describe("Height"),
    text: z.string().optional().describe("Text content"),
    style: z.string().optional().describe("Additional styles"),
  }),
  execute: adaptTool("add-cell-of-shape"),
});

server.addTool({
  name: "set-cell-shape",
  description: "Update visual style of existing vertex cell to match a library shape",
  parameters: z.object({
    cell_id: z.string().describe("Cell ID"),
    shape_name: z.string().describe("Shape name"),
  }),
  execute: adaptTool("set-cell-shape"),
});

server.addTool({
  name: "set-cell-data",
  description: "Set or update custom attribute on existing cell",
  parameters: z.object({
    cell_id: z.string().describe("Cell ID"),
    key: z.string().describe("Attribute name"),
    value: z.union([z.string(), z.number(), z.boolean()]).describe("Attribute value"),
  }),
  execute: adaptTool("set-cell-data"),
});

server.addTool({
  name: "edit-cell",
  description: "Update properties of existing vertex/shape cell",
  parameters: z.object({
    cell_id: z.string().describe("Cell ID"),
    text: z.string().optional().describe("Text content"),
    x: z.number().optional().describe("X position"),
    y: z.number().optional().describe("Y position"),
    width: z.number().optional().describe("Width"),
    height: z.number().optional().describe("Height"),
    style: z.string().optional().describe("Style string"),
  }),
  execute: adaptTool("edit-cell"),
});

server.addTool({
  name: "edit-edge",
  description: "Update properties of existing edge",
  parameters: z.object({
    cell_id: z.string().describe("Edge cell ID"),
    text: z.string().optional().describe("Label text"),
    source_id: z.string().optional().describe("New source ID"),
    target_id: z.string().optional().describe("New target ID"),
    style: z.string().optional().describe("Style string"),
  }),
  execute: adaptTool("edit-edge"),
});

server.addTool({
  name: "list-paged-model",
  description: "Retrieve paginated view of all cells in the diagram",
  parameters: z.object({
    page: z.number().default(0).describe("Page number"),
    page_size: z.number().default(50).describe("Page size"),
    filter: z.object({
      cell_type: z.enum(["edge", "vertex", "object", "layer", "group"]).optional(),
      attributes: z.array(z.any()).optional(),
    }).optional().describe("Filter criteria"),
  }),
  execute: adaptTool("list-paged-model"),
});

// Browser extension forwarder (SSE + WebSocket)
const bus_to_clients_forwarder_listener = (event: any) => {
  const totalClients = sseClients.length + wsClients.length;
  log.debug(`[bridge] forwarding to #${totalClients} clients (${sseClients.length} SSE, ${wsClients.length} WS)`);
  const data = JSON.stringify(event);
  
  // Forward to SSE clients
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      const client = sseClients[i];
      if (!client.writableEnded) {
        client.write(`data: ${data}\n\n`);
      } else {
        sseClients.splice(i, 1);
      }
    } catch (e) {
      sseClients.splice(i, 1);
    }
  }
  
  // Forward to WebSocket clients
  for (let i = wsClients.length - 1; i >= 0; i--) {
    try {
      const client = wsClients[i];
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      } else {
        wsClients.splice(i, 1);
      }
    } catch (e) {
      wsClients.splice(i, 1);
    }
  }
};
emitter.on(bus_request_stream, bus_to_clients_forwarder_listener);

// Start browser extension HTTP server (port 3333)
async function start_browser_extension_server() {
  const httpServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // SSE endpoint
    if (url.pathname === "/events" && req.method === "GET") {
      log.debug(`[browser_sse] Client #${sseClients.length} connected`);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`: connected\n\n`);
      sseClients.push(res);

      req.on("close", () => {
        const index = sseClients.indexOf(res);
        if (index !== -1) {
          sseClients.splice(index, 1);
        }
      });
      return;
    }

    // POST message endpoint
    if (url.pathname === "/message" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          const json = JSON.parse(body);
          log.debug(`[browser_http] received message`);
          emitter.emit(bus_reply_stream, json);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return new Promise<http.Server>((resolve) => {
    httpServer.listen(PORT, () => {
      log.debug(`[browser_server] HTTP server listening on port ${PORT}`);
      
      // Attach WebSocket server
      const wss = new WebSocketServer({ server: httpServer });
      
      wss.on("connection", (ws: WebSocket) => {
        log.debug(`[browser_ws] Client #${wsClients.length} connected`);
        wsClients.push(ws);
        
        // Handle incoming messages from browser extension
        ws.on("message", (data: Buffer) => {
          try {
            const json = JSON.parse(data.toString());
            log.debug(`[browser_ws] received message`);
            emitter.emit(bus_reply_stream, json);
          } catch (e) {
            log.debug(`[browser_ws] Invalid JSON: ${e}`);
          }
        });
        
        // Handle disconnection
        ws.on("close", () => {
          const index = wsClients.indexOf(ws);
          if (index !== -1) {
            wsClients.splice(index, 1);
          }
          log.debug(`[browser_ws] Client disconnected, ${wsClients.length} remaining`);
        });
        
        ws.on("error", (err) => {
          log.debug(`[browser_ws] Error: ${err.message}`);
        });
      });
      
      log.debug(`[browser_server] WebSocket server ready`);
      resolve(httpServer);
    });
  });
}

// Start servers
async function main() {
  log.debug("Draw.io MCP Server starting...");

  // Start browser extension server
  await start_browser_extension_server();
  log.debug(`✅ Browser Extension server started (port ${PORT})`);

  // Start FastMCP server with HTTP streaming (SSE compatible, stateless mode)
  await server.start({
    transportType: "httpStream",
    httpStream: {
      port: MCP_PORT,
      endpoint: "/",
      stateless: true,  // Stateless mode for simpler connections
    },
  });

  log.debug(`✅ MCP Server started on port ${MCP_PORT}`);
  log.debug(`🎉 All 13 tools registered successfully!`);
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
