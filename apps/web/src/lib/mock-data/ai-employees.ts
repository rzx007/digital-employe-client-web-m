import type { MetadataSkill } from "@/api/types"
import { createDiceBearAvatar } from "@/lib/avatar"

export interface AIEmployee {
  id: string
  name: string
  role: string
  avatar?: string
  status: "online" | "busy" | "offline"
  specialty: string
  skills?: MetadataSkill[]
}

export type ContactType = "curator" | "employee" | "group"

/** 总管助手：独立身份，不属于员工列表 */
export interface CuratorProfile {
  id: string
  name: string
  role: string
  avatar?: string
  status: "online" | "busy" | "offline"
  specialty: string
}

export interface Contact {
  type: ContactType
  curator?: CuratorProfile
  employee?: AIEmployee
  group?: {
    id: string
    name: string
    participants: AIEmployee[]
  }
}

/** 常驻默认会话入口，通讯录置顶，独立于群聊与其它联系人 */
export const PRIMARY_CURATOR: CuratorProfile = {
  id: "curator-primary",
  name: "总管助手",
  role: "数字员工统筹",
  status: "online",
  avatar: createDiceBearAvatar("Curator"),
  specialty: "任务分派、会话路由与协作编排",
}

export const DEFAULT_SELECTED_CONTACT_ID = PRIMARY_CURATOR.id

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
      AI_EMPLOYEES[1], // 王大明
      AI_EMPLOYEES[3], // 赵伟
    ],
  },
  {
    id: "group-product",
    name: "产品讨论群",
    participants: [
      AI_EMPLOYEES[1], // 王大明
      AI_EMPLOYEES[2], // 李晓琳
      AI_EMPLOYEES[0], // 陈小红
    ],
  },
]

export const CONTACTS: Contact[] = [
  { type: "curator" as const, curator: PRIMARY_CURATOR },
  ...AI_EMPLOYEES.map((emp) => ({
    type: "employee" as const,
    employee: emp,
  })),
  ...AI_GROUPS.map((group) => ({
    type: "group" as const,
    group,
  })),
]

export function findContactInList(
  contacts: readonly Contact[],
  id: string
): Contact | undefined {
  return contacts.find((contact) => {
    if (contact.type === "curator") {
      return contact.curator?.id === id
    }
    if (contact.type === "employee") {
      return contact.employee?.id === id
    }
    return contact.group?.id === id
  })
}

export const getContactById = (id: string): Contact | undefined => {
  return findContactInList(CONTACTS, id)
}

export const getEmployeeById = (id: string): AIEmployee | undefined => {
  return AI_EMPLOYEES.find((emp) => emp.id === id)
}

/** 消息发送方等场景：员工或总管助手 */
export function getPeerProfileById(
  id: string
): AIEmployee | CuratorProfile | undefined {
  if (id === PRIMARY_CURATOR.id) {
    return PRIMARY_CURATOR
  }
  return getEmployeeById(id)
}

export const getGroupById = (id: string) => {
  return AI_GROUPS.find((group) => group.id === id)
}
