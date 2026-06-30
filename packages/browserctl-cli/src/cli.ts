import { run } from "@workspace/browserctl"
import { parseArgs, startDaemon } from "@workspace/browserctl-daemon"
import { ensureDaemon, quitDaemon } from "./daemon-manager.js"

const argv = process.argv.slice(2)
const cmd = argv[0]

if (cmd === "serve") {
  // 显式前台 daemon（调试 / 换非默认配置），Ctrl+C 停
  await startDaemon(parseArgs(argv.slice(1)))
} else if (cmd === "quit") {
  quitDaemon()
  process.stdout.write(JSON.stringify({ ok: true, data: { quit: true } }) + "\n")
} else if (cmd === "--version" || cmd === "--help" || !cmd) {
  await run(argv) // 不需要 daemon
} else {
  // 浏览器命令：auto-start daemon → 用其 baseUrl 跑命令
  const baseUrl = await ensureDaemon()
  await run(argv, baseUrl)
}
