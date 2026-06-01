import { randomUUID } from "node:crypto"

import { getWindowManager } from "../../core/services/window-registry"
import { rootLogger as logger } from "../../core/logger"

export interface BrowserConfirmationRequest {
  id: string
  message: string
  refOrSelector: string
  screenshotBase64?: string
}

interface PendingConfirmation {
  resolve: (approved: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingConfirmation>()

const CONFIRM_TIMEOUT_MS = 120_000

export function requestBrowserConfirmation(options: {
  message: string
  refOrSelector: string
  screenshotBase64?: string
}): Promise<boolean> {
  const id = randomUUID()
  const payload: BrowserConfirmationRequest = {
    id,
    message: options.message,
    refOrSelector: options.refOrSelector,
    screenshotBase64: options.screenshotBase64,
  }

  const main = getWindowManager().get("main")
  main?.webContents.send("browser:confirmation-request", payload)

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      logger.warn("[browser-confirmation] timed out", { id })
      resolve(false)
    }, CONFIRM_TIMEOUT_MS)

    pending.set(id, { resolve, timer })
  })
}

export function resolveBrowserConfirmation(
  id: string,
  approved: boolean
): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(id)
  entry.resolve(approved)
  return true
}
