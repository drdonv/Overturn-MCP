# MCP Server built with mcp-use

This is an MCP server project bootstrapped with [`create-mcp-use-app`](https://mcp-use.com/docs/typescript/getting-started/quickstart).

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000/inspector](http://localhost:3000/inspector) with your browser to test your server.

### Overturn dashboard widget (Claude / Manufact)

Use the **`open_overturn_dashboard`** tool to open the Overturn appeal widget. The widget lets users:

- Enter a denial PDF path and run **Extract & analyze** (calls `extract_and_analyze_denial`)
- View parsed claim fields and **Generate appeal letter** (calls `generate_appeal_draft` with RAG + optional Claude enhancement)
- **Add to claims** and switch to the Claims tab to see the pipeline

You can pass `initial_file_path` to pre-fill the PDF path. Add this MCP server in Claude or Manufact to use the widget in chat.

You can start building by editing the entry file. Add tools, resources, and prompts — the server auto-reloads as you edit.

## Learn More

To learn more about mcp-use and MCP:

- [mcp-use Documentation](https://mcp-use.com/docs/typescript/getting-started/quickstart) — guides, API reference, and tutorials

## Deploy on Manufact Cloud

```bash
npm run deploy
```
