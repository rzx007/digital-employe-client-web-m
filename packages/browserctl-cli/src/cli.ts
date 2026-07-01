import { run, execute, parseFlags } from "@workspace/browserctl"
import { parseArgs, startDaemon } from "@workspace/browserctl-daemon"
import { ensureDaemon, quitDaemon } from "./daemon-manager.js"

const argv = process.argv.slice(2)
const cmd = argv[0]

function isCdpStaleError(error: unknown): boolean {
  const msg = String(error ?? "")
  return /WebSocket is not open|readyState 3 \(CLOSED\)|CDP not attached|BROWSER_UNAVAILABLE/i.test(
    msg,
  )
}

function printResult(
  result: { ok?: boolean } | undefined,
  pretty: boolean,
): void {
  const output = pretty
    ? JSON.stringify(result, null, 2)
    : JSON.stringify(result)
  process.stdout.write(`${output}\n`)
  process.exitCode = result && result.ok === false ? 1 : 0
}

async function runWithDaemonRetry(commandArgv: string[]): Promise<void> {
  let baseUrl = await ensureDaemon()
  const { flags } = parseFlags(commandArgv)
  let result = await execute(commandArgv, baseUrl)
  if (result?.ok === false && isCdpStaleError(result.error)) {
    quitDaemon()
    baseUrl = await ensureDaemon()
    result = await execute(commandArgv, baseUrl)
  }
  if (result !== undefined) printResult(result, Boolean(flags.pretty))
}

if (cmd === "serve") {
  await startDaemon(parseArgs(argv.slice(1)))
} else if (cmd === "quit") {
  quitDaemon()
  process.stdout.write(JSON.stringify({ ok: true, data: { quit: true } }) + "\n")
} else if (cmd === "--version" || cmd === "--help" || !cmd) {
  await run(argv)
} else if (cmd === "batch") {
  const baseUrl = await ensureDaemon()
  await run(argv, baseUrl)
} else {
  await runWithDaemonRetry(argv)
}
