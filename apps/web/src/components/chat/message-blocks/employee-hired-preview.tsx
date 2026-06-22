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
  subtitle,
  compact = false,
  hideEmployeeId = false,
  className,
}: {
  employeeId?: number
  employeeName: string
  employeeCode?: string
  skills?: string[]
  /** 简介 / 描述（compact 下也会 line-clamp 展示） */
  message?: string
  /** 姓名下的短副标题（如能力标签），优先于员工 ID 行 */
  subtitle?: string
  compact?: boolean
  hideEmployeeId?: boolean
  className?: string
}) {
  const avatarSize = compact ? "size-9" : "size-11"
  const idLine =
    employeeId != null
      ? employeeCode
        ? `员工 ID ${employeeId} · ${employeeCode}`
        : `员工 ID ${employeeId}`
      : ""
  const metaLine = subtitle?.trim() || (!hideEmployeeId && idLine ? idLine : "")

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
        {metaLine ? (
          <p
            className="mt-0.5 truncate text-[11px] text-muted-foreground"
            title={metaLine}
          >
            {metaLine}
          </p>
        ) : null}
        {message?.trim() ? (
          <p
            className={cn(
              "line-clamp-2 leading-relaxed break-words text-muted-foreground",
              compact
                ? "mt-0.5 text-[11px]"
                : "mt-1 text-xs"
            )}
            title={message}
          >
            {message.trim()}
          </p>
        ) : null}
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
