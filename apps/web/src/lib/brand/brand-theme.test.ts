// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest"

import {
  applyBrandTheme,
  getStoredBrandTheme,
  BRAND_THEMES,
  BRAND_THEME_STORAGE_KEY,
} from "./brand-theme"

describe("brand-theme", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-brand-theme")
  })

  it("含 default、green 预设", () => {
    const ids = BRAND_THEMES.map((t) => t.id)
    expect(ids).toContain("default")
    expect(ids).toContain("green")
  })

  it("apply 写 data-brand-theme 与 localStorage", () => {
    applyBrandTheme("green")
    expect(document.documentElement.getAttribute("data-brand-theme")).toBe(
      "green"
    )
    expect(localStorage.getItem(BRAND_THEME_STORAGE_KEY)).toBe("green")
  })

  it("default 清除属性（用根变量）", () => {
    applyBrandTheme("green")
    applyBrandTheme("default")
    expect(document.documentElement.getAttribute("data-brand-theme")).toBe(null)
  })

  it("非法 id 回退 default", () => {
    applyBrandTheme("nope")
    expect(document.documentElement.getAttribute("data-brand-theme")).toBe(null)
    expect(localStorage.getItem(BRAND_THEME_STORAGE_KEY)).toBe("default")
  })

  it("getStored 未存时回退 default", () => {
    expect(getStoredBrandTheme()).toBe("default")
  })

  it("getStored 读回已存值", () => {
    applyBrandTheme("teal")
    expect(getStoredBrandTheme()).toBe("teal")
  })

  it("未存时采用 fallback（品牌 defaultTheme）", () => {
    expect(getStoredBrandTheme("green")).toBe("green")
  })

  it("已存值优先于 fallback", () => {
    applyBrandTheme("teal")
    expect(getStoredBrandTheme("green")).toBe("teal")
  })

  it("fallback 非法时回退 default", () => {
    expect(getStoredBrandTheme("nope")).toBe("default")
  })
})
