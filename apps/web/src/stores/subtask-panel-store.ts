import { create } from "zustand"

import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import { useShellTasksPanelStore } from "@/stores/shell-tasks-panel-store"

/** 单个并行子任务（deepagents task 工具）在侧栏中的视图模型 */
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
}

function closeOtherSidePanels() {
  useArtifactStore.getState().closeArtifact()
  useMonitorStore.getState().closeMonitor()
  useEmployeeTasksPanelStore.getState().close()
  useShellTasksPanelStore.getState().close()
  // 浏览器改为最小化（保活）而非销毁——切到本 panel 不中断浏览器操作。
  useBrowserStore.getState().minimizeBrowser()
}

interface SubtaskPanelStore {
  isOpen: boolean
  /** 当前会话聚合出的子任务列表（由 ChatPanel 侧的 hook 写入） */
  subtasks: SubtaskCardItem[]

  open: () => void
  close: () => void
  toggle: () => void
  setSubtasks: (subtasks: SubtaskCardItem[]) => void
}

export const useSubtaskPanelStore = create<SubtaskPanelStore>((set, get) => ({
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
  setSubtasks: (subtasks) => {
    // 子任务全部消失（如切换到无并行子任务的会话）时顺手收起面板，避免空面板占位。
    if (subtasks.length === 0 && get().isOpen) {
      set({ subtasks, isOpen: false })
      return
    }
    set({ subtasks })
  },
}))
