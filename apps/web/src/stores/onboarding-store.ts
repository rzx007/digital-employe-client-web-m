import { create } from "zustand"
import { getElectronApi } from "@/lib/electron/host"

interface OnboardingState {
  onboardingCompleted: boolean
  showWelcomeDialog: boolean
  tourRunning: boolean
  initialized: boolean
  initOnboarding: () => Promise<void>
  startTour: () => void
  completeOnboarding: () => void
  closeWelcomeDialog: () => void
  showWelcome: () => void
  resetOnboarding: () => void
}

async function readOnboardingCompleted(): Promise<boolean> {
  const api = getElectronApi()
  if (api?.getOnboardingCompleted) {
    return await api.getOnboardingCompleted()
  }
  const raw = localStorage.getItem("onboarding-storage")
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      return parsed?.state?.onboardingCompleted ?? false
    } catch {
      return false
    }
  }
  return false
}

async function writeOnboardingCompleted(value: boolean): Promise<void> {
  const api = getElectronApi()
  if (api?.setOnboardingCompleted) {
    await api.setOnboardingCompleted(value)
  }
}

export const useOnboardingStore = create<OnboardingState>()((set) => ({
  onboardingCompleted: false,
  showWelcomeDialog: false,
  tourRunning: false,
  initialized: false,

  initOnboarding: async () => {
    const completed = await readOnboardingCompleted()
    set({ onboardingCompleted: completed, initialized: true })
  },

  startTour: () => {
    set({ tourRunning: true, showWelcomeDialog: false })
  },

  completeOnboarding: () => {
    set({
      onboardingCompleted: true,
      tourRunning: false,
      showWelcomeDialog: false,
    })
    writeOnboardingCompleted(true)
  },

  closeWelcomeDialog: () => {
    set({ showWelcomeDialog: false, onboardingCompleted: true })
    writeOnboardingCompleted(true)
  },

  showWelcome: () => {
    set({ showWelcomeDialog: true })
  },

  resetOnboarding: () => {
    set({
      onboardingCompleted: false,
      showWelcomeDialog: true,
      tourRunning: false,
    })
    writeOnboardingCompleted(false)
  },
}))
