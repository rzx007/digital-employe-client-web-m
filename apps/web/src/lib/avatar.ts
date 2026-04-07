import { createAvatar } from "@dicebear/core"
import { avataaars } from "@dicebear/collection"

export function createDiceBearAvatar(seed: string): string {
  return createAvatar(avataaars, { seed }).toDataUri()
}
