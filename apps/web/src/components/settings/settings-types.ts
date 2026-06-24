import type * as React from "react"
import {
  IconSettings,
  IconKeyboard,
  IconBrain,
  IconInfoCircle,
  IconUser,
  IconPaw,
  IconPlug,
  IconWifi,
} from "@tabler/icons-react"

import type { Capabilities } from "@/lib/runtime/runtime-types"

export type SettingsTab =
  | "account"
  | "general"
  | "shortcuts"
  | "models"
  | "pet"
  | "extensions"
  | "channels"
  | "about"

export type PetVisibilityMode = "always" | "when_main_hidden"

export const SETTINGS_TABS: {
  id: SettingsTab
  label: string
  icon: React.ComponentType<{ className?: string }>
  capability?: keyof Capabilities
}[] = [
    { id: "account", label: "账号与隐私", icon: IconUser, capability: "remote_login" },
    { id: "general", label: "通用", icon: IconSettings },
    { id: "shortcuts", label: "快捷键", icon: IconKeyboard },
    { id: "models", label: "模型", icon: IconBrain },
    { id: "pet", label: "宠物", icon: IconPaw },
    { id: "extensions", label: "插件", icon: IconPlug },
    { id: "channels", label: "渠道", icon: IconWifi, capability: "feishu_platform" },
    { id: "about", label: "关于", icon: IconInfoCircle },
  ]
