import "dotenv/config";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./src/server/create-server";

let shutdownInProgress = false;

function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function shutdown(code: number): void {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;
  process.exit(code);
}

async function startServer(): Promise<void> {
  const server = createServer();
  try {
    const transport = new StdioServerTransport();
    await server.nativeServer.connect(transport);
    writeStderr("[MCP_INFO] Overturn MCP server connected over stdio.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeStderr(
      `[MCP_INTERNAL_ERROR] Failed to start stdio transport: ${message}`
    );
    shutdown(1);
  }
}

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  writeStderr(`[MCP_INTERNAL_ERROR] Unhandled promise rejection: ${message}`);
  shutdown(1);
});

process.on("uncaughtException", (error) => {
  writeStderr(`[MCP_INTERNAL_ERROR] Uncaught exception: ${error.stack ?? error.message}`);
  shutdown(1);
});

process.on("SIGINT", () => {
  writeStderr("[MCP_INFO] SIGINT received, shutting down.");
  shutdown(0);
});

process.on("SIGTERM", () => {
  writeStderr("[MCP_INFO] SIGTERM received, shutting down.");
  shutdown(0);
});

await startServer();
