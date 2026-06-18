// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useFileDropzone } from "./use-file-dropzone"

function dragEvent(files: File[] = []) {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { files },
  } as unknown as React.DragEvent<HTMLElement>
}

const png = () => new File(["x"], "a.png", { type: "image/png" })

describe("useFileDropzone", () => {
  it("starts not dragging", () => {
    const { result } = renderHook(() =>
      useFileDropzone({ onDrop: vi.fn() }),
    )
    expect(result.current.isDragging).toBe(false)
  })

  it("sets dragging on dragEnter and prevents default", () => {
    const { result } = renderHook(() =>
      useFileDropzone({ onDrop: vi.fn() }),
    )
    const e = dragEvent()
    act(() => result.current.dropProps.onDragEnter(e))
    expect(result.current.isDragging).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it("keeps default prevented on dragOver so the OS does not open the file", () => {
    const { result } = renderHook(() =>
      useFileDropzone({ onDrop: vi.fn() }),
    )
    const e = dragEvent()
    act(() => result.current.dropProps.onDragOver(e))
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it("repeated dragOver does not inflate the enter count (no stuck highlight)", () => {
    const { result } = renderHook(() =>
      useFileDropzone({ onDrop: vi.fn() }),
    )
    act(() => result.current.dropProps.onDragEnter(dragEvent()))
    // onDragOver fires many times while hovering — must not affect the count
    act(() => result.current.dropProps.onDragOver(dragEvent()))
    act(() => result.current.dropProps.onDragOver(dragEvent()))
    act(() => result.current.dropProps.onDragOver(dragEvent()))
    // a single leave matching the single enter clears it
    act(() => result.current.dropProps.onDragLeave(dragEvent()))
    expect(result.current.isDragging).toBe(false)
  })

  it("calls onDrop with the first file and clears dragging", () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDropzone({ onDrop }))
    const file = png()
    const e = dragEvent([file])
    act(() => result.current.dropProps.onDragEnter(dragEvent()))
    act(() => result.current.dropProps.onDrop(e))
    expect(onDrop).toHaveBeenCalledWith(file)
    expect(result.current.isDragging).toBe(false)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it("does not call onDrop when disabled", () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() =>
      useFileDropzone({ onDrop, disabled: true }),
    )
    act(() => result.current.dropProps.onDrop(dragEvent([png()])))
    expect(onDrop).not.toHaveBeenCalled()
  })

  it("does not call onDrop when no file is present", () => {
    const onDrop = vi.fn()
    const { result } = renderHook(() => useFileDropzone({ onDrop }))
    act(() => result.current.dropProps.onDrop(dragEvent([])))
    expect(onDrop).not.toHaveBeenCalled()
  })

  it("stays dragging until every enter is matched by a leave (no child flicker)", () => {
    const { result } = renderHook(() =>
      useFileDropzone({ onDrop: vi.fn() }),
    )
    // enter parent, then enter child -> two dragEnters
    act(() => result.current.dropProps.onDragEnter(dragEvent()))
    act(() => result.current.dropProps.onDragEnter(dragEvent()))
    // leave child only -> still dragging
    act(() => result.current.dropProps.onDragLeave(dragEvent()))
    expect(result.current.isDragging).toBe(true)
    // leave parent -> done
    act(() => result.current.dropProps.onDragLeave(dragEvent()))
    expect(result.current.isDragging).toBe(false)
  })
})
