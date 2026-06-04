export type HydrateDecisionInput = {
  convKey: string
  sig: string
  needsHydrate: boolean
  active: boolean
  hydratedConvId: string | null
  lastHydratedSig: string
}

export type HydrateDecision = {
  action: "none" | "replace" | "patch"
}

export function decideHydration(input: HydrateDecisionInput): HydrateDecision {
  const alreadySynced =
    input.hydratedConvId === input.convKey &&
    input.lastHydratedSig === input.sig &&
    !input.needsHydrate
  if (alreadySynced) return { action: "none" }

  const blockedByActiveSession =
    input.active && input.hydratedConvId === input.convKey && !input.needsHydrate
  if (blockedByActiveSession) return { action: "none" }

  if (input.active && input.needsHydrate) return { action: "patch" }
  return { action: "replace" }
}
