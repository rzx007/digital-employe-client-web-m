import type { ClassifiedBlock } from "../message-classifier"
import type { ToolViewModel } from "./tool-view-model"

import { planGeneratedHandler, type ToolBlockHandler } from "./handlers/plan-generated"
import { documentPlanHandler } from "./handlers/document-plan"
import { clarifyAnswersHandler } from "./handlers/clarify-answers"
import { recruitmentHandler } from "./handlers/recruitment"
import { employeeCrudHandler } from "./handlers/employee-crud"
import { taskMutationsHandler } from "./handlers/task-mutations"

export const TOOL_BLOCK_HANDLERS: ToolBlockHandler[] = [
  planGeneratedHandler,
  documentPlanHandler,
  clarifyAnswersHandler,
  recruitmentHandler,
  employeeCrudHandler,
  taskMutationsHandler,
]

export function getToolBlockFromRegistry(
  vm: ToolViewModel,
  messageId: string,
  index: number
): ClassifiedBlock | ClassifiedBlock[] | null {
  for (const handler of TOOL_BLOCK_HANDLERS) {
    if (handler.match(vm)) {
      const block = handler.classify(vm, messageId, index)
      if (block) {
        return block
      }
    }
  }
  return null
}

// Re-export types
export type { ToolBlockHandler }
