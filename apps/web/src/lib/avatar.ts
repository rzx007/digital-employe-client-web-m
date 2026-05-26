import { createAvatar } from "@dicebear/core"
import { avataaars } from "@dicebear/collection"

import curatorAssistantAvatar from "@/assets/avaters/assistant.png"

/** 总管助手固定头像（联系人、会话、工作台侧栏等） */
export const CURATOR_AVATAR_URL: string = curatorAssistantAvatar

export function createDiceBearAvatar(seed: string): string {
  return createAvatar(avataaars, { seed }).toDataUri()
}
