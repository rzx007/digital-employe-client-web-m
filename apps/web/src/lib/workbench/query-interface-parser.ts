import type { MetadataSkill } from "@/api/types"
import type { QueryInterface } from "@/types/workbench"
import { request } from "@/lib/request"

const WORKSPACE_ID = 1

/**
 * Parse skill prompts via AI to extract query interfaces
 */
export async function parseInterfacesFromSkills(
  employeeId: string,
  skills: MetadataSkill[]
): Promise<QueryInterface[]> {
  if (skills.length === 0) {
    return []
  }

  // Build the prompt for AI to parse
  const skillDescriptions = skills
    .filter((s) => s.status === 1)
    .map((s) => {
      return `【技能: ${s.skillName}】\n描述: ${s.description}\nPrompt: ${s.prompt}`
    })
    .join("\n\n")

  const aiPrompt = `你是一个接口分析助手。请从以下技能的描述中提取所有HTTP查询接口。

请以JSON数组格式返回，数组中每个元素包含：
- name: 接口名称（中文）
- description: 接口描述
- method: HTTP方法（GET/POST/PUT/DELETE）
- path: 接口路径

只返回查询类的接口（GET请求为主），忽略写操作接口。

技能信息：
${skillDescriptions}

请只返回JSON数组格式，不要包含其他文字。`

  try {
    const res = await request<{
      code: number
      data: {
        response: string
      }
    }>(`/workspaces/${WORKSPACE_ID}/chat/send`, {
      method: "POST",
      body: JSON.stringify({
        question: aiPrompt,
        employee_id: employeeId,
      }),
    })

    // Parse AI response to extract JSON
    const aiText = res.data.response
    const jsonMatch = aiText.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const interfaces = JSON.parse(jsonMatch[0]) as Omit<QueryInterface, "id">[]
      return interfaces.map((iface) => ({
        ...iface,
        id: `interface-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      }))
    }

    return []
  } catch (e) {
    console.error("Failed to parse interfaces from skills:", e)
    return []
  }
}
