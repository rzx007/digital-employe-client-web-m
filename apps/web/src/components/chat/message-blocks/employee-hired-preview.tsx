"use client"

import * as React from "react"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import { EmployeeContactAvatar } from "@/components/chat/contacts/contact-avatars"

export const HIRED_MINI_CARD =
  "min-w-0 overflow-hidden rounded-lg border bg-card p-2.5 @[22rem]/recruitment:p-3"

export function EmployeeHiredPreview({
  employeeId,
  employeeName,
  employeeCode,
  skills = [],
  message,
  compact = false,
  className,
}: {
  employeeId: number
  employeeName: string
  employeeCode?: string
  skills?: string[]
  message?: string
  compact?: boolean
  className?: string
}) {
  const avatarSize = compact ? "size-9" : "size-11"
  const idLine = employeeCode
    ? `员工 ID ${employeeId} · ${employeeCode}`
    : `员工 ID ${employeeId}`

  return (
    <div
      className={cn(
        HIRED_MINI_CARD,
        "flex items-start gap-2.5 @[22rem]/recruitment:gap-3",
        className
      )}
    >
      <EmployeeContactAvatar
        name={employeeName}
        avatarClassName={cn(avatarSize, "rounded-lg")}
        fallbackClassName={cn(
          "rounded-lg bg-primary/10 font-medium text-primary",
          compact ? "text-[11px]" : "text-sm"
        )}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <p
          className="truncate text-sm font-medium"
          title={employeeName}
        >
          {employeeName}
        </p>
        <p
          className="mt-0.5 truncate text-[11px] text-muted-foreground"
          title={idLine}
        >
          {idLine}
        </p>
        {message && !compact && (
          <p
            className="mt-1 line-clamp-2 text-xs leading-relaxed break-words text-muted-foreground"
            title={message}
          >
            {message}
          </p>
        )}
        {skills.length > 0 && (
          <div className="mt-1.5 flex max-w-full flex-wrap gap-1 @[22rem]/recruitment:mt-2">
            {skills.map((skill) => (
              <Badge
                key={skill}
                variant="outline"
                className="max-w-full truncate text-[10px] font-normal"
                title={skill}
              >
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
