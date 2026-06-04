import { describe, expect, it } from "vitest"
import { decideHydration } from "./hydrate-decision"

const inSync = {
  convKey: "5", sig: "3:42", needsHydrate: false,
  active: false, hydratedConvId: "5", lastHydratedSig: "3:42",
}

describe("decideHydration", () => {
  it("no-ops when already synced", () => {
    expect(decideHydration(inSync).action).toBe("none")
  })
  it("replaces wholesale when not active", () => {
    expect(decideHydration({ ...inSync, sig: "4:43", lastHydratedSig: "3:42", needsHydrate: true }).action).toBe("replace")
  })
  it("patches in place when active + same turn needs hydrate", () => {
    expect(decideHydration({ ...inSync, active: true, needsHydrate: true }).action).toBe("patch")
  })
  it("blocked (none) when active + already hydrated + no needsHydrate even if sig differs", () => {
    expect(decideHydration({ ...inSync, active: true, sig: "9:99" }).action).toBe("none")
  })
})
