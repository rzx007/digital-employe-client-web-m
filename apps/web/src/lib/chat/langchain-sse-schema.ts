import { z } from "zod"

// ── Shared primitives ──────────────────────────────────────────────

const constructorType = z.literal("constructor")

// ── Tool Call schemas ──────────────────────────────────────────────

export const toolCallSchema = z.object({
  name: z.string().nullable().optional(),
  args: z.record(z.unknown()).optional(),
  id: z.string().nullable().optional(),
  type: z.string().optional(),
})

export const toolCallChunkSchema = z.object({
  name: z.string().nullable().optional(),
  args: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  index: z.number().nullable().optional(),
  type: z.string().optional(),
})

export const invalidToolCallSchema = z.object({
  name: z.string().nullable().optional(),
  args: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  error: z.unknown().nullable().optional(),
  type: z.string().optional(),
})

// ── Response Metadata ──────────────────────────────────────────────

export const responseMetadataSchema = z.object({
  model_provider: z.string().optional(),
  finish_reason: z.string().optional(),
  model_name: z.string().optional(),
})

// ── LangGraph Metadata ─────────────────────────────────────────────

export const langgraphMetadataSchema = z.object({
  ls_integration: z.string().optional(),
  versions: z.record(z.string()).optional(),
  lc_agent_name: z.string().nullable().optional(),
  thread_id: z.number().optional(),
  langgraph_step: z.number().optional(),
  langgraph_node: z.string().optional(),
  langgraph_triggers: z.array(z.string()).optional(),
  langgraph_path: z.array(z.unknown()).optional(),
  langgraph_checkpoint_ns: z.string().optional(),
  checkpoint_ns: z.string().optional(),
  ls_provider: z.string().optional(),
  ls_model_name: z.string().optional(),
  ls_model_type: z.string().optional(),
  ls_temperature: z.number().nullable().optional(),
})

// ── Message schemas ────────────────────────────────────────────────

export const aiMessageChunkKwargsSchema = z.object({
  content: z.string().optional(),
  response_metadata: responseMetadataSchema.optional(),
  type: z.string().optional(),
  id: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
  tool_call_chunks: z.array(toolCallChunkSchema).optional(),
  invalid_tool_calls: z.array(invalidToolCallSchema).optional(),
  chunk_position: z.string().optional(),
})

export const aiMessageChunkSchema = z.object({
  lc: z.number(),
  type: constructorType,
  id: z.tuple([
    z.literal("langchain"),
    z.literal("schema"),
    z.literal("messages"),
    z.literal("AIMessageChunk"),
  ]),
  kwargs: aiMessageChunkKwargsSchema,
})

export const aiMessageSchema = z.object({
  lc: z.number(),
  type: constructorType,
  id: z.tuple([
    z.literal("langchain"),
    z.literal("schema"),
    z.literal("messages"),
    z.literal("AIMessage"),
  ]),
  kwargs: z.object({
    content: z.string(),
    response_metadata: responseMetadataSchema.optional(),
    type: z.literal("ai"),
    id: z.string(),
    tool_calls: z.array(toolCallSchema).optional(),
    invalid_tool_calls: z.array(invalidToolCallSchema).optional(),
  }),
})

export const toolMessageSchema = z.object({
  lc: z.number(),
  type: constructorType,
  id: z.tuple([
    z.literal("langchain"),
    z.literal("schema"),
    z.literal("messages"),
    z.literal("ToolMessage"),
  ]),
  kwargs: z.object({
    content: z.string(),
    type: z.literal("tool"),
    name: z.string().optional(),
    id: z.string().optional(),
    tool_call_id: z.string().optional(),
    status: z.string().optional(),
  }),
})

export const humanMessageSchema = z.object({
  lc: z.number(),
  type: constructorType,
  id: z.tuple([
    z.literal("langchain"),
    z.literal("schema"),
    z.literal("messages"),
    z.literal("HumanMessage"),
  ]),
  kwargs: z.object({
    content: z.string(),
    type: z.literal("human"),
    id: z.string().optional(),
  }),
})

export const messageSchema = z.union([
  aiMessageChunkSchema,
  aiMessageSchema,
  toolMessageSchema,
  humanMessageSchema,
])

// ── Messages Event (v2): {"type": "messages", "ns": [...], "data": [Message, Metadata]} ──

export const sseMessagesEventSchema = z.object({
  type: z.literal("messages"),
  ns: z.array(z.string()),
  data: z.tuple([messageSchema, langgraphMetadataSchema.passthrough()]),
})

// ── Update schemas ─────────────────────────────────────────────────

export const skillMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
  metadata: z.record(z.unknown()),
  license: z.unknown().nullable(),
  compatibility: z.unknown().nullable(),
  allowed_tools: z.array(z.unknown()),
})

export const skillsMiddlewareSchema = z.object({
  "SkillsMiddleware.before_agent": z
    .object({
      skills_metadata: z.array(skillMetadataSchema),
    })
    .optional()
    .nullable(),
})

export const patchMiddlewareSchema = z.object({
  "PatchToolCallsMiddleware.before_agent": z
    .object({
      messages: z.object({
        __type__: z.string(),
        value: z.array(humanMessageSchema),
      }),
    })
    .optional()
    .nullable(),
})

export const memoryMiddlewareSchema = z.object({
  "MemoryMiddleware.before_agent": z
    .object({
      memory_contents: z.record(z.string()),
    })
    .optional()
    .nullable(),
})

export const modelUpdateSchema = z.object({
  model: z
    .object({
      messages: z.array(aiMessageSchema),
    })
    .optional()
    .nullable(),
})

export const toolsUpdateSchema = z.object({
  tools: z
    .object({
      messages: z.array(toolMessageSchema),
    })
    .optional()
    .nullable(),
})

export const todoMiddlewareSchema = z.object({
  "TodoListMiddleware.after_model": z.unknown().nullable(),
})

export const updatePayloadSchema = z.union([
  skillsMiddlewareSchema,
  patchMiddlewareSchema,
  memoryMiddlewareSchema,
  modelUpdateSchema,
  toolsUpdateSchema,
  todoMiddlewareSchema,
  z.record(z.unknown()),
])

// ── Updates Event (v2): {"type": "updates", "ns": [...], "data": UpdatePayload} ──────

export const sseUpdatesEventSchema = z.object({
  type: z.literal("updates"),
  ns: z.array(z.string()),
  data: updatePayloadSchema,
})

export const toolOutputDataSchema = z.object({
  tool_name: z.string(),
  chunk: z.string(),
  chunk_seq: z.number(),
  stream: z.string(),
})

export const toolOutputEventSchema = z.object({
  type: z.literal("tool_output"),
  data: toolOutputDataSchema,
})

// ── Top-level SSE Event (v2, extensible) ───────────────────────────

export const sseEventSchema = z.union([
  sseMessagesEventSchema,
  sseUpdatesEventSchema,
  toolOutputEventSchema,
  z.object({ type: z.string(), data: z.unknown(), ns: z.array(z.string()).optional() }),
])

// ── Type exports ───────────────────────────────────────────────────

export type ToolCall = z.infer<typeof toolCallSchema>
export type ToolCallChunk = z.infer<typeof toolCallChunkSchema>
export type InvalidToolCall = z.infer<typeof invalidToolCallSchema>
export type ResponseMetadata = z.infer<typeof responseMetadataSchema>
export type LangGraphMetadata = z.infer<typeof langgraphMetadataSchema>

export type AIMessageChunk = z.infer<typeof aiMessageChunkSchema>
export type AIMessage = z.infer<typeof aiMessageSchema>
export type ToolMessage = z.infer<typeof toolMessageSchema>
export type HumanMessage = z.infer<typeof humanMessageSchema>
export type Message = z.infer<typeof messageSchema>

export type SkillMetadata = z.infer<typeof skillMetadataSchema>
export type SkillsMiddleware = z.infer<typeof skillsMiddlewareSchema>
export type PatchMiddleware = z.infer<typeof patchMiddlewareSchema>
export type MemoryMiddleware = z.infer<typeof memoryMiddlewareSchema>
export type ModelUpdate = z.infer<typeof modelUpdateSchema>
export type ToolsUpdate = z.infer<typeof toolsUpdateSchema>
export type TodoMiddleware = z.infer<typeof todoMiddlewareSchema>
export type UpdatePayload = z.infer<typeof updatePayloadSchema>

export type SSEMessagesEvent = z.infer<typeof sseMessagesEventSchema>
export type SSEUpdatesEvent = z.infer<typeof sseUpdatesEventSchema>
export type ToolOutputData = z.infer<typeof toolOutputDataSchema>
export type SSEToolOutputEvent = z.infer<typeof toolOutputEventSchema>
export type SSEEvent = z.infer<typeof sseEventSchema>
