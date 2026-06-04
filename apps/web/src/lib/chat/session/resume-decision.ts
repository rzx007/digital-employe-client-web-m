export type ResumeDecisionInput = {
  hitlActive: boolean
  lastAssistantStreamState: string | undefined
  lastAssistantId: string | undefined
  resumeAttemptedFor: string | null
}

export function shouldAttemptResume(input: ResumeDecisionInput): boolean {
  if (input.hitlActive) return false
  if (input.lastAssistantStreamState !== "streaming") return false
  if (!input.lastAssistantId) return false
  if (input.resumeAttemptedFor === input.lastAssistantId) return false
  return true
}
