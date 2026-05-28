import fs from "node:fs"
import path from "node:path"
import { app, dialog, shell, type BrowserWindow } from "electron"
import JSZip from "jszip"
import { getLogsDir } from "../../core/data-paths"
import { createLogger } from "../../core/logger"

const log = createLogger("logs:export")

/** 与 Python logging_setup 主日志文件一致，不含轮转备份 */
export const EXPORT_LOG_FILE_NAMES = [
  "main.log",
  "app.log",
  "error.log",
] as const

export type ExportLogFileName = (typeof EXPORT_LOG_FILE_NAMES)[number]

export interface LogFileEntry {
  name: ExportLogFileName
  absolutePath: string
  size: number
  mtimeMs: number
}

export function listExportLogFiles(logsDir = getLogsDir()): LogFileEntry[] {
  const entries: LogFileEntry[] = []
  for (const name of EXPORT_LOG_FILE_NAMES) {
    const absolutePath = path.join(logsDir, name)
    if (!fs.existsSync(absolutePath)) continue
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile()) continue
    entries.push({
      name,
      absolutePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    })
  }
  return entries
}

function formatExportTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export function buildLogsManifest(files: LogFileEntry[]) {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    exportedAt: new Date().toISOString(),
    files: files.map((f) => ({
      name: f.name,
      size: f.size,
      mtime: new Date(f.mtimeMs).toISOString(),
    })),
    missing: EXPORT_LOG_FILE_NAMES.filter(
      (name) => !files.some((f) => f.name === name)
    ),
  }
}

export async function buildLogsZip(files: LogFileEntry[]): Promise<Buffer> {
  const zip = new JSZip()
  const included: LogFileEntry[] = []

  for (const file of files) {
    try {
      const data = await fs.promises.readFile(file.absolutePath)
      zip.file(file.name, data)
      included.push(file)
    } catch (err) {
      log.warn("skip log file %s: %s", file.name, err)
    }
  }

  if (included.length === 0) {
    throw new Error("无法读取任何日志文件")
  }

  const manifest = buildLogsManifest(included)
  zip.file("manifest.json", JSON.stringify(manifest, null, 2))

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
}

export async function openLogsDirectory(): Promise<void> {
  const logsDir = getLogsDir()
  const result = await shell.openPath(logsDir)
  if (result) {
    throw new Error(result)
  }
}

export async function exportLogsToFile(
  parent: BrowserWindow
): Promise<{ path: string } | null> {
  const files = listExportLogFiles()
  if (files.length === 0) {
    throw new Error("未找到可导出的日志文件（main.log / app.log / error.log）")
  }

  const defaultPath = path.join(
    app.getPath("downloads"),
    `digital-employee-logs-${formatExportTimestamp()}.zip`
  )

  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: "导出日志",
    defaultPath,
    filters: [{ name: "Zip 压缩包", extensions: ["zip"] }],
  })

  if (canceled || !filePath) {
    return null
  }

  const zipPath = filePath.endsWith(".zip") ? filePath : `${filePath}.zip`
  const buffer = await buildLogsZip(files)
  await fs.promises.writeFile(zipPath, buffer)
  log.info("exported %d log files to %s", files.length, zipPath)

  return { path: zipPath }
}
