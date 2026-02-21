# appeal-writer-mcp

A production-ready MCP server that generates **strictly grounded** medical claim appeal letters using RAG (Retrieval-Augmented Generation). Every factual claim in the output letter is backed by a citation pointing to either the denial letter or an ingested knowledge base document. Unsupported claims surface as `[NEEDS EVIDENCE: ...]` placeholders — never invented facts.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Client (Claude)                    │
└────────────────────────────┬────────────────────────────────┘
                             │  JSON-RPC over stdio
┌────────────────────────────▼────────────────────────────────┐
│                   appeal-writer-mcp                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  kb.ingest   │  │  kb.search   │  │  appeal.plan     │  │
│  │  kb tools    │  │              │  │  appeal.generate │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                   │             │
│  ┌──────▼─────────────────▼───────────────────▼─────────┐  │
│  │           RAG Store (SQLite + TF-IDF / OpenAI)       │  │
│  │  docs table · chunks table · cases table             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Input: DenialCase (from denial-inspector-mcp)              │
│  Output: AppealLetter with citations, checklist, todos      │
└─────────────────────────────────────────────────────────────┘
```

**No-hallucination guarantee**: the grounding verifier scans every generated section. Sentences containing numeric values (dates, amounts, session counts, CPT codes) must have a citation whose snippet contains that value. Violations become `[NEEDS EVIDENCE: ...]` placeholders with corresponding `missingEvidence` items.

---

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9

Optional (for LLM-enhanced generation):
- OpenAI API key (`OPENAI_API_KEY`)

---

## Local Setup

```bash
cd appeal-writer-mcp
npm install
npm run build
```

### Environment variables

Copy `.env.example` and edit as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (unused in stdio mode) |
| `LOG_LEVEL` | `info` | debug / info / warn / error |
| `STORAGE_PATH` | `./data` | SQLite database directory |
| `MAX_FILE_MB` | `20` | Max ingested file size |
| `ENABLE_OCR_DEFAULT` | `false` | Enable OCR for scanned PDFs |
| `USE_EMBEDDINGS` | `false` | Use OpenAI embeddings instead of TF-IDF |
| `OPENAI_API_KEY` | — | Enables embeddings + LLM letter generation |
| `OPENAI_MODEL` | `gpt-4o` | Model for letter generation |

---

## Running Locally

### Stdio mode (for Claude / MCP clients)

```bash
npm start
# or during development:
npm run dev
```

Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "appeal-writer-mcp": {
      "command": "node",
      "args": ["/path/to/appeal-writer-mcp/dist/index.js"],
      "env": {
        "STORAGE_PATH": "/path/to/appeal-writer-mcp/data",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Run the demo script

```bash
npx tsx examples/run_demo.ts
```

This ingests the sample KB documents, loads the Jane Doe denial case, generates a full appeal letter, and prints it along with the missing evidence list and action items.

---

## Testing with Sample Files

### Ingest a document

```bash
# Encode a file to base64
BASE64=$(base64 -i examples/sample_kb_policy.txt)

# Call kb.ingest via MCP (shown as JSON-RPC payload)
echo '{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "kb.ingest",
    "arguments": {
      "documents": [{
        "docId": "policy_cpb045",
        "filename": "sample_kb_policy.txt",
        "mimeType": "text/plain",
        "contentBase64": "'"$BASE64"'",
        "meta": {
          "payerName": "HEALTH INSURANCE COMPANY",
          "docType": "policy",
          "tags": ["physical-therapy", "CPB045"]
        }
      }]
    }
  }
}' | node dist/index.js
```

### Generate an appeal

```bash
CASE=$(cat examples/sample_denial_case.json)

echo '{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": {
    "name": "appeal.generate",
    "arguments": {
      "case": '"$CASE"',
      "options": { "tone": "professional", "includeCitationsInline": true },
      "userContext": {
        "diagnosis": "Lumbar radiculopathy",
        "requestedOutcome": "pay_claim"
      }
    }
  }
}' | node dist/index.js
```

---

## Running Tests

```bash
npm test
```

Test coverage:
- TF-IDF tokenization and cosine similarity correctness
- Deterministic chunking
- SQLite store: ingestion, retrieval, case registry
- Policy chunk retrieval for policy-reference query
- `appeal.generate`: ≥6 sections, attachment checklist, citation coverage
- `appeal.generate`: no uncited numeric claims (amounts, dates, counts)
- `verifySections`: NEEDS EVIDENCE insertion logic
- `appeal.plan`: argument structure, missing evidence detection

---

## Tool Reference

### `kb.ingest`

Ingests one or more files into the local vector knowledge base. Supports `text/plain`, `application/pdf`, and DOCX. Chunks text deterministically and stores TF-IDF vectors (or OpenAI embeddings if configured).

**Example input:**
```json
{
  "documents": [{
    "filename": "cpb045.txt",
    "mimeType": "text/plain",
    "contentBase64": "<base64>",
    "meta": {
      "payerName": "HEALTH INSURANCE COMPANY",
      "docType": "policy",
      "tags": ["physical-therapy", "CPB045"]
    }
  }],
  "options": { "chunkSize": 900, "chunkOverlap": 150 }
}
```

**Example output:**
```json
{
  "ingested": [{ "docId": "a1b2c3d4e5f6", "chunks": 7 }],
  "warnings": []
}
```

---

### `kb.search`

Retrieves the top-K most relevant chunks for a query using TF-IDF cosine similarity (or dense embeddings if enabled). Filter by `payerName`, `docType`, or `tags`.

**Example input:**
```json
{
  "query": "Clinical Policy Bulletin #045 session limit exception",
  "filters": { "payerName": "HEALTH INSURANCE COMPANY", "docType": "policy" },
  "options": { "topK": 5 }
}
```

**Example output:**
```json
{
  "chunks": [{
    "chunkId": "chk_abc123",
    "docId": "policy_cpb045",
    "text": "Exception: Coverage beyond the limit may be approved when significant functional improvement is documented...",
    "score": 0.847,
    "spans": [{ "start": 0, "end": 312 }],
    "meta": { "docType": "policy", "payerName": "HEALTH INSURANCE COMPANY", "tags": ["CPB045"] }
  }]
}
```

---

### `appeal.plan`

Generates an argument plan with evidence requirements and KB retrieval queries. Use this before generating to understand evidence gaps.

**Example input:**
```json
{
  "case": { "caseId": "...", "denialCategory": { "value": "benefit_limit", ... }, ... },
  "userContext": {
    "diagnosis": "Lumbar radiculopathy",
    "requestedOutcome": "pay_claim"
  }
}
```

**Example output:**
```json
{
  "plan": {
    "primaryDenialCategory": "benefit_limit",
    "thesis": "The denial citing benefit limit is improper because the documented clinical need exceeds the plan's standard limitations...",
    "arguments": [
      {
        "claim": "The services described in the denial letter were provided as billed and are accurately coded.",
        "requiredEvidence": ["Itemized bill or superbill from provider", "CPT code documentation for 97110"],
        "retrievalQueries": ["97110 documentation requirements", "claim accuracy itemized bill"]
      }
    ]
  },
  "retrievedContext": [...],
  "missingEvidence": ["No clinical notes found in knowledge base"],
  "warnings": []
}
```

---

### `appeal.generate`

Generates the complete grounded appeal letter. Every paragraph must have a citation or NEEDS EVIDENCE placeholder. Runs multi-query RAG retrieval automatically.

**Example input:**
```json
{
  "case": { "caseId": "a1b2c3d4e5f67890", ... },
  "options": {
    "tone": "professional",
    "includeCitationsInline": true,
    "maxPagesHint": 2
  },
  "userContext": {
    "diagnosis": "Lumbar radiculopathy (ICD-10: M54.4)",
    "requestedOutcome": "pay_claim",
    "patientPhone": "555-867-5309"
  },
  "storeCaseForLookup": true
}
```

**Example output (abbreviated):**
```json
{
  "letterId": "ltr_abc123def456",
  "caseId": "a1b2c3d4e5f67890",
  "payerName": "HEALTH INSURANCE COMPANY",
  "createdAt": "2026-02-21T10:00:00.000Z",
  "tone": "professional",
  "sections": [
    {
      "id": "header",
      "title": "Header",
      "content": "February 21, 2026\n\nJane Doe\n\nHEALTH INSURANCE COMPANY\n...",
      "citations": [
        {
          "kind": "denialCaseSpan",
          "docId": "doc_sample_denial",
          "start": 88,
          "end": 108,
          "snippet": "Member Name: Jane Doe",
          "label": "memberName"
        }
      ]
    },
    {
      "id": "rebuttal",
      "title": "Rebuttal and Supporting Arguments",
      "content": "REBUTTAL — Benefit Limit Exception\n\nYour denial references Clinical Policy Bulletin #045...\n[CITE:kbChunk:policy_cpb045:0-312]",
      "citations": [
        {
          "kind": "kbChunk",
          "docId": "policy_cpb045",
          "start": 0,
          "end": 312,
          "snippet": "Exception: Coverage beyond the limit may be approved...",
          "label": "kb:policy"
        }
      ]
    }
  ],
  "fullText": "...",
  "attachmentChecklist": [
    { "item": "Completed Appeal Request Form", "required": true, "citations": [...] },
    { "item": "Physician / provider letter of medical necessity", "required": true, "citations": [...] },
    { "item": "PT/clinical progress notes for all sessions", "required": true, "citations": [...] }
  ],
  "missingEvidence": [
    "PT progress notes documenting functional improvement measurements",
    "payer's session count record for this member and benefit year"
  ],
  "actionItems": [
    {
      "priority": "p0",
      "action": "Confirm and calendar the appeal deadline: 180 days from the denial letter date.",
      "why": "Missing the appeal deadline permanently waives your right to an internal appeal.",
      "citations": [...]
    }
  ]
}
```

---

### `appeal.generateFromCaseId`

Retrieves a previously saved case and generates a letter. The case must have been saved with `storeCaseForLookup: true` in `appeal.generate`.

```json
{
  "caseId": "a1b2c3d4e5f67890",
  "options": { "tone": "firm" },
  "userContext": { "diagnosis": "Lumbar radiculopathy" }
}
```

---

## Interop with `denial-inspector-mcp`

`appeal-writer-mcp` accepts `DenialCase` objects directly as JSON — no network call needed. The output of `denial-inspector-mcp`'s `denial.parse` or `denial.parseAndHighlight` tools can be passed directly as the `case` parameter to `appeal.generate`.

Typical workflow:
1. `denial.parseAndHighlight` → get `DenialCase` + `HighlightsBundle`
2. `kb.ingest` → ingest payer policy PDF + any clinical notes
3. `appeal.plan` → review evidence gaps
4. `appeal.generate` → get grounded appeal letter

---

## Deploying to Manufact MCP Cloud

### 1. Build

```bash
npm run build
```

### 2. Manufact configuration

Create `manufact.yaml` in the project root:

```yaml
name: appeal-writer-mcp
version: 1.0.0
runtime: node18
entry: dist/index.js
transport: stdio
env:
  - STORAGE_PATH=/data/appeal-writer
  - LOG_LEVEL=info
  - MAX_FILE_MB=20
  - USE_EMBEDDINGS=false
volumes:
  - /data/appeal-writer
```

### 3. Deploy

```bash
# Using Manufact CLI (install separately)
manufact deploy --config manufact.yaml
```

### 4. Persistent storage

The SQLite database persists at `STORAGE_PATH`. On Manufact Cloud, mount a persistent volume at `/data/appeal-writer` to retain the KB across restarts.

### 5. Optional: Enable LLM generation

Set `OPENAI_API_KEY` as a secret in Manufact environment and set `USE_EMBEDDINGS=true` for semantic retrieval + GPT-4o letter generation.

---

## Data Models

### `DenialCase` (input — from denial-inspector-mcp)

All fields use `ExtractedField<T>` with `value`, `confidence`, and `spans[]` (character offsets into `rawText`).

### `Citation`

```typescript
{
  kind: "denialCaseSpan" | "kbChunk",
  docId: string,        // references DenialCase.docMeta.docId or KB doc
  start: number,        // char offset
  end: number,
  snippet: string,      // short context for display
  label: string         // what this citation supports
}
```

### `AppealLetter`

Complete output including:
- `sections[]` — each with `content`, `citations[]`, optional `warnings[]`
- `fullText` — assembled letter with inline `[CITE:...]` tags
- `attachmentChecklist[]` — required and optional attachments with citations
- `missingEvidence[]` — items needing resolution before filing
- `actionItems[]` — prioritized action items (p0/p1/p2)

Inline citation format in `fullText`:
```
[CITE:denialCaseSpan:doc_sample_denial:88-108]
[CITE:kbChunk:policy_cpb045:0-312]
```

The React frontend can parse these tags to highlight source passages.

---

## License

MIT
