import "dotenv/config"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import sessionRoutes from "./routes/sessions"
import chatRoutes from "./routes/chat"
import artifactRoutes from "./routes/artifacts"
import { DATA_DIR } from "./db"
import openApiDoc from "./doc/openapi.json"

const STATIC_DIR = join(process.cwd(), "static")

const app = new Hono()

app.use("/*", cors())

app.use(async (c, next) => {
  if (c.req.path.startsWith("/static/")) {
    const filePath = c.req.path.replace("/static/", "")
    const fullPath = join(STATIC_DIR, filePath)

    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return c.text("Not Found", 404)
    }

    const ext = fullPath.split(".").pop() || ""
    const mimeTypes: Record<string, string> = {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      svg: "image/svg+xml",
    }

    c.header("Content-Type", mimeTypes[ext] || "text/plain")
    return c.body(readFileSync(fullPath))
  }
  await next()
})

app.get("/", (c) =>
  c.json({
    name: "simple-agents",
    version: "2.0.0",
    dataDir: DATA_DIR,
    endpoints: {
      sessions: "RESTful /api/sessions",
      chat: "POST /api/sessions/:id/chat",
      chatStream: "POST /api/sessions/:id/chat/stream",
      messages: "GET /api/sessions/:id/messages",
      artifacts: "GET /api/sessions/:id/artifacts",
    },
  })
)

app.get("/doc", (c) => c.json(openApiDoc))

app.route("/api/sessions", sessionRoutes)
app.route("/api/sessions", chatRoutes)
app.route("/api/sessions", artifactRoutes)

const port = Number(process.env.PORT) || 3001
console.log(`Agent server running on http://localhost:${port}`)
console.log(`Data directory: ${DATA_DIR}`)

const server = serve({ fetch: app.fetch, port })

process.on("SIGINT", () => {
  server.close()
  process.exit(0)
})
process.on("SIGTERM", () => {
  server.close((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
    process.exit(0)
  })
})
