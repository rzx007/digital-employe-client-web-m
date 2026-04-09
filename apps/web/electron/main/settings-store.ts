import Store from "electron-store"

interface SettingsData {
  autoLaunch: boolean
  notifications: boolean
  autoUpdate: boolean
  model: string
  apiKey: string
  apiUrl: string
}

let store: Store<SettingsData> | null = null

export function initSettingsStore(): void {
  store = new Store<SettingsData>({
    name: "settings",
    defaults: {
      autoLaunch: false,
      notifications: true,
      autoUpdate: true,
      model: "",
      apiKey: "",
      apiUrl: "",
    },
  })
}

export function getSetting<K extends keyof SettingsData>(key: K): SettingsData[K] {
  if (!store) {
    // 根据键名返回对应的默认值
    const defaults: SettingsData = {
      autoLaunch: false,
      notifications: true,
      autoUpdate: true,
      model: "",
      apiKey: "",
      apiUrl: "",
    }
    return defaults[key]
  }
  return store.get(key)
}

export function setSetting<K extends keyof SettingsData>(
  key: K,
  value: SettingsData[K]
): void {
  store?.set(key, value)
}

export function getModelSettings(): {
  model: string
  apiKey: string
  apiUrl: string
} {
  return {
    model: store?.get("model") ?? "",
    apiKey: store?.get("apiKey") ?? "",
    apiUrl: store?.get("apiUrl") ?? "",
  }
}

export function setModelSettings(data: {
  model: string
  apiKey: string
  apiUrl: string
}): void {
  store?.set("model", data.model)
  store?.set("apiKey", data.apiKey)
  store?.set("apiUrl", data.apiUrl)
}

export function clearSettingsStore(): void {
  store?.clear()
}
