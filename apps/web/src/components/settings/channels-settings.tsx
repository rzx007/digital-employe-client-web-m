import * as React from "react"
import feishuLogo from "@/assets/channels/飞书.png"
import { cn } from "@workspace/ui/lib/utils"
import { FeishuSection } from "./feishu-section"

interface ChannelItem {
  key: string
  label: string
  icon: string
}

const CHANNELS: ChannelItem[] = [
  { key: "feishu", label: "飞书", icon: feishuLogo },
]

export function ChannelsSettings() {
  const [selected, setSelected] = React.useState<string>("feishu")

  return (
    <div className="flex gap-6">
      <nav className="flex w-30 shrink-0 flex-col gap-1 border-r pr-3">
        {CHANNELS.map((channel) => (
          <button
            key={channel.key}
            type="button"
            onClick={() => setSelected(channel.key)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
              selected === channel.key
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            <img
              src={channel.icon}
              alt={channel.label}
              className="size-7 rounded"
            />
            <span className="flex-1 text-left">{channel.label}</span>
            <span className="size-1.5 rounded-full bg-emerald-500" />
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {selected === "feishu" && <FeishuSection />}
      </div>
    </div>
  )
}
