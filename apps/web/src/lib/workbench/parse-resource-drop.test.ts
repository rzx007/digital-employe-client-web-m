import { describe, it, expect } from "vitest"
import { parseResourceDrop } from "./parse-resource-drop"

describe("parseResourceDrop", () => {
  it("解析合法载荷", () => {
    const r = parseResourceDrop(
      JSON.stringify({ id: 3, src_path: "a/x.html", title: "X", source: "upload" })
    )
    expect(r).toEqual({ id: 3, src_path: "a/x.html", title: "X", source: "upload" })
  })

  it("source 缺省归为 employee_artifact", () => {
    const r = parseResourceDrop(
      JSON.stringify({ id: 1, src_path: "a/y.html", title: "Y" })
    )
    expect(r?.source).toBe("employee_artifact")
  })

  it("非法载荷返回 null", () => {
    expect(parseResourceDrop("not-json")).toBeNull()
    expect(parseResourceDrop(null)).toBeNull()
    expect(parseResourceDrop(JSON.stringify({ title: "no id" }))).toBeNull()
  })
})
