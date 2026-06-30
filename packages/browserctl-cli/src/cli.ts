import { run } from "@workspace/browserctl"

// 暂直通：baseUrl 用默认（env BROWSER_RUNTIME_BRIDGE_URL 或 34555）。Phase 3 接 ensureDaemon。
await run(process.argv.slice(2))
