export type ContextBudgetZone =
  | "unknown"
  | "ok"
  | "truncate_args"
  | "near_summarize"
  | "at_summarize"

export type ContextBudgetSnapshot = {
  conversation_id: number
  last_input_tokens: number | null
  last_output_tokens: number | null
  max_input_tokens: number
  summarization_threshold: number
  truncate_args_threshold: number
  head_tail_skip_threshold: number
  usage_percent_of_max: number | null
  usage_percent_of_summarize: number | null
  zone: ContextBudgetZone
  zone_label: string
  source: "api_usage" | "estimated" | "none"
  last_message_id: number | null
}

export function formatTokenCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

export function zoneColorClass(zone: ContextBudgetZone): string {
  switch (zone) {
    case "at_summarize":
      return "text-destructive"
    case "near_summarize":
      return "text-amber-600 dark:text-amber-400"
    case "truncate_args":
      return "text-amber-600 dark:text-amber-400"
    case "ok":
      return "text-muted-foreground"
    default:
      return "text-muted-foreground"
  }
}

export function parseUsageFromMessageMetadata(
  metadata: Record<string, unknown> | null | undefined
): { input_tokens?: number; output_tokens?: number } | null {
  if (!metadata || typeof metadata !== "object") return null
  const usage = metadata.usage
  if (!usage || typeof usage !== "object") return null
  const raw = usage as Record<string, unknown>
  const input =
    typeof raw.input_tokens === "number"
      ? raw.input_tokens
      : typeof raw.input_tokens === "string"
        ? Number(raw.input_tokens)
        : undefined
  const output =
    typeof raw.output_tokens === "number"
      ? raw.output_tokens
      : typeof raw.output_tokens === "string"
        ? Number(raw.output_tokens)
        : undefined
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null
  return {
    ...(Number.isFinite(input) ? { input_tokens: input as number } : {}),
    ...(Number.isFinite(output) ? { output_tokens: output as number } : {}),
  }
}
