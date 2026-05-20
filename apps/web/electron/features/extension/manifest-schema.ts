import { z } from "zod"

/** 反向域名式 ID：每段以小写字母开头，可含数字与连字符 */
const extensionIdRegex = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

const ExtensionUiSchema = z.object({
  entry: z.string().min(1),
  title: z.string().min(1),
  width: z.number().int().positive().default(960),
  height: z.number().int().positive().default(720),
  devEntry: z.string().url().optional(),
})

const ExtensionServiceReadySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdout"),
    pattern: z.string().min(1),
  }),
  z.object({
    type: z.literal("health"),
    path: z.string().min(1).default("/health"),
    intervalMs: z.number().int().positive().default(500),
    timeoutMs: z.number().int().positive().default(30_000),
  }),
])

export const ExtensionServiceManifestSchema = z.object({
  command: z.array(z.string()).min(1),
  cwd: z.string().default("."),
  env: z.record(z.string()).optional(),
  port: z.number().int().min(0).default(0),
  host: z.literal("127.0.0.1").default("127.0.0.1"),
  envPortKey: z.string().min(1).default("PORT"),
  ready: ExtensionServiceReadySchema,
  bundledBinary: z.string().optional(),
})

export const ExtensionManifestSchema = z
  .object({
    id: z.string().regex(extensionIdRegex, "invalid extension id"),
    version: z.string().min(1),
    displayName: z.string().min(1),
    minHostVersion: z.string().optional(),
    permissions: z
      .array(z.enum(["context.read", "auth.read"]))
      .default([]),
    ui: ExtensionUiSchema.optional(),
    service: ExtensionServiceManifestSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.ui && !data.service) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "manifest must include ui and/or service",
        path: ["ui"],
      })
    }
  })

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>
export type ExtensionServiceManifest = z.infer<
  typeof ExtensionServiceManifestSchema
>

export const MANIFEST_FILE_NAME = "digital-employee.extension.json"

const DEPRECATED_MANIFEST_KEYS = ["kind"] as const

/** 解析前移除已废弃字段（如旧版 kind） */
export function normalizeManifestRaw(raw: unknown): {
  value: unknown
  removed: string[]
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: raw, removed: [] }
  }
  const obj = raw as Record<string, unknown>
  const removed: string[] = []
  const copy = { ...obj }
  for (const key of DEPRECATED_MANIFEST_KEYS) {
    if (key in copy) {
      delete copy[key]
      removed.push(key)
    }
  }
  return { value: removed.length > 0 ? copy : raw, removed }
}

export function hasExtensionUi(
  manifest: Pick<ExtensionManifest, "ui">,
): boolean {
  return manifest.ui != null
}

/** manifest 含 service 块时需启停本地子进程 */
export function hasExtensionService(
  manifest: Pick<ExtensionManifest, "service">,
): boolean {
  return manifest.service != null
}

/** 仅 service、无 ui（后台服务插件） */
export function isHeadlessExtension(
  manifest: Pick<ExtensionManifest, "ui" | "service">,
): boolean {
  return hasExtensionService(manifest) && !hasExtensionUi(manifest)
}

/** 比较 semver：a >= b 时返回 true */
export function isHostVersionCompatible(
  hostVersion: string,
  minHostVersion: string | undefined,
): boolean {
  if (!minHostVersion) return true
  const parse = (v: string) =>
    v.split(".").map((p) => parseInt(p, 10) || 0)
  const host = parse(hostVersion)
  const min = parse(minHostVersion)
  const len = Math.max(host.length, min.length)
  for (let i = 0; i < len; i++) {
    const h = host[i] ?? 0
    const m = min[i] ?? 0
    if (h > m) return true
    if (h < m) return false
  }
  return true
}
