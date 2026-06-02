import * as React from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Route } from "@/routes/settings"
import { AccountSettings } from "./account-settings"
import { AboutSettings } from "./about-settings"
import { GeneralSettings } from "./general-settings"
import { ModelsSettings } from "./models-settings"
import { PetSettings } from "./pet-settings"
import { ExtensionsSettings } from "./extensions-settings"
import { SettingsSidebar } from "./settings-sidebar"
import type { SettingsTab } from "./settings-types"
import { ShortcutsSettings } from "./shortcuts-settings"
import { useCapability } from "@/lib/runtime/runtime-provider"

export function SettingsPage() {
  const { tab: tabFromSearch } = Route.useSearch()
  const canAccount = useCapability("remote_login")
  const defaultTab = canAccount ? "account" : "general"
  const [activeTab, setActiveTab] = React.useState<SettingsTab>(
    tabFromSearch ?? defaultTab
  )

  React.useEffect(() => {
    if (tabFromSearch) {
      if (tabFromSearch === "account" && !canAccount) {
        setActiveTab("general")
      } else {
        setActiveTab(tabFromSearch)
      }
    } else if (!canAccount && activeTab === "account") {
      setActiveTab("general")
    }
  }, [tabFromSearch, canAccount, activeTab])

  return (
    <div className="flex h-full min-h-0 w-full bg-background">
      <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <ScrollArea className="flex-1 p-6">
        {activeTab === "account" && canAccount ? <AccountSettings /> : null}
        {activeTab === "general" && <GeneralSettings />}
        {activeTab === "shortcuts" && <ShortcutsSettings />}
        {activeTab === "models" && <ModelsSettings />}
        {activeTab === "pet" && <PetSettings />}
        {activeTab === "extensions" && <ExtensionsSettings />}
        {activeTab === "about" && <AboutSettings />}
      </ScrollArea>
    </div>
  )
}
