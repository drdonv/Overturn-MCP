import { error } from "mcp-use/server";

export type McpErrorCode =
  | "MCP_INVALID_INPUT"
  | "MCP_RESOURCE_UNREADABLE"
  | "MCP_INTERNAL_ERROR";

export const mcpErrorResponse = (code: McpErrorCode, message: string) =>
  error(`[${code}] ${message}`);

export const getErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const classifyPdfError = (
  err: unknown
): { code: McpErrorCode; message: string } => {
  const message = getErrorMessage(err);
  const lower = message.toLowerCase();

  if (/password|encrypted|encryption/i.test(message)) {
    return {
      code: "MCP_RESOURCE_UNREADABLE",
      message:
        "The PDF appears encrypted/password-protected and cannot be parsed.",
    };
  }

  if (/enoent|no such file|eisdir|enotdir/i.test(lower)) {
    return {
      code: "MCP_INVALID_INPUT",
      message: "Invalid file path. Ensure the PDF exists and is readable.",
    };
  }

  if (/eacces|eperm|permission denied/i.test(lower)) {
    return {
      code: "MCP_RESOURCE_UNREADABLE",
      message: "Permission denied while reading the PDF file path.",
    };
  }

  if (/invalid pdf|format error|corrupt|xref|bad xref/i.test(lower)) {
    return {
      code: "MCP_RESOURCE_UNREADABLE",
      message: `PDF parsing failed. The file may be malformed or unsupported. Details: ${message}`,
    };
  }

  return {
    code: "MCP_RESOURCE_UNREADABLE",
    message: `Failed to read or parse the PDF denial document. Details: ${message}`,
  };
};
