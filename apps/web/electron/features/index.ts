import type { IpcContribution } from "../core/ipc/types"
import { backendIpcContribution } from "./backend/ipc"
import { windowIpcContribution } from "./window/ipc"
import { authIpcContribution } from "./auth/ipc"
import { recruitmentIpcContribution } from "./recruitment/ipc"
import { notificationTrayIpcContribution } from "./notification-tray/ipc"
import { settingsIpcContribution } from "./settings/ipc"
import { petIpcContribution } from "./pet/ipc"
import { updateIpcContribution } from "./update/ipc"
import { extensionIpcContribution } from "./extension/ipc"
import { activationIpcContribution } from "./activation/ipc"

export const allIpcContributions: IpcContribution[] = [
  backendIpcContribution,
  windowIpcContribution,
  authIpcContribution,
  recruitmentIpcContribution,
  notificationTrayIpcContribution,
  settingsIpcContribution,
  petIpcContribution,
  updateIpcContribution,
  extensionIpcContribution,
  activationIpcContribution,
]
