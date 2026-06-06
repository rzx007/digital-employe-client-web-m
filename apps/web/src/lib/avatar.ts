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
