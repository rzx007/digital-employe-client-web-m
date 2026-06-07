/** 工具行展示配置（唯一数据源）：图标、标题、运行中/完成/失败文案 */

export const INTENT_MAX_LENGTH = 20

export const SHELL_TOOL_NAMES = new Set(["execute", "shell_execute"])

/** 与后端 normalize_shell_intent 一致：去首尾引号并截断。 */
export function normalizeShellIntent(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const text = raw.trim().replace(/^["']+|["']+$/g, "").trim()
  if (!text) return null
  return text.length > INTENT_MAX_LENGTH
    ? text.slice(0, INTENT_MAX_LENGTH)
    : text
}

export type ToolSimpleLabels = {
  running: string
  done: string
  error: string
}

export type ToolDisplayDef = {
  icon: string
  /** 工具行主标题（业务工具为固定文案） */
  label: string
  /** 内置文件类工具：从 input 取路径拼标题 */
  pathKey?: string
  /** 无 path 时与 label 一致，供分组摘要等使用 */
  verb: string
  simple: ToolSimpleLabels
}

/** 自研业务工具：固定 label，不读取 input.intent */
export const BUSINESS_TOOL_NAMES = new Set([
  "create_orchestration_plan",
  "confirm_orchestration_plan",
  "list_workspace_employees",
  "list_workspace_skills",
  "get_workspace_skill_detail",
  "recruit_employee",
  "hire_employee",
  "hire_employees",
  "get_employee",
  "update_employee",
  "delete_employee",
  "delete_employees_batch",
  "update_task",
  "delete_task",
  "delete_tasks_batch",
  "cancel_plan",
  "list_tasks",
  "session_search",
  "search_market_skills",
  "get_market_skill_detail",
  "install_market_skill",
  "list_builtin_skills",
  "install_builtin_skill",
])

export const TOOL_DISPLAY_MAP: Record<string, ToolDisplayDef> = {
  read_file: {
    icon: "📄",
    label: "读取",
    verb: "读取",
    pathKey: "file_path",
    simple: {
      running: "正在读取文件...",
      done: "读取完成",
      error: "读取失败",
    },
  },
  write_file: {
    icon: "✏️",
    label: "创建",
    verb: "创建",
    pathKey: "file_path",
    simple: {
      running: "正在创建文件...",
      done: "创建完成",
      error: "创建失败",
    },
  },
  edit_file: {
    icon: "✏️",
    label: "编辑",
    verb: "编辑",
    pathKey: "file_path",
    simple: {
      running: "正在编辑文件...",
      done: "编辑完成",
      error: "编辑失败",
    },
  },
  execute: {
    icon: "⚡",
    label: "执行",
    verb: "执行",
    simple: {
      running: "正在执行命令...",
      done: "执行完成",
      error: "执行失败",
    },
  },
  shell_execute: {
    icon: "⚡",
    label: "执行",
    verb: "执行",
    simple: {
      running: "正在执行命令...",
      done: "执行完成",
      error: "执行失败",
    },
  },
  ls: {
    icon: "📁",
    label: "列出目录",
    verb: "列出目录",
    pathKey: "path",
    simple: {
      running: "正在查看目录...",
      done: "查看完成",
      error: "查看失败",
    },
  },
  download_files: {
    icon: "📥",
    label: "下载",
    verb: "下载",
    pathKey: "paths",
    simple: {
      running: "正在下载...",
      done: "下载完成",
      error: "下载失败",
    },
  },
  upload_files: {
    icon: "📤",
    label: "上传",
    verb: "上传",
    pathKey: "files",
    simple: {
      running: "正在上传...",
      done: "上传完成",
      error: "上传失败",
    },
  },
  write_todos: {
    icon: "📋",
    label: "任务列表",
    verb: "规划任务",
    simple: {
      running: "正在规划任务...",
      done: "任务已规划",
      error: "规划失败",
    },
  },
  glob: {
    icon: "🔍",
    label: "搜索",
    verb: "搜索",
    pathKey: "path",
    simple: {
      running: "正在搜索文件...",
      done: "搜索完成",
      error: "搜索失败",
    },
  },
  grep: {
    icon: "🔍",
    label: "搜索",
    verb: "搜索",
    pathKey: "path",
    simple: {
      running: "正在搜索内容...",
      done: "搜索完成",
      error: "搜索失败",
    },
  },
  create_orchestration_plan: {
    icon: "📋",
    label: "生成编排计划",
    verb: "生成编排计划",
    simple: {
      running: "正在生成编排计划...",
      done: "编排计划已生成",
      error: "生成计划失败",
    },
  },
  confirm_orchestration_plan: {
    icon: "▶️",
    label: "执行编排计划",
    verb: "执行编排计划",
    simple: {
      running: "正在执行编排计划...",
      done: "编排计划已执行",
      error: "执行计划失败",
    },
  },
  create_group_and_dispatch: {
    icon: "👥",
    label: "拉群派活",
    verb: "拉群派活",
    simple: {
      running: "正在拉群并分派任务...",
      done: "已拉群并交给组长统筹",
      error: "拉群派活失败",
    },
  },
  list_workspace_groups: {
    icon: "👥",
    label: "查看群聊列表",
    verb: "查看群聊列表",
    simple: {
      running: "正在查询群聊...",
      done: "群聊列表已加载",
      error: "查询群聊失败",
    },
  },
  get_group: {
    icon: "👥",
    label: "查看群聊详情",
    verb: "查看群聊详情",
    simple: {
      running: "正在读取群聊详情...",
      done: "群聊详情已加载",
      error: "读取群聊失败",
    },
  },
  update_group: {
    icon: "👥",
    label: "更新群聊",
    verb: "更新群聊",
    simple: {
      running: "正在更新群聊...",
      done: "群聊已更新",
      error: "更新群聊失败",
    },
  },
  delete_group: {
    icon: "👥",
    label: "删除群聊",
    verb: "删除群聊",
    simple: {
      running: "正在删除群聊...",
      done: "群聊已删除",
      error: "删除群聊失败",
    },
  },
  list_workspace_employees: {
    icon: "👥",
    label: "查看团队",
    verb: "查看团队",
    simple: {
      running: "正在查看团队...",
      done: "团队列表已更新",
      error: "查看团队失败",
    },
  },
  list_workspace_skills: {
    icon: "🧩",
    label: "查看技能库",
    verb: "查看技能库",
    simple: {
      running: "正在查询技能库...",
      done: "技能库已加载",
      error: "查询失败",
    },
  },
  get_workspace_skill_detail: {
    icon: "📄",
    label: "预览工作区技能",
    verb: "预览工作区技能",
    simple: {
      running: "正在读取技能详情...",
      done: "技能详情已加载",
      error: "读取失败",
    },
  },
  recruit_employee: {
    icon: "🧑‍💼",
    label: "招聘候选人",
    verb: "招聘候选人",
    simple: {
      running: "正在筛选候选人...",
      done: "候选人已生成",
      error: "招聘失败",
    },
  },
  hire_employee: {
    icon: "✅",
    label: "录用员工",
    verb: "录用员工",
    simple: {
      running: "正在办理入职...",
      done: "员工已入职",
      error: "入职失败",
    },
  },
  hire_employees: {
    icon: "✅",
    label: "批量录用",
    verb: "批量录用员工",
    simple: {
      running: "正在批量办理入职...",
      done: "批量入职完成",
      error: "批量入职失败",
    },
  },
  get_employee: {
    icon: "👤",
    label: "查看员工",
    verb: "查看员工详情",
    simple: {
      running: "正在查询员工...",
      done: "员工详情已加载",
      error: "查询失败",
    },
  },
  update_employee: {
    icon: "✏️",
    label: "更新员工",
    verb: "更新员工",
    simple: {
      running: "正在更新员工...",
      done: "员工已更新",
      error: "更新失败",
    },
  },
  delete_employee: {
    icon: "🗑️",
    label: "解聘员工",
    verb: "解聘员工",
    simple: {
      running: "正在解聘员工...",
      done: "员工已解聘",
      error: "解聘失败",
    },
  },
  delete_employees_batch: {
    icon: "🗑️",
    label: "批量解聘",
    verb: "批量解聘员工",
    simple: {
      running: "正在批量解聘...",
      done: "批量解聘完成",
      error: "批量解聘失败",
    },
  },
  update_task: {
    icon: "✏️",
    label: "更新任务",
    verb: "更新任务",
    simple: {
      running: "正在更新任务...",
      done: "任务已更新",
      error: "更新失败",
    },
  },
  delete_task: {
    icon: "🗑️",
    label: "删除任务",
    verb: "删除任务",
    simple: {
      running: "正在删除任务...",
      done: "任务已删除",
      error: "删除失败",
    },
  },
  delete_tasks_batch: {
    icon: "🗑️",
    label: "批量删除任务",
    verb: "批量删除任务",
    simple: {
      running: "正在批量删除任务...",
      done: "批量删除完成",
      error: "批量删除失败",
    },
  },
  cancel_plan: {
    icon: "⏹️",
    label: "取消计划",
    verb: "取消计划",
    simple: {
      running: "正在取消计划...",
      done: "计划已取消",
      error: "取消失败",
    },
  },
  list_tasks: {
    icon: "📋",
    label: "查看任务",
    verb: "查看任务",
    simple: {
      running: "正在查询任务...",
      done: "查询完成",
      error: "查询失败",
    },
  },
  session_search: {
    icon: "🔍",
    label: "检索历史",
    verb: "检索历史",
    simple: {
      running: "正在检索历史...",
      done: "检索完成",
      error: "检索失败",
    },
  },
  search_market_skills: {
    icon: "🌐",
    label: "搜索远程技能",
    verb: "搜索远程技能",
    simple: {
      running: "正在搜索 SkillsMP...",
      done: "搜索完成",
      error: "搜索失败",
    },
  },
  get_market_skill_detail: {
    icon: "📄",
    label: "预览远程技能",
    verb: "预览远程技能",
    simple: {
      running: "正在拉取技能详情...",
      done: "技能详情已加载",
      error: "拉取失败",
    },
  },
  install_market_skill: {
    icon: "📥",
    label: "安装远程技能",
    verb: "安装远程技能",
    simple: {
      running: "正在安装技能...",
      done: "技能已安装",
      error: "安装失败",
    },
  },
  list_builtin_skills: {
    icon: "🧩",
    label: "查看内置技能",
    verb: "查看内置技能",
    simple: {
      running: "正在查询内置技能...",
      done: "内置技能已加载",
      error: "查询失败",
    },
  },
  install_builtin_skill: {
    icon: "📥",
    label: "安装内置技能",
    verb: "安装内置技能",
    simple: {
      running: "正在安装内置技能...",
      done: "内置技能已安装",
      error: "安装失败",
    },
  },
}

export function getToolDisplay(toolName: string): ToolDisplayDef | undefined {
  return TOOL_DISPLAY_MAP[toolName]
}

export function isBusinessTool(toolName: string): boolean {
  return BUSINESS_TOOL_NAMES.has(toolName)
}

/** 可合并为活动流的常规工具（不含 read/write/edit 与业务工具） */
export const ROUTINE_TOOL_NAMES = new Set([
  ...SHELL_TOOL_NAMES,
  "grep",
  "glob",
  "ls",
])

export function isRoutineTool(toolName: string): boolean {
  return ROUTINE_TOOL_NAMES.has(toolName)
}

export function getSimpleLabels(
  toolName: string
): ToolSimpleLabels | undefined {
  return TOOL_DISPLAY_MAP[toolName]?.simple
}
