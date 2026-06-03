import { describe, expect, it } from "vitest"

import { asNumber, parseJsonObject } from "./parse-utils"

describe("parseJsonObject", () => {
  it("parses a JSON object", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
  })
  it("trims surrounding whitespace before checking", () => {
    expect(parseJsonObject('  {"a":1}  ')).toEqual({ a: 1 })
  })
  it("returns null for non-object JSON (array / scalar)", () => {
    expect(parseJsonObject("[1,2]")).toBeNull()
    expect(parseJsonObject("42")).toBeNull()
    expect(parseJsonObject('"text"')).toBeNull()
  })
  it("returns null for text not starting with {", () => {
    expect(parseJsonObject("hello {")).toBeNull()
    expect(parseJsonObject("")).toBeNull()
  })
  it("returns null for malformed JSON", () => {
    expect(parseJsonObject("{not json}")).toBeNull()
    expect(parseJsonObject('{"a":}')).toBeNull()
  })
})

describe("asNumber", () => {
  it("passes through finite numbers", () => {
    expect(asNumber(0)).toBe(0)
    expect(asNumber(-3.5)).toBe(-3.5)
  })
  it("parses non-empty numeric strings", () => {
    expect(asNumber("42")).toBe(42)
    expect(asNumber(" 7 ")).toBe(7)
  })
  it("returns null for non-finite numbers", () => {
    expect(asNumber(Infinity)).toBeNull()
    expect(asNumber(NaN)).toBeNull()
  })
  it("returns null for empty / non-numeric strings and other types", () => {
    expect(asNumber("")).toBeNull()
    expect(asNumber("abc")).toBeNull()
    expect(asNumber(null)).toBeNull()
    expect(asNumber(undefined)).toBeNull()
    expect(asNumber({})).toBeNull()
  })
})
