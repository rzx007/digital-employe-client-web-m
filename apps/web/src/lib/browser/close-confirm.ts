const STORAGE_KEY = "browser-close-confirm-dismissed"

export function isBrowserCloseConfirmDismissed(): boolean {
  if (typeof localStorage === "undefined") return false
  return localStorage.getItem(STORAGE_KEY) === "1"
}

export function setBrowserCloseConfirmDismissed(dismissed: boolean): void {
  if (typeof localStorage === "undefined") return
  if (dismissed) {
    localStorage.setItem(STORAGE_KEY, "1")
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}
