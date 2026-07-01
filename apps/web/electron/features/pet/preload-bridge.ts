import { IpcChannels } from "../../shared/ipc-channels"
import { invoke, onChannel } from "../../preload/invoke"

export const petBridge = {
  showMainWindow: () => invoke(IpcChannels.petShow),
  hidePetWindow: () => invoke(IpcChannels.petHide),
  setPetPosition: (x: number, y: number) =>
    invoke(IpcChannels.petSetPosition, x, y),
  getPetPosition: () => invoke(IpcChannels.petGetPosition),
  getSelectedPetSlug: () => invoke(IpcChannels.petGetSelected),
  setSelectedPetSlug: (slug: string) => invoke(IpcChannels.petSelect, slug),
  onPetChanged: (callback: (slug: string) => void) =>
    onChannel("pet-changed", (slug) => callback(slug as string)),
  listPetdexSkins: () => invoke(IpcChannels.petListPetdex),
  getPetdexMeta: (slug: string) =>
    invoke(IpcChannels.petGetPetdexMeta, slug),
  installPetFromZip: () => invoke(IpcChannels.petInstallFromZip),
  uninstallPet: (slug: string) => invoke(IpcChannels.petUninstall, slug),
}
