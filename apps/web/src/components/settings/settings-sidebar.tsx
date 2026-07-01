import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { SETTINGS_TABS, type SettingsTab } from "./settings-types"
import { useCapability } from "@/lib/runtime/runtime-provider"

export function SettingsSidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}) {
  const canAccount = useCapability("remote_login")
  const canFeishu = useCapability("feishu_platform")
  const capMap: Record<string, boolean> = {
    remote_login: canAccount,
    feishu_platform: canFeishu,
  }
  const tabs = SETTINGS_TABS.filter(
    (tab) => !tab.capability || capMap[tab.capability]
  )
  return (
    <div className="w-48 shrink-0 border-r bg-muted/50 p-4">
      <nav className="flex flex-col gap-1">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "secondary" : "ghost"}
            className={cn(
              "justify-start gap-2 px-3",
              activeTab === tab.id && "bg-secondary"
            )}
            onClick={() => onTabChange(tab.id)}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </Button>
        ))}
      </nav>
    </div>
  )
}
