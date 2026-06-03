import { IpcChannels } from "../../shared/ipc-channels"
import { invoke, onChannel } from "../../preload/invoke"

export interface BrowserUrlChangeEvent {
  url: string
  title: string
}

export interface BrowserLoadErrorEvent {
  errorCode: number
  errorDescription: string
  url: string
}

export interface BrowserConfirmationRequestEvent {
  id: string
  message: string
  refOrSelector: string
  screenshotBase64?: string
}

export interface BrowserRequestOpenEvent {
  url: string
}

export interface BrowserViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

export const browserBridge = {
  open: (url: string) => invoke(IpcChannels.browserOpen, url),
  navigate: (url: string) => invoke(IpcChannels.browserNavigate, url),
  resize: (widthRatio: number) =>
    invoke(IpcChannels.browserResize, widthRatio),
  hide: () => invoke(IpcChannels.browserHide),
  show: () => invoke(IpcChannels.browserShow),
  close: () => invoke(IpcChannels.browserClose),
  onUrlChange: (callback: (data: BrowserUrlChangeEvent) => void) =>
    onChannel("browser:url-change", (data) => {
      callback(data as BrowserUrlChangeEvent)
    }),
  onLoadError: (callback: (data: BrowserLoadErrorEvent) => void) =>
    onChannel("browser:load-error", (data) => {
      callback(data as BrowserLoadErrorEvent)
    }),
  onConfirmationRequest: (
    callback: (data: BrowserConfirmationRequestEvent) => void
  ) =>
    onChannel("browser:confirmation-request", (data) => {
      callback(data as BrowserConfirmationRequestEvent)
    }),
  onRequestOpen: (callback: (data: BrowserRequestOpenEvent) => void) =>
    onChannel("browser:request-open", (data) => {
      callback(data as BrowserRequestOpenEvent)
    }),
  onRequestClose: (callback: () => void) =>
    onChannel("browser:request-close", () => {
      callback()
    }),
  resolveConfirmation: (id: string, approved: boolean) =>
    invoke(IpcChannels.browserConfirmResolve, id, approved),
  syncBounds: (bounds: BrowserViewportBounds) =>
    invoke(IpcChannels.browserSyncBounds, bounds),
  onLayoutChanged: (callback: () => void) =>
    onChannel("browser:layout-changed", () => {
      callback()
    }),
}
