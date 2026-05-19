import Store from "electron-store"
import { getStoreDir } from "../settings/settings-store"

interface ExtensionStoreData {
  enabled: string[]
  devOverrides: Record<string, string>
}

let store: Store<ExtensionStoreData> | null = null

export function initExtensionStore(): void {
  store = new Store<ExtensionStoreData>({
    name: "extensions",
    cwd: getStoreDir(),
    defaults: {
      enabled: [],
      devOverrides: {},
    },
  })
}

export function getEnabledExtensionIds(): string[] {
  return store?.get("enabled") ?? []
}

export function isExtensionEnabled(id: string): boolean {
  return getEnabledExtensionIds().includes(id)
}

export function setExtensionEnabled(id: string, enabled: boolean): void {
  if (!store) return
  const current = new Set(getEnabledExtensionIds())
  if (enabled) {
    current.add(id)
  } else {
    current.delete(id)
  }
  store.set("enabled", [...current])
}

export function getDevOverride(extensionId: string): string | undefined {
  return store?.get("devOverrides")?.[extensionId]
}

export function setDevOverride(
  extensionId: string,
  devEntry: string | undefined,
): void {
  if (!store) return
  const overrides = { ...store.get("devOverrides") }
  if (devEntry) {
    overrides[extensionId] = devEntry
  } else {
    delete overrides[extensionId]
  }
  store.set("devOverrides", overrides)
}
