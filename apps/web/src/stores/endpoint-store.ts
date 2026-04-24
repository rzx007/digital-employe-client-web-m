import { create } from "zustand"
import { getConfigKv, setConfigKv } from "@/api/config-kv"

interface EndpointState {
  protocol: string
  ip: string
  port: number
  validated: boolean
  loading: boolean
  error: string | null
  loaded: boolean

  loadEndpoint: () => Promise<void>
  setProtocol: (protocol: string) => void
  setIp: (ip: string) => void
  setPort: (port: number) => void
  setValidated: (validated: boolean) => void
  validateEndpoint: () => Promise<boolean>
  saveEndpoint: () => Promise<void>
  getBaseUrl: () => string
  clearError: () => void
}

export const useEndpointStore = create<EndpointState>((set, get) => ({
  protocol: "http://",
  ip: "",
  port: 5002,
  validated: false,
  loading: false,
  error: null,
  loaded: false,

  loadEndpoint: async () => {
    try {
      const endpointKv = await getConfigKv("REMOTE_API_BASE_URL")
      const endpoint = endpointKv?.config_value
      if (endpoint) {
        const url = new URL(endpoint)
        set({
          protocol: url.protocol + "//",
          ip: url.hostname,
          port: Number(url.port) || 5002,
          loaded: true,
        })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  setProtocol: (protocol) => set({ protocol, validated: false }),
  setIp: (ip) => set({ ip, validated: false }),
  setPort: (port) => set({ port, validated: false }),
  setValidated: (validated) => set({ validated }),

  validateEndpoint: async () => {
    const { protocol, ip, port } = get()
    set({ loading: true, validated: false, error: null })

    try {
      if (!ip || !port) {
        throw new Error("endpoint is empty")
      }
      const origin = `${protocol}${ip}:${port}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      try {
        // 只验证网络可达性，不依赖具体业务接口
        await fetch(origin, {
          method: "HEAD",
          mode: "no-cors",
          cache: "no-store",
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
      set({ validated: true, loading: false })
      return true
    } catch {
      set({ validated: false, loading: false, error: "网络不可达，请检查协议/IP/端口" })
      return false
    }
  },

  saveEndpoint: async () => {
    const { protocol, ip, port } = get()
    const endpoint = `${protocol}${ip}:${port}`
    await setConfigKv("REMOTE_API_BASE_URL", endpoint)
  },

  getBaseUrl: () => {
    const { protocol, ip, port } = get()
    return `${protocol}${ip}:${port}`
  },

  clearError: () => set({ error: null }),
}))
