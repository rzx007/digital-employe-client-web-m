import { createDiceBearAvatar } from "@/lib/avatar"
import type { AIEmployee, Contact } from "@/types/chat"

export const AI_EMPLOYEES: AIEmployee[] = [
  {
    id: "hr-manager",
    name: "陈小红",
    role: "HR经理",
    status: "online",
    avatar: createDiceBearAvatar("Alice"),
    specialty: "员工关系、福利政策、招聘流程",
  },
  {
    id: "chief-engineer",
    name: "王大明",
    role: "首席工程师",
    status: "busy",
    avatar: createDiceBearAvatar("Bob"),
    specialty: "技术架构、代码审查、基础设施",
  },
  {
    id: "product-designer",
    name: "李晓琳",
    role: "产品设计师",
    status: "online",
    avatar: createDiceBearAvatar("Charlie"),
    specialty: "UX设计、用户研究、原型制作",
  },
  {
    id: "marketing-director",
    name: "赵伟",
    role: "营销总监",
    status: "offline",
    avatar: createDiceBearAvatar("David"),
    specialty: "品牌策略、营销活动、数据分析",
  },
]

export const AI_GROUPS = [
  {
    id: "group-tech",
    name: "技术讨论群",
    participants: [
      AI_EMPLOYEES[1],
      AI_EMPLOYEES[3],
    ],
  },
  {
    id: "group-product",
    name: "产品讨论群",
    participants: [
      AI_EMPLOYEES[1],
      AI_EMPLOYEES[2],
      AI_EMPLOYEES[0],
    ],
  },
]

export const CONTACTS: Contact[] = [
  ...AI_EMPLOYEES.map((emp) => ({
    type: "employee" as const,
    employee: emp,
  })),
  ...AI_GROUPS.map((group) => ({
    type: "group" as const,
    group,
  })),
]
