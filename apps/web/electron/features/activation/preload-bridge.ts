import { IpcChannels } from "../../shared/ipc-channels"
import { invoke } from "../../preload/invoke"

export const activationBridge = {
  activationSuccess: () => invoke(IpcChannels.activationSuccess),
}
