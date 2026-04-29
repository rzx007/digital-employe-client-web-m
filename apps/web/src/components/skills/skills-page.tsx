import * as React from "react"
import {
  IconArrowLeft,
  IconCloudDownload,
  IconPackage,
  IconServer,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { useNavigate } from "@tanstack/react-router"
import { LocalSkillList } from "./local-skill-list"
import { RemoteSkillList } from "./remote-skill-list"

export function SkillsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState<"remote" | "local">("remote")

  return (
    <div className="flex h-svh w-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => navigate({ to: "/" })}
        >
          <IconArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <IconPackage className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">技能管理</h1>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "remote" | "local")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b px-6">
          <TabsList className="h-10 w-auto bg-transparent p-0">
            <TabsTrigger
              value="remote"
              className="relative gap-1.5 rounded-none border-b-2 border-transparent px-1 pb-2.5 pt-2 data-[state=active]:border-primary data-[state=active]:shadow-none"
            >
              <IconServer className="size-3.5" />
              远程技能
            </TabsTrigger>
            <TabsTrigger
              value="local"
              className="relative gap-1.5 rounded-none border-b-2 border-transparent px-1 pb-2.5 pt-2 data-[state=active]:border-primary data-[state=active]:shadow-none"
            >
              <IconCloudDownload className="size-3.5" />
              本地技能
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <TabsContent value="remote" className="m-0 p-6">
            <RemoteSkillList />
          </TabsContent>
          <TabsContent value="local" className="m-0 p-6">
            <LocalSkillList />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  )
}
