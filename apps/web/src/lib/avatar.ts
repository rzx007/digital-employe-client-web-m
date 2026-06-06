import { createAvatar } from "@dicebear/core"
import { avataaars } from "@dicebear/collection"

import curatorAssistantAvatar from "@/assets/avaters/assistant0.png"
import curatorAssistantAvatar1 from "@/assets/avaters/assistant1.png"

/** 总管助手固定头像（联系人、会话、工作台侧栏等） */
export const CURATOR_AVATAR_URL: string = curatorAssistantAvatar
export const CURATOR_ASSISTANT_AVATAR_URL_1: string = curatorAssistantAvatar1

export function createDiceBearAvatar(seed: string): string {
  return createAvatar(avataaars, { seed }).toDataUri()
}

/** 文字头像取名字前两个字（无名兜底「员」） */
export function avatarInitials(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim()
  return trimmed ? trimmed.slice(0, 2) : "员"
}

/** 浅色头像配色板（背景浅、文字深，柔和好看） */
const AVATAR_PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-indigo-100 text-indigo-700",
  "bg-pink-100 text-pink-700",
]

/** 按名字 hash 稳定取一种浅色（同一人恒定一种配色） */
export function avatarColorClass(seed: string | null | undefined): string {
  const s = (seed ?? "").trim() || "员"
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}
