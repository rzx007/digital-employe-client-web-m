import type { PetState } from "./types"

export type SpriteAnimation = {
  from: number
  to: number
  fps: number
  loop: boolean
}

export type SpriteSkinManifest = {
  id: string
  name: string
  type: "sprite"
  image: string
  frameWidth: number
  frameHeight: number
  columns: number
  scale: number
  autoAlign?: boolean
  defaultAnimation: PetState
  animations: Partial<Record<PetState, SpriteAnimation>>
}

export function getSpriteAnimation(
  manifest: SpriteSkinManifest,
  animationName: PetState,
): SpriteAnimation {
  return (
    manifest.animations[animationName] ??
    manifest.animations[manifest.defaultAnimation] ?? {
      from: 0,
      to: 0,
      fps: 1,
      loop: true,
    }
  )
}
