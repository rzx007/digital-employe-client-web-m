import { parseArgs, startDaemon } from "@workspace/browserctl-daemon"

// 本入口被 tsup 打成 dist/daemon.js，由 CLI spawn 当后台 daemon
await startDaemon(parseArgs(process.argv.slice(2)))
