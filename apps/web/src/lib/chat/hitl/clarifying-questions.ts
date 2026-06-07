/** 与 ClarifyingQuestionsDock reject 文案一致（仅真正取消时用） */
export const CLARIFY_SKIP_REJECT_MESSAGE = "用户跳过澄清"

/** 用户点「用默认继续」：让 Agent 按合理假设派活，勿再弹澄清 */
export const CLARIFY_DEFAULT_ASSUMPTIONS_MESSAGE =
  "用户选择不逐项澄清。请根据当前对话与常见合理默认直接拆解并 create_orchestration_plan；" +
  "对「前端 demo」类需求默认：现代简洁 UI、React/Vite、单页可本地运行、无需后端；" +
  "禁止再次调用 submit_clarifying_questions。"

/** 选择题手填答案在 respond 文本中的前缀，便于 Agent 识别 */
export const CLARIFY_CHOICE_CUSTOM_PREFIX = "其他："

export type ClarifyingQuestionType = "choice" | "text"

export interface ClarifyingQuestion {
  id: string
  prompt: string
  required?: boolean
  type?: ClarifyingQuestionType
  options?: string[]
}

export interface ClarifyAnswerItem {
  question: string
  answer: string
}

function parseOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const options = raw.filter(
    (o): o is string => typeof o === "string" && o.trim().length > 0
  )
  return options.length > 0 ? options : undefined
}

function normalizeClarifyingQuestionsArray(
  parsed: unknown
): ClarifyingQuestion[] {
  if (!Array.isArray(parsed)) return []
  // 兼容旧格式：["问题一？", "问题二？"]
  if (parsed.every((item) => typeof item === "string" && item.trim())) {
    return parsed.map((item, index) => ({
      id: `q${index + 1}`,
      prompt: (item as string).trim(),
      type: "text" as const,
    }))
  }
  return parsed.flatMap((item, index): ClarifyingQuestion[] => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const id =
      typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : `q${index + 1}`
    const promptRaw =
      typeof record.prompt === "string"
        ? record.prompt
        : typeof record.question === "string"
          ? record.question
          : typeof record.text === "string"
            ? record.text
            : ""
    const prompt = promptRaw.trim()
    if (!prompt) return []
    const options = parseOptions(record.options)
    const explicitType =
      record.type === "choice" || record.type === "text"
        ? record.type
        : undefined
    const type: ClarifyingQuestionType =
      explicitType ?? (options && options.length >= 2 ? "choice" : "text")
    const question: ClarifyingQuestion = {
      id,
      prompt,
      required: record.required === true,
      type,
    }
    if (options) {
      question.options = options
    }
    return [question]
  })
}

export function parseClarifyingQuestions(raw: unknown): ClarifyingQuestion[] {
  if (Array.isArray(raw)) {
    return normalizeClarifyingQuestionsArray(raw)
  }
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    return normalizeClarifyingQuestionsArray(JSON.parse(raw))
  } catch {
    return []
  }
}

export function optionLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

/** 将单题原始作答格式化为提交给 Agent 的文本 */
export function formatClarifyAnswer(
  question: ClarifyingQuestion,
  rawAnswer: string | undefined
): string {
  const trimmed = (rawAnswer ?? "").trim()
  if (!trimmed) return "（未作答）"
  if (
    question.type === "choice" &&
    question.options &&
    question.options.length > 0 &&
    !question.options.includes(trimmed)
  ) {
    return `${CLARIFY_CHOICE_CUSTOM_PREFIX}${trimmed}`
  }
  return trimmed
}

export function buildClarifyRespondMessage(
  questions: ClarifyingQuestion[],
  answers: Record<string, string>,
  context?: string,
  optionalDetails?: string
): string {
  const header =
    context === "long_document"
      ? "用户对长文档澄清问题的回答："
      : "用户对问题的回答："

  const body = questions
    .map((q, i) => {
      const answer = formatClarifyAnswer(q, answers[q.id])
      return `${i + 1}. ${q.prompt}\n   答：${answer}`
    })
    .join("\n\n")

  if (optionalDetails?.trim()) {
    return `${header}\n\n${body}\n\n补充说明：${optionalDetails.trim()}`
  }

  return `${header}\n\n${body}`
}

export function parseClarifyRespondMessage(
  text: string
): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /- \[([^\]]+)\][^\n]*\n\s*答：([^\n]*)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    out[match[1]] = match[2].trim()
  }
  return out
}

/** 从 buildClarifyRespondMessage 产出的编号列表文本解析问答 */
export function parseClarifyAnswerItemsFromNumberedText(
  resultText: string | null
): ClarifyAnswerItem[] {
  if (!resultText?.trim()) return []

  const items: ClarifyAnswerItem[] = []
  let currentQuestion: string | null = null

  for (const line of resultText.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const questionMatch = trimmed.match(/^\d+\.\s*(.+)$/)
    if (questionMatch) {
      if (currentQuestion) {
        items.push({ question: currentQuestion, answer: "（未填写）" })
      }
      currentQuestion = questionMatch[1].trim()
      continue
    }

    const answerMatch = trimmed.match(/^答[：:]\s*(.+)$/)
    if (answerMatch && currentQuestion) {
      items.push({
        question: currentQuestion,
        answer: answerMatch[1].trim() || "（未填写）",
      })
      currentQuestion = null
    }
  }

  if (currentQuestion) {
    items.push({ question: currentQuestion, answer: "（未填写）" })
  }

  return items
}

export function buildClarifyAnswerItems(
  questions: ClarifyingQuestion[],
  resultText: string | null
): ClarifyAnswerItem[] {
  const numbered = parseClarifyAnswerItemsFromNumberedText(resultText)

  if (questions.length === 0) {
    return numbered
  }

  const parsed = resultText ? parseClarifyRespondMessage(resultText) : {}
  const fromIds = questions.map((q) => ({
    question: q.prompt,
    answer: parsed[q.id]?.trim() || "（未填写）",
  }))

  const idParseEmpty = fromIds.every((item) => item.answer === "（未填写）")
  if (idParseEmpty && numbered.length > 0) {
    if (numbered.length === questions.length) {
      return numbered
    }
    return questions.map((q, i) => ({
      question: q.prompt,
      answer: numbered[i]?.answer ?? "（未填写）",
    }))
  }

  return fromIds
}

type ClarifyToolPart = {
  type?: string
  state?: string
  input?: unknown
  output?: unknown
}

function recoverClarifyInputFromPart(part: ClarifyToolPart): Record<string, unknown> {
  let input = part.input
  if (input != null && typeof input === "object") {
    const record = input as Record<string, unknown>
    if (record.questions != null) {
      return record
    }
  }
  const output = part.output
  const inputText =
    output != null &&
    typeof output === "object" &&
    typeof (output as Record<string, unknown>).inputText === "string"
      ? ((output as Record<string, unknown>).inputText as string)
      : undefined
  if (inputText?.trim()) {
    try {
      const parsed = JSON.parse(inputText) as unknown
      if (parsed != null && typeof parsed === "object") {
        return parsed as Record<string, unknown>
      }
    } catch {
      // ignore malformed streaming JSON
    }
  }
  return input != null && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {}
}

/** 从消息 parts 中提取待答澄清题的 tool input（群投影 / 冷启动 hydrate） */
export function extractClarifyInputFromMessageParts(
  parts: unknown
): Record<string, unknown> {
  if (!Array.isArray(parts)) return {}
  for (let i = parts.length - 1; i >= 0; i--) {
    const raw = parts[i]
    if (!raw || typeof raw !== "object") continue
    const part = raw as ClarifyToolPart
    if (part.type !== "tool-submit_clarifying_questions") continue
    if (
      part.state === "output-available" ||
      part.state === "output-error"
    ) {
      continue
    }
    const input = recoverClarifyInputFromPart(part)
    if (Object.keys(input).length > 0) return input
  }
  return {}
}
