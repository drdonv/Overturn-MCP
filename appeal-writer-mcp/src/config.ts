import path from "path";

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

export const config = {
  port: envInt("PORT", 3000),
  logLevel: env("LOG_LEVEL", "info"),
  storagePath: path.resolve(env("STORAGE_PATH", "./data")),
  maxFileMb: envInt("MAX_FILE_MB", 20),
  enableOcrDefault: envBool("ENABLE_OCR_DEFAULT", false),
  useEmbeddings: envBool("USE_EMBEDDINGS", false) && !!process.env.OPENAI_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  openaiModel: env("OPENAI_MODEL", "gpt-4o"),
  openaiEmbeddingModel: "text-embedding-3-small",
} as const;

export type Config = typeof config;

export function log(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: unknown
): void {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const configLevel = levels[config.logLevel as keyof typeof levels] ?? 1;
  if (levels[level] < configLevel) return;
  const line = meta
    ? `[appeal-writer-mcp] [${level.toUpperCase()}] ${message} ${JSON.stringify(meta)}`
    : `[appeal-writer-mcp] [${level.toUpperCase()}] ${message}`;
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stderr.write(line + "\n");
  }
}
