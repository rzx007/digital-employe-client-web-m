import { describe, it, expect } from "vitest"

import { withYear } from "./brand"

describe("brand", () => {
  it("withYear 替换 {year} 为当前年", () => {
    const y = new Date().getFullYear()
    expect(withYear("© {year} X")).toBe(`© ${y} X`)
  })

  it("withYear 无占位时原样返回", () => {
    expect(withYear("纯文本")).toBe("纯文本")
  })
})
