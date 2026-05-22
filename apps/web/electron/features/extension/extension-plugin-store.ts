import Store from "electron-store"
import { getStoreDir } from "../settings/settings-store"

interface PluginStoreData {
  plugins: Record<string, Record<string, unknown>>
}

let store: Store<PluginStoreData> | null = null

function getStore(): Store<PluginStoreData> {
  if (!store) {
    store = new Store<PluginStoreData>({
      name: "extension-plugin-data",
      cwd: getStoreDir(),
      defaults: { plugins: {} },
    })
  }
  return store
}

function readPluginBucket(pluginId: string): Record<string, unknown> {
  const all = getStore().get("plugins")
  return all[pluginId] ?? {}
}

export function getPluginStorageValue(
  pluginId: string,
  key: string,
): unknown {
  return readPluginBucket(pluginId)[key]
}

export function setPluginStorageValue(
  pluginId: string,
  key: string,
  value: unknown,
): void {
  const all = { ...getStore().get("plugins") }
  const bucket = { ...readPluginBucket(pluginId), [key]: value }
  all[pluginId] = bucket
  getStore().set("plugins", all)
}

export function clearPluginStorage(pluginId: string): void {
  const all = { ...getStore().get("plugins") }
  delete all[pluginId]
  getStore().set("plugins", all)
}
