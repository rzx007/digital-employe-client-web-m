import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, basename } from "node:path"

const app = new Hono()
const PORT = parseInt(process.env.PORT || "8080", 10)

const RELEASES_DIR = join(import.meta.dirname, "..", "releases", "win32")

app.use("*", cors())
app.use("*", async (c, next) => {
  await next()
  c.res.headers.set("Cache-Control", "no-cache")
})

app.get("/", (c) => {
  const ymlPath = join(RELEASES_DIR, "latest.yml")
  let version: string | null = null

  if (existsSync(ymlPath)) {
    const content = readFileSync(ymlPath, "utf-8")
    const match = content.match(/^version:\s*(.+)$/m)
    if (match) version = match[1].trim().replace(/^['"]|['"]$/g, "")
  }

  const files = existsSync(RELEASES_DIR)
    ? readdirSync(RELEASES_DIR).filter((f) => f !== ".gitkeep")
    : []

  return c.json({
    name: "digital-employee-update-server",
    latestVersion: version,
    files,
  })
})

app.get("/win32/latest.yml", (c) => {
  const filePath = join(RELEASES_DIR, "latest.yml")
  if (!existsSync(filePath)) {
    return c.json({ error: "latest.yml not found" }, 404)
  }
  const content = readFileSync(filePath, "utf-8")
  return c.text(content, 200, { "Content-Type": "text/yaml" })
})

app.get("/win32/:filename", (c) => {
  const filename = basename(c.req.param("filename"))
  const filePath = join(RELEASES_DIR, filename)

  if (!existsSync(filePath)) {
    return c.json({ error: `${filename} not found` }, 404)
  }

  const stat = statSync(filePath)
  const content = readFileSync(filePath)

  return c.body(content, 200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": stat.size.toString(),
    "Content-Disposition": `attachment; filename="${filename}"`,
  })
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Update server running at http://localhost:${info.port}`)
  console.log(`Releases dir: ${RELEASES_DIR}`)
})
