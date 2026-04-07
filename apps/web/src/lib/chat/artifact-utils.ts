import type { UIMessage } from "ai"

import type { Artifact, ArtifactType } from "@/types/artifact"

type ToolPart = Extract<UIMessage["parts"][number], { type: `tool-${string}` }>

interface ToolOutputPayload {
  input?: Record<string, unknown>
  inputText?: string
  text?: string
  toolName?: string | null
  status?: string | null
}

interface ToolInputPayload {
  file_path?: unknown
  content?: unknown
  new_string?: unknown
}

/**
 * 获取文件路径中的文件扩展名
 * @param filePath - 文件路径字符串
 * @returns 返回文件扩展名（小写），如果无法找到扩展名则返回null
 */
function getFileExtension(filePath: string) {
  // 使用正则表达式匹配文件扩展名
  const match = /\.([a-z0-9]+)$/i.exec(filePath)
  return match?.[1]?.toLowerCase() ?? null
}

/**
 * 从文件路径中提取文件名
 * @param filePath - 完整的文件路径，支持正斜杠或反斜杠作为分隔符
 * @returns 返回提取出的文件名，如果无法提取则返回原路径
 */
function getFileName(filePath: string) {
  // 将所有反斜杠替换为正斜杠以统一路径格式
  const normalized = filePath.replace(/\\/g, "/")
  // 按斜杠分割路径并过滤掉空字符串片段
  const segments = normalized.split("/").filter(Boolean)
  // 获取最后一个路径段作为文件名，如果不存在则返回原始路径
  return segments.at(-1) ?? filePath
}

/**
 * 根据文件路径推断工件类型
 *
 * @param filePath - 文件路径字符串
 * @returns 推断出的工件类型，包括 code、sheet、image、text 四种类型之一
 */
function inferArtifactType(filePath: string): ArtifactType {
  const extension = getFileExtension(filePath)

  if (!extension) {
    return "text"
  }

  // 判断是否为代码文件类型
  if (
    ["ts", "tsx", "js", "jsx", "json", "py", "sql", "css", "html"].includes(
      extension
    )
  ) {
    return "code"
  }

  // 判断是否为表格文件类型
  if (["csv"].includes(extension)) {
    return "sheet"
  }

  // 判断是否为图片文件类型
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "image"
  }

  return "text"
}

/**
 * 根据文件路径推断编程语言类型
 * @param filePath - 文件路径字符串
 * @returns 推断出的语言类型字符串，如果无法推断则返回undefined
 */
function inferLanguage(filePath: string) {
  // 提取文件扩展名
  const extension = getFileExtension(filePath)

  if (!extension) {
    return undefined
  }

  // 定义文件扩展名到编程语言的映射关系
  const languageMap: Record<string, string> = {
    css: "css",
    html: "html",
    js: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    jsx: "jsx",
  }

  return languageMap[extension]
}

/**
 * 判断UI消息部件是否为工具输出部分
 *
 * @param part - UI消息部件，类型为UIMessage中parts数组的元素
 * @returns 当部件类型以"tool-"开头且状态为"output-available"时返回true，否则返回false
 */
function isToolOutputPart(part: UIMessage["parts"][number]): part is ToolPart {
  return (
    part.type.startsWith("tool-") &&
    "state" in part &&
    part.state === "output-available"
  )
}

/**
 * 从工具部件中获取工具输出载荷
 *
 * @param part - 工具部件对象，可能包含输出属性
 * @returns 如果存在有效的输出对象则返回 ToolOutputPayload 类型的数据，否则返回 null
 */
function getToolOutput(part: ToolPart): ToolOutputPayload | null {
  // 验证输入参数是否包含 output 属性且该属性为有效对象
  if (!("output" in part) || !part.output || typeof part.output !== "object") {
    return null
  }

  return part.output as ToolOutputPayload
}

function getToolInput(part: ToolPart, output: ToolOutputPayload | null) {
  if ("input" in part && part.input && typeof part.input === "object") {
    return part.input as ToolInputPayload
  }

  if (output?.input && typeof output.input === "object") {
    return output.input as ToolInputPayload
  }

  return null
}

/**
 * 从工具部件构建工件对象
 *
 * @param part - 工具部件对象，包含工具调用信息
 * @returns 返回构建的工件对象，如果无法构建则返回null
 */
function buildArtifactFromToolPart(part: ToolPart): Artifact | null {
  const output = getToolOutput(part)
  const input = getToolInput(part, output)

  if (!input) {
    return null
  }

  const filePath = typeof input.file_path === "string" ? input.file_path : null
  const content =
    typeof input.content === "string"
      ? input.content
      : typeof input.new_string === "string"
        ? input.new_string
        : null

  // 检查必需字段是否存在
  if (!filePath || content === null) {
    return null
  }

  const type = inferArtifactType(filePath)

  return {
    id: `artifact:${part.toolCallId}`,
    type,
    title: getFileName(filePath),
    content,
    language: type === "code" ? inferLanguage(filePath) : undefined,
    metadata: {
      filePath,
      sourceToolCallId: part.toolCallId,
      sourceToolName: output?.toolName ?? part.type.replace(/^tool-/, ""),
      status: output?.status ?? null,
      outputText: output?.text ?? "",
    },
  }
}

/**
 * 从工具部件中获取构件
 *
 * @param part - UI消息部件数组中的一个元素，类型为UIMessage的parts索引类型
 * @returns 返回构建的构件对象，如果输入不是工具输出部件则返回null
 */
export function getArtifactFromToolPart(part: UIMessage["parts"][number]) {
  // 检查部件是否为工具输出部件类型
  if (!isToolOutputPart(part)) {
    return null
  }

  // 根据工具部件构建并返回构件
  return buildArtifactFromToolPart(part)
}

/**
 * 从UI消息中提取工件数组
 *
 * 该函数通过以下步骤处理消息：
 * 1. 过滤出工具输出部分
 * 2. 将工具部分构建为工件对象
 * 3. 过滤掉空值，确保返回的都是有效的工件对象
 *
 * @param message - UI消息对象，包含多个部分
 * @returns Artifact[] - 从消息中提取的工件数组，可能为空数组但不会包含null值
 */
export function getArtifactsFromUIMessage(message: UIMessage): Artifact[] {
  return (
    message.parts
      .filter(isToolOutputPart)
      .map(buildArtifactFromToolPart)
      // 过滤掉构建过程中产生的null值，确保返回的都是有效的工件对象
      .filter((artifact): artifact is Artifact => artifact !== null)
  )
}

/**
 * 从UI消息中获取最新的artifact
 *
 * @param message - UI消息对象，用于提取artifacts信息
 * @returns 返回最新的artifact对象，如果不存在则返回null
 */
export function getLatestArtifactFromUIMessage(message: UIMessage) {
  return getArtifactsFromUIMessage(message).at(-1) ?? null
}
