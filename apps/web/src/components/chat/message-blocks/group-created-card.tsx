"use client"

import * as React from "react"
import { memo, useState } from "react"
import { IconLoader, IconUsersGroup } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { isToolOutputPending } from "@/lib/chat/tool-output-pending"
import {
  parseGroupCreatedToolPayload,
  type GroupCreatedToolPayload,
} from "@/lib/chat/group-created-tool-payload"
import { navigateToGroupChat } from "@/lib/chat/group-navigation"

const STATE_CONFIG: Record<string, { title: string; titleClass: string }> = {
  call: {
    title: "正在创建群聊...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-streaming": {
    title: "正在创建群聊...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "input-available": {
    title: "正在创建群聊...",
    titleClass: "text-muted-foreground animate-pulse",
  },
  "output-available": {
    title: "群聊已创建",
    titleClass: "text-foreground",
  },
  "output-error": {
    title: "创建群聊失败",
    titleClass: "text-destructive",
  },
}

function GroupCreatedSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-full max-w-xs" />
      <Skeleton className="h-8 w-24 rounded-md" />
    </div>
  )
}

function GroupCreatedCardInner({
  state,
  resultText,
  preliminary,
  className,
}: {
  state?: string
  resultText?: string | null
  preliminary?: boolean
  className?: string
}) {
  const queryClient = useQueryClient()
  const [entering, setEntering] = useState(false)

  const payload = React.useMemo(
    (): GroupCreatedToolPayload | null =>
      parseGroupCreatedToolPayload(resultText),
    [resultText]
  )

  const pending = isToolOutputPending(state ?? "", preliminary)
  const isError = state === "output-error"
  const config = STATE_CONFIG[state ?? ""] ?? STATE_CONFIG["output-available"]

  const handleEnterGroup = async () => {
    if (!payload || entering) return
    setEntering(true)
    try {
      await navigateToGroupChat(queryClient, {
        groupId: payload.groupId,
        groupConversationId: payload.groupConversationId,
        groupName: payload.groupName,
      })
    } finally {
      setEntering(false)
    }
  }

  return (
    <div
      className={cn(
        "relative w-full max-w-sm min-w-0 overflow-hidden rounded-lg border bg-card p-3 text-sm",
        className
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <IconUsersGroup className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("font-medium", config.titleClass)}>
          {config.title}
        </span>
      </div>

      {pending ? (
        <GroupCreatedSkeleton />
      ) : isError || (!payload && resultText?.trim()) ? (
        <p className="text-xs text-destructive">{resultText?.trim()}</p>
      ) : payload ? (
        <div className="space-y-2">
          <div>
            <p className="font-medium text-foreground">
              {payload.groupName ?? `群 #${payload.groupId}`}
            </p>
            {payload.members ? (
              <p className="mt-1 text-xs text-muted-foreground">
                成员：{payload.members}
              </p>
            ) : null}
            {payload.message ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {payload.message}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={entering}
            onClick={() => void handleEnterGroup()}
          >
            {entering ? (
              <>
                <IconLoader className="size-3.5 animate-spin" />
                进入中…
              </>
            ) : (
              "进入群聊"
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export const GroupCreatedCard = memo(GroupCreatedCardInner)
