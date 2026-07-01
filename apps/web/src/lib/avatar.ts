import { createAvatar } from "@dicebear/core"
import { avataaars } from "@dicebear/collection"

import curatorAssistantAvatar from "@/assets/avaters/assistant0.png"
import curatorAssistantAvatar1 from "@/assets/avaters/assistant1.png"
import Avatar1 from "@/assets/avaters/1.png"
import Avatar2 from "@/assets/avaters/2.png"
import Avatar3 from "@/assets/avaters/3.png"
import Avatar4 from "@/assets/avaters/4.png"
import Avatar5 from "@/assets/avaters/5.png"
import Avatar6 from "@/assets/avaters/6.png"
import Avatar7 from "@/assets/avaters/7.png"
import Avatar8 from "@/assets/avaters/8.png"
import Avatar9 from "@/assets/avaters/9.png"

/** 用户头像池（按 userId % 10 选取，与侧栏一致） */
export const USER_AVATARS = [
  Avatar1,
  Avatar2,
  Avatar3,
  Avatar4,
  Avatar5,
  Avatar6,
  Avatar7,
  Avatar8,
  Avatar9,
  Avatar1,
] as const

/** 根据用户 ID 返回预设头像 URL */
export function getUserAvatarSrc(userId?: string | number | null): string {
  if (userId == null || userId === "") return Avatar1
  return USER_AVATARS[parseInt(String(userId), 10) % 10]
}

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
