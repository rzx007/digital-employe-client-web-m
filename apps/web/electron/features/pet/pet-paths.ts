import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { getDataDir } from "../../core/data-paths"

export const PET_JSON_FILE = "pet.json"

/** 本应用宠物安装目录 ~/.boban-staff/pets */
export function getPetsRoot(): string {
  const root = path.join(getDataDir(), "pets")
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true })
  }
  return root
}

/** Codex 生态兼容目录 ~/.codex/pets（只读扫描） */
export function getCodexPetsRoot(): string {
  return path.join(os.homedir(), ".codex", "pets")
}

export function getPetFolderRoot(
  folderSlug: string,
  source: "installed" | "petdex",
): string {
  const root =
    source === "installed" ? getPetsRoot() : getCodexPetsRoot()
  return path.join(root, folderSlug)
}

export function getPetJsonPath(
  folderSlug: string,
  source: "installed" | "petdex",
): string {
  return path.join(getPetFolderRoot(folderSlug, source), PET_JSON_FILE)
}
