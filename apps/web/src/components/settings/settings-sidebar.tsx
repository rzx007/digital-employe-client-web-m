import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { SETTINGS_TABS, type SettingsTab } from "./settings-types"

export function SettingsSidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}) {
  return (
    <div className="w-48 shrink-0 border-r bg-muted/50 p-4">
      <nav className="flex flex-col gap-1">
        {SETTINGS_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "secondary" : "ghost"}
            className={cn(
              "justify-start gap-2 px-3",
              activeTab === tab.id && "bg-secondary",
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
