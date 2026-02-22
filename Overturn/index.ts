import "dotenv/config";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./src/server/create-server.js";

async function startServer(): Promise<void> {
  const server = createServer();
  try {
    const transport = new StdioServerTransport();
    await server.nativeServer.connect(transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[MCP_INTERNAL_ERROR] Failed to start stdio transport: ${message}\n`
    );
    process.exit(1);
  }
}

await startServer();
