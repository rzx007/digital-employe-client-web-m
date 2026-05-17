import {
  PET_STATES,
  PET_SHEET_COLS,
  PET_FRAMES_PER_ROW,
  PET_DURATIONS,
  type PetState,
} from "./animation/types"

export type PetMeta = {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
}

export type PetFrameAnimation = {
  row: number
  from: number
  to: number
  durations: number[]
  loop: boolean
}

export type PetSkin = {
  meta: PetMeta
  image: string
  animations: Record<PetState, PetFrameAnimation>
}

export type PetSkinInfo = {
  slug: string
  displayName: string
  description: string
  source: "bundled" | "petdex"
}

const metaModules = import.meta.glob<{ default: PetMeta }>(
  "./skins/*/pet.json",
  { eager: true },
)

const imageModules = import.meta.glob<string>(
  "./skins/*/*.webp",
  { eager: true, query: "?url", import: "default" },
)

function slugFromPath(path: string): string {
  return path.split("/skins/")[1]?.split("/")[0] ?? ""
}

export function createPetSkin(
  meta: PetMeta,
  imageSrc: string,
): PetSkin {
  const animations = {} as Record<PetState, PetFrameAnimation>
  for (let i = 0; i < PET_STATES.length; i++) {
    const state = PET_STATES[i]
    const frameCount = PET_FRAMES_PER_ROW[state]
    const from = i * PET_SHEET_COLS
    animations[state] = {
      row: i,
      from,
      to: from + frameCount - 1,
      durations: PET_DURATIONS[state],
      loop: state !== "jumping",
    }
  }
  return { meta, image: imageSrc, animations }
}

export function listBundledSkins(): PetSkinInfo[] {
  return Object.entries(metaModules).map(([path, mod]) => ({
    slug: mod.default.id || slugFromPath(path),
    displayName: mod.default.displayName,
    description: mod.default.description,
    source: "bundled" as const,
  }))
}

export function getSlugImage(slug: string): string | undefined {
  for (const [path, url] of Object.entries(imageModules)) {
    if (slugFromPath(path) === slug) return url
  }
}

/**
 * 加载已安装的宠物皮肤列表。
 * 
 * 该函数会合并内置 bundled 皮肤与通过 Electron IPC 接口获取的 Petdex 皮肤。
 * 如果 IPC 接口不可用或调用失败，则仅返回内置皮肤列表。
 * 
 * @returns 包含所有可用宠物皮肤信息的数组
 */
export async function loadInstalledSkinList(): Promise<PetSkinInfo[]> {
  const bundled = listBundledSkins()
  const api = window.electronApi

  // 尝试通过 Electron API 获取额外的 Petdex 皮肤并合并结果
  if (api?.listPetdexSkins) {
    try {
      const petdex = await api.listPetdexSkins()
      return [...bundled, ...petdex]
    } catch {
      // IPC not available
    }
  }

  // 在 API 不可用或发生错误时，回退到仅返回内置皮肤
  return bundled
}

export async function loadPetSkin(slug: string): Promise<PetSkin> {
  // 1. Try bundled skins
  for (const [path, mod] of Object.entries(metaModules)) {
    if (mod.default.id === slug || slugFromPath(path) === slug) {
      const image = getSlugImage(slug)
      if (!image) throw new Error(`Image not found for pet: ${slug}`)
      return createPetSkin(mod.default, image)
    }
  }

  // 2. Try Petdex ~/.codex/pets/ fallback
  const api = window.electronApi
  if (api?.getPetdexMeta) {
    const meta = await api.getPetdexMeta(slug)
    if (meta) {
      const imageSrc = `petdex://${meta.id || slug}/${meta.spritesheetPath || "sprite.webp"}`
      return createPetSkin(meta, imageSrc)
    }
  }

  throw new Error(`Pet not found: ${slug}`)
}
