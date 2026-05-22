import path from "node:path"
import fs from "node:fs"
import type { Protocol } from "electron"
import { createLogger } from "./logger"
import { resolvePetFolder, resolvePetAssetPath } from "../features/pet/pet-registry"

const log = createLogger("petdex")

/**
 * petdex:// 协议 handler（主 session 与 pet 分区 session 共用）
 */
export function handlePetdexRequest(
  request: Request,
): Response | Promise<Response> {
  try {
    const url = new URL(request.url)
    const requestedPath = path.normalize(url.pathname.replace(/^\//, ""))
    const resolved = resolvePetFolder(url.hostname)
    if (!resolved) {
      return new Response("Not Found", { status: 404 })
    }

    const fullPath = resolvePetAssetPath(
      resolved.folderSlug,
      resolved.source,
      requestedPath,
    )
    if (!fs.existsSync(fullPath)) {
      return new Response("Not Found", { status: 404 })
    }

    const data = fs.readFileSync(fullPath)
    const ext = path.extname(fullPath).toLowerCase()
    const mimeTypes: Record<string, string> = {
      ".webp": "image/webp",
      ".png": "image/png",
      ".json": "application/json",
    }
    return new Response(data, {
      headers: {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } catch (e) {
    log.error("handler error", {
      message: e instanceof Error ? e.message : String(e),
    })
    return new Response("Not Found", { status: 404 })
  }
}

export function registerPetdexOnProtocol(
  protocolApi: Protocol,
): void {
  protocolApi.handle("petdex", handlePetdexRequest)
}
