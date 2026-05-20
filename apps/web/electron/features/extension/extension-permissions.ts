import type { ExtensionManifest } from "./manifest-schema"

export const ExtensionPermission = {
  contextRead: "context.read",
  authRead: "auth.read",
  hostNotification: "host.notification",
  hostWindowMain: "host.window.main",
  hostStorage: "host.storage",
  hostBackendRead: "host.backend.read",
  hostEvents: "host.events",
} as const

export type ExtensionPermissionValue =
  (typeof ExtensionPermission)[keyof typeof ExtensionPermission]

/** invoke 方法 → 所需 permission */
export const EXTENSION_INVOKE_METHOD_PERMISSIONS: Record<
  string,
  ExtensionPermissionValue
> = {
  "notification.show": ExtensionPermission.hostNotification,
  "window.focusMain": ExtensionPermission.hostWindowMain,
  "storage.get": ExtensionPermission.hostStorage,
  "storage.set": ExtensionPermission.hostStorage,
  "backend.getPort": ExtensionPermission.hostBackendRead,
}

export function assertExtensionPermission(
  manifest: ExtensionManifest,
  permission: ExtensionPermissionValue,
): void {
  if (!manifest.permissions.includes(permission)) {
    throw new Error(
      `Extension ${manifest.id} lacks permission: ${permission}`,
    )
  }
}

export function assertInvokeMethodAllowed(
  manifest: ExtensionManifest,
  method: string,
): void {
  const required = EXTENSION_INVOKE_METHOD_PERMISSIONS[method]
  if (!required) {
    throw new Error(`Unknown extension.invoke method: ${method}`)
  }
  assertExtensionPermission(manifest, required)
}
