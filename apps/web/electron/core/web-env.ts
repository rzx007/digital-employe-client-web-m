import fs from "node:fs"
import path from "node:path"

/** 解析 apps/web/.env（简单 KEY = VALUE，与 Vite loadEnv 行为接近）。 */
export function loadWebEnvFile(appRoot: string): Record<string, string> {
  const envPath = path.join(appRoot, "..", ".env")
  if (!fs.existsSync(envPath)) {
    return {}
  }

  const out: Record<string, string> = {}
  const text = fs.readFileSync(envPath, "utf8")
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

/** 将 Finch 转写相关变量注入 Python 后端子进程环境。 */
export function getFinchEnvForBackend(appRoot: string): Record<string, string> {
  const webEnv = loadWebEnvFile(appRoot)
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const fromWeb = webEnv[key]?.trim()
      if (fromWeb) return fromWeb
      const fromProcess = process.env[key]?.trim()
      if (fromProcess) return fromProcess
    }
    return ""
  }

  const url = pick("VITE_FINCH_TRANSCRIPTION_URL", "SPEECH_TRANSCRIPTION_URL")
  const key = pick(
    "VITE_FINCH_TRANSCRIPTION_KEY",
    "SPEECH_TRANSCRIPTION_API_KEY",
    "FINCH_TRANSCRIPTION_KEY",
  )
  const model = pick(
    "VITE_FINCH_TRANSCRIPTION_MODEL",
    "SPEECH_TRANSCRIPTION_MODEL",
  )
  const language = pick(
    "VITE_FINCH_TRANSCRIPTION_LANGUAGE",
    "SPEECH_TRANSCRIPTION_LANGUAGE",
  )

  const out: Record<string, string> = {}
  if (url) {
    out.VITE_FINCH_TRANSCRIPTION_URL = url
    out.SPEECH_TRANSCRIPTION_URL = url
  }
  if (key) {
    out.VITE_FINCH_TRANSCRIPTION_KEY = key
    out.SPEECH_TRANSCRIPTION_API_KEY = key
  }
  if (model) {
    out.VITE_FINCH_TRANSCRIPTION_MODEL = model
    out.SPEECH_TRANSCRIPTION_MODEL = model
  }
  if (language) {
    out.VITE_FINCH_TRANSCRIPTION_LANGUAGE = language
    out.SPEECH_TRANSCRIPTION_LANGUAGE = language
  }
  return out
}
