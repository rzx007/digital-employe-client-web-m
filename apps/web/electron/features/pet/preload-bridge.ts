import { IpcChannels } from "../../shared/ipc-channels"
import { invoke, onChannel } from "../../preload/invoke"

export const petBridge = {
  /** 从宠物窗唤起主窗口（IPC channel 仍为 pet:show） */
  showMainWindow: () => invoke(IpcChannels.petShow),
  hidePetWindow: () => invoke(IpcChannels.petHide),
  setPetPosition: (x: number, y: number) =>
    invoke(IpcChannels.petSetPosition, x, y),
  getPetPosition: () =>
    invoke<{ x: number; y: number } | null>(IpcChannels.petGetPosition),
  getSelectedPetSlug: () => invoke<string>(IpcChannels.petGetSelected),
  setSelectedPetSlug: (slug: string) => invoke(IpcChannels.petSelect, slug),
  onPetChanged: (callback: (slug: string) => void) =>
    onChannel("pet-changed", (slug) => callback(slug as string)),
  listPetdexSkins: () =>
    invoke<
      Array<{
        slug: string
        displayName: string
        description: string
        source: "petdex"
      }>
    >(IpcChannels.petListPetdex),
  getPetdexMeta: (slug: string) =>
    invoke<{
      id: string
      displayName: string
      description: string
      spritesheetPath: string
    } | null>(IpcChannels.petGetPetdexMeta, slug),
}
