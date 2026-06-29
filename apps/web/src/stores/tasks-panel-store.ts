import { create } from "zustand"

import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useMonitorStore } from "@/stores/monitor-store"

/** 单个并行子任务（deepagents task 工具）在合并任务面板中的视图模型 */
export interface SubtaskCardItem {
  /** 对应 task 工具调用的 toolCallId（稳定主键） */
  toolCallId: string
  /** 子任务标题（来自 input.description，已截断由 UI 决定） */
  description: string
  /** 子代理类型（input.subagent_type），缺省为 "" */
  subagentType: string
  /** 工具 part 当前状态：output-available / output-error / 其它（进行中） */
  state: string
  /** 是否为初步/流式输出（preliminary=true 时仍在跑） */
  preliminary: boolean
  /** 累积输出文本（与内联工具行展示的 resultText 同源，可逐字流式） */
  output: string | null
  /** 首次出现的本地时间戳（ms）；子任务自身无时间字段，由 store 写入时打戳，
   * 用于与后台命令 / 员工任务在合并面板里按时间混排。 */
  firstSeenAt?: number
}

/**
 * 合并任务面板与产物 / 监控 / 浏览器互斥：打开本面板时收起其它右侧栏。
 * 三类任务（子任务 / 后台命令 / 员工任务）已合并到本 store，不再彼此关闭。
 */
function closeOtherSidePanels() {
  useArtifactStore.getState().closeArtifact()
  useMonitorStore.getState().closeMonitor()
  // 浏览器改为最小化（保活）而非销毁——切到本 panel 不中断浏览器操作。
  useBrowserStore.getState().minimizeBrowser()
}

interface TasksPanelStore {
  isOpen: boolean
  /** 当前会话聚合出的子任务列表（由 useSyncConversationSubtasks 写入） */
  subtasks: SubtaskCardItem[]

  open: () => void
  close: () => void
  toggle: () => void
  setSubtasks: (subtasks: SubtaskCardItem[]) => void
}

export const useTasksPanelStore = create<TasksPanelStore>((set, get) => ({
  isOpen: false,
  subtasks: [],

  open: () => {
    closeOtherSidePanels()
    set({ isOpen: true })
  },
  close: () => set({ isOpen: false }),
  toggle: () => {
    const next = !get().isOpen
    if (next) closeOtherSidePanels()
    set({ isOpen: next })
  },
  setSubtasks: (incoming) => {
    // 保留已存在 toolCallId 的首次出现时间戳；新子任务打当前时间戳。
    const prevSeen = new Map(
      get().subtasks.map((s) => [s.toolCallId, s.firstSeenAt])
    )
    const now = Date.now()
    const next = incoming.map((s) => ({
      ...s,
      firstSeenAt: prevSeen.get(s.toolCallId) ?? now,
    }))
    set({ subtasks: next })
  },
}))
