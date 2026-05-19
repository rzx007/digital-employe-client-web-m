import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import type { Protocol } from "electron"

/**
 * petdex:// 协议 handler（主 session 与 pet 分区 session 共用）
 */
export function handlePetdexRequest(
  request: Request,
): Response | Promise<Response> {
  try {
    const url = new URL(request.url)
    const requestedPath = path.normalize(url.pathname.replace(/^\//, ""))
    const fullPath = path.resolve(
      os.homedir(),
      ".codex",
      "pets",
      url.hostname,
      requestedPath,
    )
    const petsRoot = path.resolve(os.homedir(), ".codex", "pets")
    const relative = path.relative(petsRoot, fullPath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Forbidden", { status: 403 })
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
    console.error("[petdex] handler error:", e)
    return new Response("Not Found", { status: 404 })
  }
}

export function registerPetdexOnProtocol(
  protocolApi: Protocol,
): void {
  protocolApi.handle("petdex", handlePetdexRequest)
}
