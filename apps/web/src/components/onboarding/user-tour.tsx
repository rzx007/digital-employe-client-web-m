import { useJoyride } from "react-joyride"
import { useOnboardingStore } from "@/stores/onboarding-store"
import { useChatStore } from "@/stores/chat-store"

const TOUR_STEPS = [
  {
    target: "[data-tour-id='add-button']",
    content:
      "点击「+」开始与总管的新对话。把需求直接交给总管，它会理解、规划，并在后台组织数字员工完成任务。",
    placement: "right" as const,
    title: "新建对话",
    disableBeacon: true,
  },
  {
    target: "[data-tour-id='contacts-tab']",
    content:
      "切换到联系人面板，查看和管理所有已招聘的数字员工。双击联系人即可开始对话。",
    placement: "right" as const,
    title: "联系人面板",
    disableBeacon: true,
  },
  {
    target: "[data-tour-id='contact-employee']",
    content:
      "在联系人面板中点击某位员工，右侧详情页的「编辑员工」标签页中可以为其添加或修改定时任务。",
    placement: "right" as const,
    title: "编辑员工与下发任务",
    disableBeacon: true,
    targetWaitTimeout: 3000,
  },
  {
    target: "[data-tour-id='notification-bell']",
    content: "任务执行完成后会收到通知提醒，点击铃铛图标查看执行详情和结果。",
    placement: "right" as const,
    title: "任务通知",
    disableBeacon: true,
  },
  {
    target: "[data-tour-id='settings-btn']",
    content:
      "在设置中可以管理账号信息、快捷键、模型配置等。如果需要重新查看引导，也可以在设置中找到入口。",
    placement: "right" as const,
    title: "设置",
    disableBeacon: true,
  },
]

export function UserTour() {
  const tourRunning = useOnboardingStore((s) => s.tourRunning)
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding)
  const setActiveTab = useChatStore((s) => s.setActiveTab)

  const { Tour } = useJoyride({
    run: tourRunning,
    steps: TOUR_STEPS,
    continuous: true,
    scrollToFirstStep: true,
    locale: {
      back: "上一步",
      close: "关闭",
      last: "完成",
      next: "下一步",
      open: "打开",
      skip: "跳过",
    },
    options: {
      primaryColor: "var(--primary)",
      backgroundColor: "var(--popover)",
      textColor: "var(--popover-foreground)",
      beaconSize: 30,
      overlayColor: "rgba(0, 0, 0, 0.5)",
      spotlightRadius: 8,
      spotlightPadding: 4,
      zIndex: 10000,
      showProgress: true,
      skipBeacon: true,
    },
    onEvent: (data) => {
      if (data.type === "step:after" && data.index === 1) {
        setActiveTab("contacts")
      }

      if (data.type === "tour:end" || data.type === "error") {
        setActiveTab("chat")
        completeOnboarding()
      }

      if (data.action === "skip" || data.action === "close") {
        setActiveTab("chat")
        completeOnboarding()
      }
    },
  })

  return Tour
}
