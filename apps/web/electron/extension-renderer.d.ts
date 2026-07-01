import type { ExtensionApi } from "./preload/extension-preload"
import type { ExtensionContextPayload } from "./shared/extension-ipc-channels"

export type { ExtensionContextPayload }

declare global {
  interface Window {
    extension: ExtensionApi
  }
}
