import { create } from "zustand"
import { persist } from "zustand/middleware"

interface OnboardingState {
  onboardingCompleted: boolean
  showWelcomeDialog: boolean
  tourRunning: boolean
  startTour: () => void
  completeOnboarding: () => void
  closeWelcomeDialog: () => void
  showWelcome: () => void
  resetOnboarding: () => void
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      onboardingCompleted: false,
      showWelcomeDialog: false,
      tourRunning: false,

      startTour: () => {
        set({ tourRunning: true, showWelcomeDialog: false })
      },

      completeOnboarding: () => {
        set({
          onboardingCompleted: true,
          tourRunning: false,
          showWelcomeDialog: false,
        })
      },

      closeWelcomeDialog: () => {
        set({ showWelcomeDialog: false, onboardingCompleted: true })
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
      },
    }),
    {
      name: "onboarding-storage",
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
      }),
    }
  )
)
