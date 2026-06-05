import { describe, expect, it, vi } from "vitest"

import { resolveFileOpen } from "./file-open-routing"

describe("resolveFileOpen", () => {
  it("routes html path with conversationId to openHtmlPreview", () => {
    const openHtmlPreview = vi.fn()
    const openResource = vi.fn()
    resolveFileOpen("/foo/index.html", {
      conversationId: 42,
      openHtmlPreview,
      openResource,
    })
    expect(openHtmlPreview).toHaveBeenCalledWith(42, "/foo/index.html")
    expect(openResource).not.toHaveBeenCalled()
  })

  it("routes non-html path to openResource", () => {
    const openHtmlPreview = vi.fn()
    const openResource = vi.fn()
    resolveFileOpen("/foo/notes.md", {
      conversationId: 42,
      openHtmlPreview,
      openResource,
    })
    expect(openResource).toHaveBeenCalledWith("/foo/notes.md")
    expect(openHtmlPreview).not.toHaveBeenCalled()
  })

  it("falls back to openResource for html path when conversationId is null", () => {
    const openHtmlPreview = vi.fn()
    const openResource = vi.fn()
    resolveFileOpen("/foo/index.html", {
      conversationId: null,
      openHtmlPreview,
      openResource,
    })
    expect(openResource).toHaveBeenCalledWith("/foo/index.html")
    expect(openHtmlPreview).not.toHaveBeenCalled()
  })

  it("falls back to openResource for html path when conversationId is undefined", () => {
    const openHtmlPreview = vi.fn()
    const openResource = vi.fn()
    resolveFileOpen("/foo/index.html", {
      conversationId: undefined,
      openHtmlPreview,
      openResource,
    })
    expect(openResource).toHaveBeenCalledWith("/foo/index.html")
    expect(openHtmlPreview).not.toHaveBeenCalled()
  })
})
