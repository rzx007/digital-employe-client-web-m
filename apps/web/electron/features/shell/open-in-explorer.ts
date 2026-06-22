import fs from "node:fs"
import path from "node:path"
import { shell } from "electron"

export type ExplorerEntryType = "file" | "directory"

export async function revealPathInExplorer(
  targetPath: string,
  entryType: ExplorerEntryType
): Promise<void> {
  const normalized = path.normalize(targetPath)

  if (!fs.existsSync(normalized)) {
    throw new Error("路径不存在或文件尚未写入完成")
  }

  if (entryType === "file") {
    shell.showItemInFolder(normalized)
    return
  }

  const stat = fs.statSync(normalized)
  const dir = stat.isDirectory() ? normalized : path.dirname(normalized)
  const result = await shell.openPath(dir)
  if (result) {
    throw new Error(result)
  }
}
