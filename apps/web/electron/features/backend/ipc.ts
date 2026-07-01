import { getBackendStatus, getBackendPort } from "./backend-process"
import { IpcChannels } from "../../shared/ipc-channels"
import type { IpcContribution } from "../../core/ipc/types"

export const backendIpcContribution: IpcContribution = {
  id: "backend",
  register() {
    return [
      {
        channel: IpcChannels.getBackendStatus,
        handler: () => getBackendStatus(),
      },
      {
        channel: IpcChannels.getBackendPort,
        handler: () => getBackendPort(),
      },
    ]
  },
}
