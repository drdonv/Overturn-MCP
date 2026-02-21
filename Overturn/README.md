# MCP Server built with mcp-use

This is an MCP server project bootstrapped with [`create-mcp-use-app`](https://mcp-use.com/docs/typescript/getting-started/quickstart).

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000/inspector](http://localhost:3000/inspector) with your browser to test your server.

You can start building by editing the entry file. Add tools, resources, and prompts — the server auto-reloads as you edit.

## Learn More

To learn more about mcp-use and MCP:

- [mcp-use Documentation](https://mcp-use.com/docs/typescript/getting-started/quickstart) — guides, API reference, and tutorials

## Deploy on Manufact Cloud

```bash
npm run deploy
```

## Production Deploy Notes

- Transport is `stdio` (configured in `index.ts` and `manufact.yaml`).
- Deploy entrypoint is `dist/index.js` and build command is `npm ci && npm run build`.
- Set `GEMINI_API_KEY` as a secret for LLM parsing in Manufact.
- Optional: set `ANTHROPIC_API_KEY` and toggle `USE_CLAUDE_PARSER=true` if you switch parser providers.
- Keep `GEMINI_MODEL` and `USE_CLAUDE_PARSER` in env config (non-secret).
