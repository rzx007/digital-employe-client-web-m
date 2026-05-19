import { backendBridge } from "../features/backend/preload-bridge"
import { windowBridge } from "../features/window/preload-bridge"
import { authBridge } from "../features/auth/preload-bridge"
import { recruitmentBridge } from "../features/recruitment/preload-bridge"
import { notificationTrayBridge } from "../features/notification-tray/preload-bridge"
import { settingsBridge } from "../features/settings/preload-bridge"
import { petBridge } from "../features/pet/preload-bridge"
import { updateBridge } from "../features/update/preload-bridge"
import { extensionBridge } from "../features/extension/preload-bridge"

export const electronApi = {
  isElectron: true as const,
  ...backendBridge,
  ...windowBridge,
  ...notificationTrayBridge,
  ...authBridge,
  ...recruitmentBridge,
  ...settingsBridge,
  ...petBridge,
  ...updateBridge,
  ...extensionBridge,
}

export type ElectronApi = typeof electronApi
