import { MCPServer } from "mcp-use/server";

import { registerServerHandlers } from "./register";

export function createServer(): MCPServer {
  const server = new MCPServer({
    name: "hicda-mcp-server",
    title: "Health Insurance Claim Denial Analyzer",
    version: "1.0.0",
    description:
      "MCP server for denial PDF extraction, denial code interpretation, and appeal draft generation.",
  });

  registerServerHandlers(server);
  return server;
}
