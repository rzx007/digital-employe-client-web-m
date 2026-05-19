import { z } from "zod"

const extensionIdRegex = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/

export const ExtensionManifestSchema = z.object({
  id: z.string().regex(extensionIdRegex, "invalid extension id"),
  version: z.string().min(1),
  kind: z.literal("ui"),
  displayName: z.string().min(1),
  minHostVersion: z.string().optional(),
  permissions: z
    .array(z.enum(["context.read", "auth.read"]))
    .default([]),
  ui: z.object({
    entry: z.string().min(1),
    title: z.string().min(1),
    width: z.number().int().positive().default(960),
    height: z.number().int().positive().default(720),
    devEntry: z.string().url().optional(),
  }),
})

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>

export const MANIFEST_FILE_NAME = "digital-employee.extension.json"

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
