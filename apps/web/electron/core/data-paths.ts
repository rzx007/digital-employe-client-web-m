import { app } from "electron"
import fs from "node:fs"
import path from "node:path"

/** 用户数据根目录，与 Python 后端 ~/.boban-staff-next 一致 */
export function getDataDir(): string {
  const dir = path.join(app.getPath("home"), ".boban-staff-next")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** 宿主日志目录：Electron main.log 与 Python app.log / error.log 同目录 */
export function getLogsDir(): string {
  const dir = path.join(getDataDir(), "logs")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}
