import { create } from "zustand"

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
      const data = await window.ipcRenderer?.getStoreValue("app")
      const endpoint = data?.endpoint
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
    set({ loading: true, validated: false })

    try {
      const url = `${protocol}${ip}:${port}/llm/activate/getMachineInfo`
      await fetch(url)
      set({ validated: true, loading: false })
      return true
    } catch {
      set({ validated: false, loading: false })
      return false
    }
  },

  saveEndpoint: async () => {
    const { protocol, ip, port } = get()
    const endpoint = `${protocol}${ip}:${port}`
    await window.ipcRenderer?.setStoreValue("app", { endpoint })
  },

  getBaseUrl: () => {
    const { protocol, ip, port } = get()
    return `${protocol}${ip}:${port}`
  },

  clearError: () => set({ error: null }),
}))
