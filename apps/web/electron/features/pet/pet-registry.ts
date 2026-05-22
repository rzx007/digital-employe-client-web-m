import fs from "node:fs"
import path from "node:path"
import {
  getCodexPetsRoot,
  getPetFolderRoot,
  getPetsRoot,
  PET_JSON_FILE,
} from "./pet-paths"

export type PetMeta = {
  id?: string
  displayName?: string
  description?: string
  spritesheetPath?: string
}

export type CustomPetSource = "installed" | "petdex"

export type CustomPetInfo = {
  slug: string
  displayName: string
  description: string
  source: CustomPetSource
  petId?: string
}

export type ResolvedPetFolder = {
  root: string
  folderSlug: string
  source: CustomPetSource
  meta: PetMeta
}

const PET_ROOTS: Array<{ root: () => string; source: CustomPetSource }> = [
  { root: getPetsRoot, source: "installed" },
  { root: getCodexPetsRoot, source: "petdex" },
]

function readPetMeta(petJsonPath: string): PetMeta | null {
  if (!fs.existsSync(petJsonPath)) return null
  try {
    return JSON.parse(fs.readFileSync(petJsonPath, "utf-8")) as PetMeta
  } catch {
    return null
  }
}

function scanRoot(
  petsRoot: string,
  source: CustomPetSource,
): CustomPetInfo[] {
  if (!fs.existsSync(petsRoot)) return []

  const results: CustomPetInfo[] = []
  const entries = fs.readdirSync(petsRoot, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folderSlug = entry.name
    const meta = readPetMeta(path.join(petsRoot, folderSlug, PET_JSON_FILE))
    if (!meta) continue

    results.push({
      slug: folderSlug,
      displayName: meta.displayName ?? folderSlug,
      description: meta.description ?? "",
      source,
      petId: meta.id,
    })
  }

  return results
}

/** 合并双目录列表；同 slug 时 installed 优先 */
export function listCustomPets(): CustomPetInfo[] {
  const installed = scanRoot(getPetsRoot(), "installed")
  const installedSlugs = new Set(installed.map((p) => p.slug))
  const petdex = scanRoot(getCodexPetsRoot(), "petdex").filter(
    (p) => !installedSlugs.has(p.slug),
  )
  return [...installed, ...petdex]
}

function resolveInRoot(
  petsRoot: string,
  source: CustomPetSource,
  slug: string,
): ResolvedPetFolder | null {
  if (!fs.existsSync(petsRoot)) return null

  const directPath = path.join(petsRoot, slug, PET_JSON_FILE)
  const directMeta = readPetMeta(directPath)
  if (directMeta) {
    return {
      root: petsRoot,
      folderSlug: slug,
      source,
      meta: directMeta,
    }
  }

  const entries = fs.readdirSync(petsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const petJsonPath = path.join(petsRoot, entry.name, PET_JSON_FILE)
    const meta = readPetMeta(petJsonPath)
    if (!meta) continue
    if (meta.id === slug || entry.name === slug) {
      return {
        root: petsRoot,
        folderSlug: entry.name,
        source,
        meta,
      }
    }
  }

  return null
}

/** 按 slug 解析宠物目录；slug 可为文件夹名或 pet.json 的 id */
export function resolvePetFolder(slug: string): ResolvedPetFolder | null {
  for (const { root, source } of PET_ROOTS) {
    const resolved = resolveInRoot(root(), source, slug)
    if (resolved) return resolved
  }
  return null
}

export type PetMetaWithFolder = PetMeta & {
  folderSlug: string
  source: CustomPetSource
}

export function getCustomPetMeta(slug: string): PetMetaWithFolder | null {
  const resolved = resolvePetFolder(slug)
  if (!resolved) return null
  return {
    ...resolved.meta,
    folderSlug: resolved.folderSlug,
    source: resolved.source,
  }
}

export function resolvePetAssetPath(
  folderSlug: string,
  source: CustomPetSource,
  relativePath: string,
): string {
  const folderRoot = path.resolve(getPetFolderRoot(folderSlug, source))
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "")
  const fullPath = path.resolve(folderRoot, normalized)
  const relative = path.relative(folderRoot, fullPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes pet folder: ${relativePath}`)
  }
  return fullPath
}

export function uninstallPet(slug: string): void {
  const resolved = resolveInRoot(getPetsRoot(), "installed", slug)
  if (!resolved) {
    throw new Error(`Installed pet not found: ${slug}`)
  }
  const folderPath = path.join(resolved.root, resolved.folderSlug)
  fs.rmSync(folderPath, { recursive: true, force: true })
}
