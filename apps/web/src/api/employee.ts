import { request } from "@/lib/request"
import type { ApiResponse, Employee } from "./types"

/** 当前固定工作空间 ID */
const WORKSPACE_ID = 1

/**
 * 导入员工列表并解析
 * GET /workspaces/{workspace_id}/employees/sync
 */
export async function syncEmployees() {
  return request<ApiResponse<null>>(
    `/workspaces/${WORKSPACE_ID}/employees/sync`
  )
}

/**
 * 查询员工列表
 * GET /workspaces/{workspace_id}/employees
 */
export async function fetchEmployees() {
  return request<ApiResponse<Employee[]>>(
    `/workspaces/${WORKSPACE_ID}/employees`
  )
}

/**
 * 查询员工详情
 * GET /employees/{employee_id}
 */
export async function fetchEmployeeById(employeeId: number | string) {
  return request<ApiResponse<Employee>>(`/employees/${employeeId}`)
}

/**
 * 删除员工
 * DELETE /employees/{employee_id}
 */
export async function deleteEmployee(employeeId: number | string) {
  return request<ApiResponse<null>>(`/employees/${employeeId}`, {
    method: "DELETE",
  })
}

export interface RecruitRequest {
  requirement: string
}

export interface RecruitCandidate {
  id: string
  name: string
  description: string
  matchScore: number
  skills: {
    id: number
    skillName: string
    description: string
  }[]
}

export async function fetchRecruitCandidates(
  _params: RecruitRequest
): Promise<RecruitCandidate[]> {
  await new Promise((resolve) => setTimeout(resolve, 1500))
  return [
    {
      id: "mock-1",
      name: "Web全栈工程师",
      description:
        "精通前后端开发，熟悉主流框架，能够独立完成Web应用的全流程开发",
      matchScore: 92,
      skills: [
        {
          id: 1,
          skillName: "代码开发",
          description:
            "具备全栈代码编写能力，熟悉React、Vue等前端框架以及Node.js、Python等后端技术栈",
        },
        {
          id: 2,
          skillName: "文档撰写",
          description: "能够编写清晰的技术文档、API文档和用户手册",
        },
        {
          id: 3,
          skillName: "数据分析",
          description: "能够对业务数据进行分析和可视化展示",
        },
      ],
    },
    {
      id: "mock-2",
      name: "数据分析专家",
      description: "专注于数据统计分析与报表生成，擅长从数据中发现业务洞察",
      matchScore: 78,
      skills: [
        {
          id: 4,
          skillName: "数据统计",
          description: "具备数据收集、清洗、统计分析的全流程能力",
        },
        {
          id: 5,
          skillName: "报表生成",
          description: "能够根据数据自动生成多维度分析报表",
        },
        {
          id: 6,
          skillName: "SQL查询",
          description: "精通SQL，能够高效查询和处理数据库中的数据",
        },
      ],
    },
    {
      id: "mock-3",
      name: "运维专员",
      description: "负责系统监控与运维自动化，保障服务稳定运行",
      matchScore: 65,
      skills: [
        {
          id: 7,
          skillName: "系统监控",
          description: "实时监控系统运行状态，及时发现和响应异常",
        },
        {
          id: 8,
          skillName: "日志分析",
          description: "分析系统日志，定位问题根因",
        },
        {
          id: 9,
          skillName: "自动化脚本",
          description: "编写自动化运维脚本，提升运维效率",
        },
      ],
    },
  ]
}

export async function createEmployee(
  _params: Omit<RecruitCandidate, "id" | "matchScore">
) {
  await new Promise((resolve) => setTimeout(resolve, 800))
  return { success: true }
}
