import { useState, useCallback, useMemo } from "react";
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

interface ParsedFields {
  patient_name?: string;
  patient_address?: string;
  claim_id?: string;
  identifiers?: Array<{ label: string; value: string }>;
  denial_codes?: string[];
  cpt_codes?: string[];
  policy_references?: string[];
  denial_reason_text?: string;
  extraction_notes?: Record<string, boolean>;
}

const T = {
  bg: "#0F0F0F",
  surface: "#1A1A1A",
  surfaceHover: "#222222",
  border: "#2A2A2A",
  borderLight: "#333333",
  accent: "#10B981",
  accentDim: "rgba(16, 185, 129, 0.12)",
  accentText: "#34D399",
  warn: "#F59E0B",
  warnDim: "rgba(245, 158, 11, 0.12)",
  error: "#EF4444",
  errorDim: "rgba(239, 68, 68, 0.12)",
  text: "#F5F5F5",
  textSecondary: "#A3A3A3",
  textMuted: "#737373",
  white: "#FFFFFF",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: `2px solid ${T.borderLight}`,
        borderTopColor: T.accent,
        borderRadius: "50%",
        animation: "spin 0.6s linear infinite",
      }}
    />
  );
}

function Badge({
  label,
  variant = "default",
}: {
  label: string;
  variant?: "default" | "success" | "warn" | "error";
}) {
  const colors = {
    default: { bg: T.accentDim, color: T.accentText },
    success: { bg: T.accentDim, color: T.accentText },
    warn: { bg: T.warnDim, color: T.warn },
    error: { bg: T.errorDim, color: T.error },
  };
  const c = colors[variant];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        background: c.bg,
        color: c.color,
      }}
    >
      {label}
    </span>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 0" }}>
      <span
        style={{
          minWidth: 130,
          color: T.textMuted,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span style={{ color: T.text, fontSize: 13, flex: 1 }}>
        {value || "—"}
      </span>
    </div>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 22px",
        borderRadius: 8,
        border: "none",
        background: disabled || loading ? T.borderLight : T.accent,
        color: disabled || loading ? T.textMuted : T.bg,
        fontWeight: 600,
        fontSize: 14,
        fontFamily: FONT,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        transition: "background 0.15s",
        ...style,
      }}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
  loading,
  style,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 18px",
        borderRadius: 8,
        border: `1px solid ${T.borderLight}`,
        background: "transparent",
        color: disabled || loading ? T.textMuted : T.text,
        fontWeight: 500,
        fontSize: 13,
        fontFamily: FONT,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        transition: "all 0.15s",
        ...style,
      }}
    >
      {loading && <Spinner size={12} />}
      {children}
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3
      style={{
        margin: "0 0 12px",
        fontSize: 14,
        fontWeight: 600,
        color: T.text,
        letterSpacing: 0.3,
      }}
    >
      {title}
    </h3>
  );
}

function StepIndicator({
  step,
  label,
  active,
  done,
}: {
  step: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          background: done ? T.accent : active ? T.accentDim : T.border,
          color: done ? T.bg : active ? T.accentText : T.textMuted,
          border: active ? `2px solid ${T.accent}` : "2px solid transparent",
          transition: "all 0.2s",
        }}
      >
        {done ? "✓" : step}
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          color: active ? T.text : done ? T.textSecondary : T.textMuted,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function DemoCard({
  title,
  description,
  onClick,
  disabled,
}: {
  title: string;
  description: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 16,
        borderRadius: 10,
        border: `1px solid ${T.border}`,
        background: T.surface,
        color: T.text,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "border-color 0.15s, background 0.15s",
        fontFamily: FONT,
        flex: 1,
        minWidth: 180,
      }}
    >
      <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
      <span
        style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}
      >
        {description}
      </span>
    </button>
  );
}

export default function OverturnDashboard() {
  const {
    props,
    isPending: isWidgetPending,
    state,
    setState,
  } = useWidget<Props>();
  const [activeTab, setActiveTab] = useState<"intake" | "claims">("intake");
  const [filePath, setFilePath] = useState(props?.initial_file_path ?? "");
  const [extractResult, setExtractResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [appealLetter, setAppealLetter] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [letterError, setLetterError] = useState<string | null>(null);
  const [letterCopied, setLetterCopied] = useState(false);
  const [expandedClaim, setExpandedClaim] = useState<string | null>(null);

  const {
    callToolAsync: extractAndAnalyze,
    isPending: isExtracting,
  } = useCallTool("extract_and_analyze_denial");
  const {
    callToolAsync: generateLetter,
    isPending: isGenerating,
  } = useCallTool("generate_appeal_draft");
  const { callToolAsync: loadDemo, isPending: isLoadingDemo } =
    useCallTool("load_demo_case");

  const demos = props?.demos ?? [];
  const claims = (state?.claims ?? props?.claims ?? []) as Props["claims"];

  const currentStep = useMemo(() => {
    if (appealLetter) return 3;
    if (extractResult) return 2;
    return 1;
  }, [extractResult, appealLetter]);

  const parsedFields = useMemo<ParsedFields | null>(() => {
    if (!extractResult) return null;
    return (
      (extractResult as { parsed_fields?: ParsedFields }).parsed_fields ?? null
    );
  }, [extractResult]);

  const handleLoadDemo = useCallback(
    async (caseId: string) => {
      setExtractError(null);
      setAppealLetter(null);
      setLetterError(null);
      try {
        const result = await loadDemo({ case_id: caseId } as any);
        const content = (result as { structuredContent?: unknown })
          ?.structuredContent;
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
      const result = await extractAndAnalyze({
        file_path: filePath.trim(),
      } as any);
      const content = (result as { structuredContent?: unknown })
        ?.structuredContent;
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
    const ready = extractResult?.appeal_ready_fields as
      | Record<string, unknown>
      | undefined;
    if (!ready) {
      setLetterError("Extract a denial first.");
      return;
    }
    setLetterError(null);
    try {
      const result = await generateLetter(ready as any);
      const textContent = (result as { structuredContent?: unknown })
        ?.structuredContent;
      setAppealLetter(
        typeof textContent === "string"
          ? textContent
          : String(textContent ?? "")
      );
    } catch (err) {
      setAppealLetter(null);
      setLetterError(err instanceof Error ? err.message : String(err));
    }
  }, [extractResult, generateLetter]);

  const handleCopyLetter = useCallback(() => {
    if (!appealLetter) return;
    navigator.clipboard.writeText(appealLetter).then(() => {
      setLetterCopied(true);
      setTimeout(() => setLetterCopied(false), 2000);
    });
  }, [appealLetter]);

  const handleAddToClaims = useCallback(async () => {
    const ready = extractResult?.appeal_ready_fields as
      | Record<string, unknown>
      | undefined;
    const letter = appealLetter ?? "";
    const patientName = (ready?.patient_name as string) ?? "Unknown";
    const insurer =
      (ready?.insurance_company_name as string) ??
      ((ready?.policy_references as string[]) ?? [])[0] ??
      "Insurance Co.";
    const claimId =
      (ready?.claim_id as string) ?? `CLM-${Date.now().toString(36)}`;
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
    setFilePath("");
    setActiveTab("claims");
  }, [extractResult, appealLetter, claims, setState]);

  const handleReset = useCallback(() => {
    setExtractResult(null);
    setAppealLetter(null);
    setExtractError(null);
    setLetterError(null);
    setFilePath("");
    setLetterCopied(false);
  }, []);

  if (isWidgetPending || !props) {
    return (
      <McpUseProvider autoSize>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: 300,
            background: T.bg,
            fontFamily: FONT,
            color: T.text,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            <Spinner size={32} />
            <span style={{ color: T.textSecondary, fontSize: 14 }}>
              Loading Overturn...
            </span>
          </div>
        </div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <div
        style={{
          fontFamily: FONT,
          background: T.bg,
          color: T.text,
          minHeight: 400,
          borderRadius: 16,
          overflow: "hidden",
          border: `1px solid ${T.border}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: T.accentDim,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
              }}
            >
              ⚖
            </div>
            <div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: -0.3,
                }}
              >
                Overturn
              </div>
              <div style={{ fontSize: 11, color: T.textMuted }}>
                Insurance Claim Appeal Engine
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              onClick={() => setActiveTab("intake")}
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                border: "none",
                background:
                  activeTab === "intake" ? T.accentDim : "transparent",
                color:
                  activeTab === "intake" ? T.accentText : T.textMuted,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: FONT,
                transition: "all 0.15s",
              }}
            >
              Intake
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("claims")}
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                border: "none",
                background:
                  activeTab === "claims" ? T.accentDim : "transparent",
                color:
                  activeTab === "claims" ? T.accentText : T.textMuted,
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: FONT,
                transition: "all 0.15s",
              }}
            >
              Claims{" "}
              {claims.length > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: T.accent,
                    color: T.bg,
                    fontSize: 10,
                    fontWeight: 700,
                    marginLeft: 4,
                  }}
                >
                  {claims.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Intake Tab */}
        {activeTab === "intake" && (
          <div style={{ padding: 24 }}>
            {/* Step Progress */}
            <div
              style={{
                display: "flex",
                gap: 32,
                marginBottom: 24,
                paddingBottom: 20,
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <StepIndicator
                step={1}
                label="Upload / Select"
                active={currentStep === 1}
                done={currentStep > 1}
              />
              <div
                style={{
                  width: 40,
                  height: 1,
                  background: currentStep > 1 ? T.accent : T.border,
                  alignSelf: "center",
                }}
              />
              <StepIndicator
                step={2}
                label="Review & Generate"
                active={currentStep === 2}
                done={currentStep > 2}
              />
              <div
                style={{
                  width: 40,
                  height: 1,
                  background: currentStep > 2 ? T.accent : T.border,
                  alignSelf: "center",
                }}
              />
              <StepIndicator
                step={3}
                label="Appeal Ready"
                active={currentStep === 3}
                done={false}
              />
            </div>

            {/* Step 1: Input */}
            {currentStep === 1 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                }}
              >
                <Card>
                  <SectionHeader title="Upload Denial Document" />
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="text"
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                      placeholder="Path to denial PDF..."
                      style={{
                        flex: 1,
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: `1px solid ${T.borderLight}`,
                        background: T.bg,
                        color: T.text,
                        fontSize: 14,
                        fontFamily: FONT,
                        outline: "none",
                      }}
                    />
                    <PrimaryButton
                      onClick={handleExtract}
                      loading={isExtracting}
                      disabled={!filePath.trim()}
                    >
                      Extract
                    </PrimaryButton>
                  </div>
                </Card>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: T.border,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: T.textMuted,
                      fontWeight: 500,
                    }}
                  >
                    OR TRY A DEMO CASE
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 1,
                      background: T.border,
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <DemoCard
                    title="Medical Necessity"
                    description="PT sessions denied — benefit limit reached (CARC 50, 119)"
                    onClick={() =>
                      handleLoadDemo("demo_medical_necessity")
                    }
                    disabled={isLoadingDemo}
                  />
                  <DemoCard
                    title="Prior Authorization"
                    description="MRI denied — missing pre-authorization (CARC 197)"
                    onClick={() => handleLoadDemo("demo_prior_auth")}
                    disabled={isLoadingDemo}
                  />
                  <DemoCard
                    title="Coding Error"
                    description="Office visit denied — diagnosis-procedure mismatch (CARC 11, 16)"
                    onClick={() => handleLoadDemo("demo_coding_error")}
                    disabled={isLoadingDemo}
                  />
                </div>

                {isLoadingDemo && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      color: T.textSecondary,
                      fontSize: 13,
                    }}
                  >
                    <Spinner size={14} /> Loading demo case...
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Extracted Data */}
            {currentStep === 2 && parsedFields && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                }}
              >
                <Card>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 16,
                    }}
                  >
                    <SectionHeader title="Extracted Claim Data" />
                    <Badge label="Parsed" variant="success" />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "0 24px",
                    }}
                  >
                    <FieldRow
                      label="Patient"
                      value={parsedFields.patient_name}
                    />
                    <FieldRow
                      label="Claim ID"
                      value={parsedFields.claim_id}
                    />
                    <FieldRow
                      label="Address"
                      value={parsedFields.patient_address}
                    />
                    <FieldRow
                      label="CPT Codes"
                      value={parsedFields.cpt_codes?.join(", ")}
                    />
                  </div>

                  {parsedFields.identifiers &&
                    parsedFields.identifiers.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <span
                          style={{
                            fontSize: 12,
                            color: T.textMuted,
                            fontWeight: 500,
                          }}
                        >
                          Identifiers
                        </span>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginTop: 6,
                          }}
                        >
                          {parsedFields.identifiers.map((id) => (
                            <span
                              key={id.label}
                              style={{
                                padding: "4px 10px",
                                borderRadius: 6,
                                background: T.bg,
                                border: `1px solid ${T.border}`,
                                fontSize: 12,
                                color: T.textSecondary,
                              }}
                            >
                              <strong>{id.label}:</strong> {id.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                </Card>

                <Card>
                  <SectionHeader title="Denial Details" />
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginBottom: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    {parsedFields.denial_codes?.map((code) => (
                      <Badge
                        key={code}
                        label={`CARC ${code}`}
                        variant="error"
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      padding: 14,
                      background: T.bg,
                      borderRadius: 8,
                      border: `1px solid ${T.border}`,
                      fontSize: 13,
                      lineHeight: 1.6,
                      color: T.textSecondary,
                    }}
                  >
                    {parsedFields.denial_reason_text ||
                      "No denial reason text available."}
                  </div>
                </Card>

                <div style={{ display: "flex", gap: 12 }}>
                  <SecondaryButton onClick={handleReset}>
                    Start Over
                  </SecondaryButton>
                  <PrimaryButton
                    onClick={handleGenerateLetter}
                    loading={isGenerating}
                  >
                    Generate Appeal Letter
                  </PrimaryButton>
                </div>
              </div>
            )}

            {/* Step 3: Appeal Letter */}
            {currentStep === 3 && appealLetter && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                }}
              >
                <Card>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 16,
                    }}
                  >
                    <SectionHeader title="Generated Appeal Letter" />
                    <div style={{ display: "flex", gap: 8 }}>
                      <Badge label="AI Enhanced" variant="success" />
                      <SecondaryButton onClick={handleCopyLetter}>
                        {letterCopied ? "Copied!" : "Copy"}
                      </SecondaryButton>
                    </div>
                  </div>
                  <div
                    style={{
                      padding: 20,
                      background: T.bg,
                      borderRadius: 10,
                      border: `1px solid ${T.border}`,
                      maxHeight: 400,
                      overflow: "auto",
                    }}
                  >
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 13,
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        color: T.textSecondary,
                        fontFamily: FONT,
                      }}
                    >
                      {appealLetter}
                    </pre>
                  </div>
                </Card>

                <div style={{ display: "flex", gap: 12 }}>
                  <SecondaryButton onClick={handleReset}>
                    Process Another
                  </SecondaryButton>
                  <SecondaryButton
                    onClick={() => {
                      setAppealLetter(null);
                      setLetterError(null);
                    }}
                  >
                    Re-generate
                  </SecondaryButton>
                  <PrimaryButton onClick={handleAddToClaims}>
                    Save to Claims
                  </PrimaryButton>
                </div>
              </div>
            )}

            {/* Errors */}
            {extractError && (
              <Card
                style={{
                  marginTop: 16,
                  background: T.errorDim,
                  border: `1px solid ${T.error}33`,
                }}
              >
                <div
                  style={{
                    color: T.error,
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {extractError}
                </div>
              </Card>
            )}
            {letterError && (
              <Card
                style={{
                  marginTop: 16,
                  background: T.errorDim,
                  border: `1px solid ${T.error}33`,
                }}
              >
                <div
                  style={{
                    color: T.error,
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  {letterError}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Claims Tab */}
        {activeTab === "claims" && (
          <div style={{ padding: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 20,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  Claims Pipeline
                </h2>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    color: T.textMuted,
                  }}
                >
                  {claims.length} appeal
                  {claims.length !== 1 ? "s" : ""} processed
                </p>
              </div>
              <PrimaryButton
                onClick={() => {
                  handleReset();
                  setActiveTab("intake");
                }}
              >
                + New Appeal
              </PrimaryButton>
            </div>

            {claims.length === 0 ? (
              <Card
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 48,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: T.accentDim,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    marginBottom: 16,
                  }}
                >
                  ⚖
                </div>
                <p
                  style={{
                    color: T.textSecondary,
                    fontSize: 14,
                    margin: "0 0 4px",
                  }}
                >
                  No appeals yet
                </p>
                <p
                  style={{
                    color: T.textMuted,
                    fontSize: 13,
                    margin: 0,
                  }}
                >
                  Process a denial in the Intake tab to get started.
                </p>
              </Card>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {/* Table Header */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.5fr 1fr 0.7fr 0.8fr 80px",
                    padding: "8px 16px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: T.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  <span>Patient</span>
                  <span>Insurer</span>
                  <span>Status</span>
                  <span>Date</span>
                  <span></span>
                </div>

                {claims.map((c) => (
                  <div key={c.id}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "1.5fr 1fr 0.7fr 0.8fr 80px",
                        padding: "14px 16px",
                        background: T.surface,
                        borderRadius: 10,
                        border: `1px solid ${T.border}`,
                        alignItems: "center",
                        cursor: c.appeal_letter ? "pointer" : "default",
                      }}
                      onClick={() =>
                        c.appeal_letter &&
                        setExpandedClaim(
                          expandedClaim === c.id ? null : c.id
                        )
                      }
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                          }}
                        >
                          {c.patient_name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: T.textMuted,
                            marginTop: 2,
                          }}
                        >
                          {c.id}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 13,
                          color: T.textSecondary,
                        }}
                      >
                        {c.insurer}
                      </span>
                      <Badge
                        label={c.status}
                        variant={
                          c.status === "drafted"
                            ? "warn"
                            : c.status === "sent"
                              ? "success"
                              : "default"
                        }
                      />
                      <span
                        style={{
                          fontSize: 13,
                          color: T.textMuted,
                        }}
                      >
                        {c.denial_date ?? "—"}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: T.textMuted,
                          textAlign: "right",
                        }}
                      >
                        {c.appeal_letter
                          ? expandedClaim === c.id
                            ? "▲ Hide"
                            : "▼ View"
                          : ""}
                      </span>
                    </div>

                    {expandedClaim === c.id && c.appeal_letter && (
                      <div
                        style={{
                          margin: "0 8px",
                          padding: 20,
                          background: T.surface,
                          borderRadius: "0 0 10px 10px",
                          borderLeft: `1px solid ${T.border}`,
                          borderRight: `1px solid ${T.border}`,
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 12,
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            color: T.textSecondary,
                            fontFamily: FONT,
                            maxHeight: 300,
                            overflow: "auto",
                          }}
                        >
                          {c.appeal_letter}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </McpUseProvider>
  );
}
