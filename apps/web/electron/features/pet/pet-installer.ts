import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import JSZip from "jszip"
import { createLogger } from "../../core/logger"
import type { PetMeta } from "./pet-registry"
import { getPetsRoot, PET_JSON_FILE } from "./pet-paths"

const log = createLogger("pet:install")

const DEFAULT_SPRITESHEET = "sprite.webp"

function findPetJsonEntry(
  zip: JSZip,
): { petJsonPath: string; prefix: string } | null {
  const candidates = Object.keys(zip.files).filter(
    (name) =>
      !zip.files[name]?.dir &&
      name.endsWith(PET_JSON_FILE) &&
      !name.includes("__MACOSX"),
  )
  if (candidates.length === 0) return null
  if (candidates.length > 1) {
    const atRoot = candidates.find((n) => n === PET_JSON_FILE)
    if (atRoot) {
      return { petJsonPath: atRoot, prefix: "" }
    }
    throw new Error(
      "Zip contains multiple pet.json files; use a single pet per zip",
    )
  }
  const petJsonPath = candidates[0]!
  const prefix = petJsonPath.slice(0, -PET_JSON_FILE.length)
  return { petJsonPath, prefix }
}

function assertSafeZipEntry(entryName: string, prefix: string): string {
  const relative = entryName.slice(prefix.length)
  if (!relative || relative.endsWith("/")) {
    throw new Error(`Invalid zip entry: ${entryName}`)
  }
  const normalized = path.normalize(relative.replace(/\//g, path.sep))
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Zip slip detected: ${entryName}`)
  }
  return normalized
}

async function extractZipToDirectory(
  zip: JSZip,
  prefix: string,
  targetDir: string,
): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    if (!entryName.startsWith(prefix)) continue
    if (entryName.includes("__MACOSX")) continue

    const relative = assertSafeZipEntry(entryName, prefix)
    const destPath = path.join(targetDir, relative)
    const destDir = path.dirname(destPath)
    fs.mkdirSync(destDir, { recursive: true })

    const content = await entry.async("nodebuffer")
    fs.writeFileSync(destPath, content)
  }
}

function parsePetMetaFromDir(petDir: string): PetMeta {
  const petJsonPath = path.join(petDir, PET_JSON_FILE)
  const raw = JSON.parse(fs.readFileSync(petJsonPath, "utf-8")) as unknown
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid pet.json")
  }
  return raw as PetMeta
}

function sanitizeFolderName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned || "pet"
}

function deriveFolderSlug(
  prefix: string,
  meta: PetMeta,
  zipFilePath: string,
): string {
  if (prefix) {
    const segments = prefix.replace(/\/$/, "").split("/").filter(Boolean)
    const last = segments[segments.length - 1]
    if (last) return sanitizeFolderName(last)
  }
  if (meta.id) return sanitizeFolderName(meta.id)
  const base = path.basename(zipFilePath, path.extname(zipFilePath))
  return sanitizeFolderName(base)
}

function validatePetPackage(petDir: string, meta: PetMeta): void {
  const spritesheetPath = meta.spritesheetPath || DEFAULT_SPRITESHEET
  const spritesheetFull = path.join(petDir, spritesheetPath)
  if (!fs.existsSync(spritesheetFull)) {
    throw new Error(
      `Spritesheet not found: ${spritesheetPath}. Expected in pet package root.`,
    )
  }
  const ext = path.extname(spritesheetFull).toLowerCase()
  if (ext !== ".webp" && ext !== ".png") {
    throw new Error(`Unsupported spritesheet format: ${ext}`)
  }
}

function removeDirRecursive(dir: string): void {
  if (!fs.existsSync(dir)) return
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * 从 zip 安装宠物到 ~/.digital-employee/pets/
 */
export async function installPetFromZip(
  zipFilePath: string,
): Promise<{ slug: string; displayName: string }> {
  const resolvedZip = path.resolve(zipFilePath)
  if (!fs.existsSync(resolvedZip)) {
    throw new Error(`Zip file not found: ${resolvedZip}`)
  }

  const buffer = fs.readFileSync(resolvedZip)
  const zip = await JSZip.loadAsync(buffer)
  const located = findPetJsonEntry(zip)
  if (!located) {
    throw new Error(`Zip does not contain ${PET_JSON_FILE}`)
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "de-pet-install-"))

  try {
    await extractZipToDirectory(zip, located.prefix, tempRoot)
    const meta = parsePetMetaFromDir(tempRoot)
    validatePetPackage(tempRoot, meta)

    const folderSlug = deriveFolderSlug(
      located.prefix,
      meta,
      resolvedZip,
    )
    const destRoot = path.join(getPetsRoot(), folderSlug)
    const petsRoot = path.resolve(getPetsRoot())
    const resolvedDest = path.resolve(destRoot)
    if (
      resolvedDest !== petsRoot &&
      !resolvedDest.startsWith(petsRoot + path.sep)
    ) {
      throw new Error("Invalid pet install path")
    }

    if (fs.existsSync(destRoot)) {
      removeDirRecursive(destRoot)
    }
    fs.renameSync(tempRoot, destRoot)

    const displayName = meta.displayName ?? folderSlug
    log.info("pet installed from zip", { slug: folderSlug, resolvedZip })
    return { slug: folderSlug, displayName }
  } catch (err) {
    removeDirRecursive(tempRoot)
    throw err
  }
}
