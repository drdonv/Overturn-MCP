import { useState, useCallback } from "react";
import {
  McpUseProvider,
  useWidget,
  useCallTool,
  type WidgetMetadata,
} from "mcp-use/react";
import { z } from "zod";

const propsSchema = z.object({
  initial_file_path: z.string().optional(),
  demos: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
      })
    )
    .optional()
    .default([]),
  claims: z
    .array(
      z.object({
        id: z.string(),
        patient_name: z.string(),
        insurer: z.string(),
        status: z.string(),
        denial_date: z.string().optional(),
        appeal_letter: z.string().optional(),
      })
    )
    .optional()
    .default([]),
});

export const widgetMetadata: WidgetMetadata = {
  description:
    "Overturn appeal dashboard: process denial PDFs, view extracted data, generate appeal letters, and manage claims pipeline.",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

const COLORS = {
  paper: "#FDFCF8",
  moss: "#5D7052",
  clay: "#C18C5D",
  ink: "#2C2C2C",
  muted: "#6B7280",
  error: "#B91C1C",
  success: "#15803D",
};

export default function OverturnDashboard() {
  const { props, isPending: isWidgetPending, state, setState } = useWidget<Props>();
  const [activeTab, setActiveTab] = useState<"intake" | "claims">("intake");
  const [filePath, setFilePath] = useState(props?.initial_file_path ?? "");
  const [extractResult, setExtractResult] = useState<Record<string, unknown> | null>(null);
  const [appealLetter, setAppealLetter] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [letterError, setLetterError] = useState<string | null>(null);

  const { callToolAsync: extractAndAnalyze, isPending: isExtracting } = useCallTool(
    "extract_and_analyze_denial"
  );
  const { callToolAsync: generateLetter, isPending: isGenerating } = useCallTool(
    "generate_appeal_draft"
  );
  const { callToolAsync: loadDemo, isPending: isLoadingDemo } = useCallTool(
    "load_demo_case"
  );

  const demos = props?.demos ?? [];
  const claims = (state?.claims ?? props?.claims ?? []) as Props["claims"];

  const handleLoadDemo = useCallback(
    async (caseId: string) => {
      setExtractError(null);
      setAppealLetter(null);
      setLetterError(null);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await loadDemo({ case_id: caseId } as any);
        const content = (result as { structuredContent?: unknown })?.structuredContent;
        if (content && typeof content === "object") {
          setExtractResult(content as Record<string, unknown>);
        } else {
          setExtractError("Unexpected response loading demo.");
        }
      } catch (err) {
        setExtractError(err instanceof Error ? err.message : String(err));
      }
    },
    [loadDemo]
  );

  const handleExtract = useCallback(async () => {
    if (!filePath.trim()) {
      setExtractError("Enter a file path to the denial PDF.");
      return;
    }
    setExtractError(null);
    setAppealLetter(null);
    setLetterError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await extractAndAnalyze({ file_path: filePath.trim() } as any);
      const content = (result as { structuredContent?: unknown })?.structuredContent;
      if (content && typeof content === "object") {
        setExtractResult(content as Record<string, unknown>);
      } else {
        setExtractResult(null);
        setExtractError("Unexpected response from server.");
      }
    } catch (err) {
      setExtractResult(null);
      setExtractError(err instanceof Error ? err.message : String(err));
    }
  }, [filePath, extractAndAnalyze]);

  const handleGenerateLetter = useCallback(async () => {
    const ready = extractResult?.appeal_ready_fields as Record<string, unknown> | undefined;
    if (!ready) {
      setLetterError("Extract a denial first to get appeal-ready fields.");
      return;
    }
    setLetterError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await generateLetter(ready as any);
      const textContent = (result as { structuredContent?: unknown })?.structuredContent;
      setAppealLetter(typeof textContent === "string" ? textContent : String(textContent ?? ""));
    } catch (err) {
      setAppealLetter(null);
      setLetterError(err instanceof Error ? err.message : String(err));
    }
  }, [extractResult, generateLetter]);

  const handleAddToClaims = useCallback(async () => {
    const ready = extractResult?.appeal_ready_fields as Record<string, unknown> | undefined;
    const letter = appealLetter ?? "";
    const patientName = (ready?.patient_name as string) ?? "Unknown";
    const insurer = (ready?.policy_references as string[])?.[0] ?? "Unknown";
    const claimId = (ready?.claim_id as string) ?? crypto.randomUUID();
    const newClaim = {
      id: claimId,
      patient_name: patientName,
      insurer,
      status: "drafted",
      denial_date: new Date().toISOString().slice(0, 10),
      appeal_letter: letter,
    };
    const nextClaims = [...claims, newClaim];
    await setState?.({ claims: nextClaims });
    setExtractResult(null);
    setAppealLetter(null);
    setActiveTab("claims");
  }, [extractResult, appealLetter, claims, setState]);

  if (isWidgetPending || !props) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 24, background: COLORS.paper, color: COLORS.ink }}>
          <p>Loading Overturn dashboard…</p>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div
        style={{
          fontFamily: "system-ui, sans-serif",
          background: COLORS.paper,
          color: COLORS.ink,
          minHeight: 320,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(93, 112, 82, 0.12)",
        }}
      >
        <div
          style={{
            background: COLORS.moss,
            color: "white",
            padding: "12px 20px",
            fontWeight: 600,
            fontSize: 18,
          }}
        >
          Overturn — Appeal Denials
        </div>

        <div style={{ display: "flex", borderBottom: `1px solid ${COLORS.clay}33` }}>
          <button
            type="button"
            onClick={() => setActiveTab("intake")}
            style={{
              flex: 1,
              padding: 12,
              border: "none",
              background: activeTab === "intake" ? COLORS.clay + "22" : "transparent",
              color: activeTab === "intake" ? COLORS.moss : COLORS.muted,
              fontWeight: activeTab === "intake" ? 600 : 400,
              cursor: "pointer",
            }}
          >
            Intake
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("claims")}
            style={{
              flex: 1,
              padding: 12,
              border: "none",
              background: activeTab === "claims" ? COLORS.clay + "22" : "transparent",
              color: activeTab === "claims" ? COLORS.moss : COLORS.muted,
              fontWeight: activeTab === "claims" ? 600 : 400,
              cursor: "pointer",
            }}
          >
            Claims ({claims.length})
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {activeTab === "intake" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                  Denial PDF path
                </label>
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/path/to/denial.pdf or workspace-relative path"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 9999,
                    border: `1px solid ${COLORS.clay}88`,
                    fontSize: 14,
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleExtract}
                disabled={isExtracting}
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 20px",
                  borderRadius: 9999,
                  border: "none",
                  background: COLORS.moss,
                  color: "white",
                  fontWeight: 600,
                  cursor: isExtracting ? "wait" : "pointer",
                }}
              >
                {isExtracting ? "Extracting…" : "Extract & analyze"}
              </button>
              <div
                style={{
                  padding: 14,
                  background: COLORS.clay + "11",
                  borderRadius: 12,
                  border: `1px dashed ${COLORS.clay}66`,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
                  Or load a demo case:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleLoadDemo("demo_medical_necessity")}
                    disabled={isLoadingDemo}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 9999,
                      border: `1px solid ${COLORS.moss}`,
                      background: "white",
                      color: COLORS.moss,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: isLoadingDemo ? "wait" : "pointer",
                    }}
                  >
                    PT benefit limit (CARC 50, 119)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadDemo("demo_prior_auth")}
                    disabled={isLoadingDemo}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 9999,
                      border: `1px solid ${COLORS.moss}`,
                      background: "white",
                      color: COLORS.moss,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: isLoadingDemo ? "wait" : "pointer",
                    }}
                  >
                    MRI prior auth (CARC 197)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLoadDemo("demo_coding_error")}
                    disabled={isLoadingDemo}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 9999,
                      border: `1px solid ${COLORS.moss}`,
                      background: "white",
                      color: COLORS.moss,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: isLoadingDemo ? "wait" : "pointer",
                    }}
                  >
                    Coding error (CARC 11, 16)
                  </button>
                </div>
                {isLoadingDemo && (
                  <p style={{ fontSize: 13, color: COLORS.muted, marginTop: 6 }}>
                    Loading demo case…
                  </p>
                )}
              </div>

              {extractError && (
                <p style={{ color: COLORS.error, fontSize: 14 }}>{extractError}</p>
              )}

              {extractResult && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 16,
                    background: "white",
                    borderRadius: 12,
                    border: `1px solid ${COLORS.clay}44`,
                  }}
                >
                  <h4 style={{ margin: "0 0 8px", color: COLORS.moss }}>
                    Parsed fields
                  </h4>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 12,
                      overflow: "auto",
                      maxHeight: 160,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(
                      (extractResult as { parsed_fields?: unknown }).parsed_fields ?? extractResult,
                      null,
                      2
                    )}
                  </pre>
                  <button
                    type="button"
                    onClick={handleGenerateLetter}
                    disabled={isGenerating}
                    style={{
                      marginTop: 12,
                      padding: "8px 16px",
                      borderRadius: 9999,
                      border: "none",
                      background: COLORS.clay,
                      color: "white",
                      fontWeight: 600,
                      cursor: isGenerating ? "wait" : "pointer",
                    }}
                  >
                    {isGenerating ? "Generating…" : "Generate appeal letter"}
                  </button>
                  {letterError && (
                    <p style={{ color: COLORS.error, fontSize: 14, marginTop: 8 }}>
                      {letterError}
                    </p>
                  )}
                </div>
              )}

              {appealLetter && (
                <div
                  style={{
                    padding: 16,
                    background: "white",
                    borderRadius: 12,
                    border: `1px solid ${COLORS.clay}44`,
                  }}
                >
                  <h4 style={{ margin: "0 0 8px", color: COLORS.moss }}>
                    Appeal letter
                  </h4>
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 12,
                      overflow: "auto",
                      maxHeight: 240,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {appealLetter}
                  </pre>
                  <button
                    type="button"
                    onClick={handleAddToClaims}
                    style={{
                      marginTop: 12,
                      padding: "8px 16px",
                      borderRadius: 9999,
                      border: "none",
                      background: COLORS.moss,
                      color: "white",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Add to claims
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "claims" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {claims.length === 0 ? (
                <p style={{ color: COLORS.muted }}>
                  No claims yet. Use Intake to process a denial and add an appeal.
                </p>
              ) : (
                claims.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      padding: 14,
                      background: "white",
                      borderRadius: 12,
                      border: `1px solid ${COLORS.clay}44`,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{c.patient_name}</div>
                    <div style={{ fontSize: 13, color: COLORS.muted }}>
                      {c.insurer} · {c.status} {c.denial_date ? `· ${c.denial_date}` : ""}
                    </div>
                    {c.appeal_letter && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: "pointer", fontSize: 13 }}>
                          View letter
                        </summary>
                        <pre
                          style={{
                            marginTop: 8,
                            fontSize: 11,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            maxHeight: 120,
                            overflow: "auto",
                          }}
                        >
                          {c.appeal_letter.slice(0, 500)}
                          {c.appeal_letter.length > 500 ? "…" : ""}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </McpUseProvider>
  );
}
