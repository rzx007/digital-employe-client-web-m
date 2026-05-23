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
  return parsed.flatMap((item): ClarifyingQuestion[] => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const id = typeof record.id === "string" ? record.id : ""
    const prompt = typeof record.prompt === "string" ? record.prompt : ""
    if (!id || !prompt) return []
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
      const answer = answers[q.id]?.trim() || "（未作答）"
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
  if (questions.length > 0) {
    const parsed = resultText ? parseClarifyRespondMessage(resultText) : {}
    return questions.map((q) => ({
      question: q.prompt,
      answer: parsed[q.id]?.trim() || "（未填写）",
    }))
  }

  return parseClarifyAnswerItemsFromNumberedText(resultText)
}
