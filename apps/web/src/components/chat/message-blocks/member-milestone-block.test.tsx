// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemberMilestoneBlock } from "./member-milestone-block"

describe("MemberMilestoneBlock", () => {
  it("renders sender name, milestone text and clickable artifact", () => {
    const onOpen = vi.fn()
    render(
      <MemberMilestoneBlock
        senderName="张三"
        kind="delivered"
        text="文案已完成"
        artifacts={["a/report.md"]}
        onOpenArtifact={onOpen}
      />
    )
    expect(screen.getByText("张三")).toBeTruthy()
    expect(screen.getByText("文案已完成")).toBeTruthy()
    fireEvent.click(screen.getByText("report.md"))
    expect(onOpen).toHaveBeenCalledWith("a/report.md")
  })
})
