import * as React from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { AccountSettings } from "./account-settings"
import { AboutSettings } from "./about-settings"
import { GeneralSettings } from "./general-settings"
import { ModelsSettings } from "./models-settings"
import { PetSettings } from "./pet-settings"
import { ExtensionsSettings } from "./extensions-settings"
import { SettingsSidebar } from "./settings-sidebar"
import type { SettingsTab } from "./settings-types"
import { ShortcutsSettings } from "./shortcuts-settings"

export function SettingsPage() {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("account")

  return (
    <div className="flex h-svh w-screen bg-background">
      <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <ScrollArea className="flex-1 p-6">
        {activeTab === "account" && <AccountSettings />}
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
