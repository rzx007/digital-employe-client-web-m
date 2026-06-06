/**
 * 净化 assistant 正文：剥掉混入的「工具结果文本」噪音。
 *
 * 背景：后端早期版本累积 assistant content 时未区分 AIMessage / ToolMessage，
 * 把工具返回（read 读到的文件原文、write/edit 的失败回执、shell 的环境提示等）
 * 也拼进了 msg.content 落库。这些是给模型看的内部文本，绝不该当正文展示给用户。
 * 后端已修复（stream_registry 累积时跳过 ToolMessage），但**存量脏数据**仍在 DB，
 * 这里在展示层兜底剥离，对新老数据都生效、不改 DB、不丢真实模型文本。
 *
 * 仅匹配「确定来自工具、不可能是模型自然语言」的模式，宁可漏删不可错删。
 */

/** 整行即为工具噪音的正则（按行匹配后整行删除） */
const NOISE_LINE_PATTERNS: RegExp[] = [
  // shell 工具注入的环境提示
  /^\s*\[shell 工作目录[:：].*\]\s*$/,
  /^\s*\[会话产物目录（write_file.*\]\s*$/,
  /^\s*\[说明:\s*shell 默认 cwd.*\]\s*$/,
  // read_file 注入的进度/未读完提示
  /^\s*\[read_file 进度\s*·.*\]\s*$/,
  // write_file 成功回执（整行）；失败回执与 edit 回执常紧贴正文，交给行内规则处理
  /^\s*Updated file \/.+$/,
]

/**
 * 行内（非独占整行）出现的工具回执：从该处截断到下一处「正常文本」。
 * 这些回执常被模型紧贴自己的话拼在一起（如「...让我重新编写：Cannot write to ...」），
 * 无法整行删，这里把回执片段就地抹掉。
 */
const NOISE_INLINE_PATTERNS: RegExp[] = [
  /Cannot write to \/[^\s]+ because it already exists\. Read and then make an edit, or write to a new path\./g,
  /Error: String not found in file: '[^']*'/g,
  /Successfully replaced \d+ instance\(s\) of the string in '[^']*'\.?/g,
  /\[shell 工作目录[:：][^\]]*\]/g,
  /\[会话产物目录（write_file[^\]]*\]/g,
  /\[说明:\s*shell 默认 cwd[^\]]*\]/g,
  /\[read_file 进度\s*·[^\]]*\]/g,
]

/** 一行是否是 read_file 回显的「行号\t内容」格式（如「   123\t# 标题」） */
function isLineNumberedFileLine(line: string): boolean {
  return /^\s{0,6}\d+\t/.test(line)
}

/**
 * 净化 assistant 正文。仅对 assistant 角色调用。
 * - 删除整行工具噪音
 * - 抹掉行内工具回执片段
 * - 删除连续 ≥3 行的「行号\t」块（read_file 回显的文件原文，不是 markdown）
 */
export function sanitizeAssistantContent(content: string): string {
  if (!content || typeof content !== "string") return content
  // 快速短路：没有任何已知噪音特征就原样返回，零成本
  if (
    !content.includes("[shell 工作目录") &&
    !content.includes("[read_file 进度") &&
    !content.includes("Cannot write to /") &&
    !content.includes("Successfully replaced ") &&
    !content.includes("Error: String not found in file") &&
    !content.includes("Updated file /") &&
    !content.includes("[会话产物目录") &&
    !/\n\s{0,6}\d+\t/.test(content)
  ) {
    return content
  }

  const lines = content.split("\n")
  const out: string[] = []
  let numberedRun: string[] = []

  const flushNumbered = () => {
    // 连续 <3 行的「行号\t」可能是正常代码/正文，保留；≥3 行判定为文件回显，丢弃
    if (numberedRun.length > 0 && numberedRun.length < 3) {
      out.push(...numberedRun)
    }
    numberedRun = []
  }

  for (const rawLine of lines) {
    if (isLineNumberedFileLine(rawLine)) {
      numberedRun.push(rawLine)
      continue
    }
    flushNumbered()

    // 整行噪音 → 跳过
    if (NOISE_LINE_PATTERNS.some((re) => re.test(rawLine))) {
      continue
    }
    // 行内噪音 → 就地抹除
    let line = rawLine
    for (const re of NOISE_INLINE_PATTERNS) {
      line = line.replace(re, "")
    }
    out.push(line)
  }
  flushNumbered()

  // 合并多余空行（清理后可能留下连续空行）
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
