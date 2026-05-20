import type { ExtensionManifest } from "./manifest-schema"

export const ExtensionPermission = {
  contextRead: "context.read",
  authRead: "auth.read",
  hostNotification: "host.notification",
  hostWindowMain: "host.window.main",
  hostStorage: "host.storage",
  hostBackendRead: "host.backend.read",
  hostEvents: "host.events",
  hostNetwork: "host.network",
  hostWindowSettings: "host.window.settings",
  hostPet: "host.pet",
  hostRecruitment: "host.recruitment",
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
  "backend.health": ExtensionPermission.hostBackendRead,
  "window.openSettings": ExtensionPermission.hostWindowSettings,
  "pet.show": ExtensionPermission.hostPet,
  "pet.hide": ExtensionPermission.hostPet,
  "recruitment.open": ExtensionPermission.hostRecruitment,
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

export interface ExtensionInvokeMethodDescriptor {
  method: string
  permission: ExtensionPermissionValue
  /** 当前插件 manifest 是否已声明对应 permission */
  allowed: boolean
}

/** 列出宿主支持的 invoke 方法（开发时用于发现 API） */
export function listExtensionInvokeMethods(
  manifest: Pick<ExtensionManifest, "permissions">,
): ExtensionInvokeMethodDescriptor[] {
  return Object.entries(EXTENSION_INVOKE_METHOD_PERMISSIONS).map(
    ([method, permission]) => ({
      method,
      permission,
      allowed: manifest.permissions.includes(permission),
    }),
  )
}
