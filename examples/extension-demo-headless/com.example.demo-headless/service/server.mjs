import http from "node:http"

const port = Number(process.env.PORT) || 0
const host = "127.0.0.1"

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, mode: "headless" }))
    return
  }
  if (req.url === "/api/hello") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({ message: "hello from headless extension service" }),
    )
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(port, host, () => {
  const addr = server.address()
  const actualPort =
    typeof addr === "object" && addr && "port" in addr ? addr.port : port
  console.log(`listening on ${actualPort}`)
})
