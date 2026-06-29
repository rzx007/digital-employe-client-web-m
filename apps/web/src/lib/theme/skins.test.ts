// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/theme/broadcast-appearance", () => ({
  broadcastAppearanceChanged: vi.fn(),
}))

import {
  SKINS,
  SKIN_STORAGE_KEY,
  getStoredSkin,
  applySkin,
  clearSkin,
  hasActiveSkin,
} from "./skins"

const root = () => document.documentElement

describe("skins", () => {
  beforeEach(() => {
    localStorage.clear()
    root().removeAttribute("data-theme")
    root().classList.remove("light", "dark")
  })

  it("含国网绿明暗两套与 7 套移植皮肤", () => {
    const ids = SKINS.map((s) => s.id)
    expect(ids).toContain("guowang-green")
    expect(ids).toContain("guowang-green-dark")
    expect(ids).toContain("ocean-dark")
    expect(SKINS).toHaveLength(9)
  })

  it("国网绿·夜为暗色基调", () => {
    const dark = SKINS.find((s) => s.id === "guowang-green-dark")
    expect(dark?.basis).toBe("dark")
  })

  it("applySkin 写 data-theme + localStorage + 暗色基调", () => {
    applySkin("ocean-dark")
    expect(root().getAttribute("data-theme")).toBe("ocean-dark")
    expect(root().classList.contains("dark")).toBe(true)
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("ocean-dark")
  })

  it("亮色皮肤打 .light 不打 .dark", () => {
    root().classList.add("dark")
    applySkin("guowang-green")
    expect(root().classList.contains("dark")).toBe(false)
    expect(root().classList.contains("light")).toBe(true)
  })

  it("非法 id 清皮肤", () => {
    applySkin("ocean-dark")
    applySkin("nope")
    expect(root().getAttribute("data-theme")).toBe(null)
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("")
  })

  it("clearSkin 清 data-theme 与存储", () => {
    applySkin("ocean-dark")
    clearSkin()
    expect(root().getAttribute("data-theme")).toBe(null)
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("")
  })

  it("getStoredSkin 未存时用 fallback", () => {
    expect(getStoredSkin("guowang-green")).toBe("guowang-green")
  })

  it("getStoredSkin 迁移旧 brand-theme=green → guowang-green 并删旧键", () => {
    localStorage.setItem("brand-theme", "green")
    expect(getStoredSkin()).toBe("guowang-green")
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("guowang-green")
    expect(localStorage.getItem("brand-theme")).toBe(null)
  })

  it("getStoredSkin 迁移旧 teal/default → 无皮肤", () => {
    localStorage.setItem("brand-theme", "teal")
    expect(getStoredSkin()).toBe("")
  })

  it("hasActiveSkin 反映当前状态", () => {
    expect(hasActiveSkin()).toBe(false)
    applySkin("slate-dark")
    expect(hasActiveSkin()).toBe(true)
  })
})
