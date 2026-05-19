import type * as React from "react"
import {
  IconSettings,
  IconKeyboard,
  IconBrain,
  IconInfoCircle,
  IconUser,
  IconPaw,
  IconPlug,
} from "@tabler/icons-react"

export type SettingsTab =
  | "account"
  | "general"
  | "shortcuts"
  | "models"
  | "pet"
  | "extensions"
  | "about"

export type PetVisibilityMode = "always" | "when_main_hidden"

export const SETTINGS_TABS: {
  id: SettingsTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: "account", label: "账号与隐私", icon: IconUser },
  { id: "general", label: "通用", icon: IconSettings },
  { id: "shortcuts", label: "快捷键", icon: IconKeyboard },
  { id: "models", label: "模型", icon: IconBrain },
  { id: "pet", label: "宠物", icon: IconPaw },
  { id: "extensions", label: "插件", icon: IconPlug },
  { id: "about", label: "关于", icon: IconInfoCircle },
]
