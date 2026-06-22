// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { WorkbenchChatSwitcher } from "./workbench-chat-switcher"

describe("WorkbenchChatSwitcher", () => {
  it("点击成员触发 onSelect", () => {
    const onSelect = vi.fn()
    render(
      <WorkbenchChatSwitcher
        members={[{ id: 1, name: "工作台助手" }]}
        activeId={null}
        onSelect={onSelect}
        invitable={[]}
        onToggleMember={() => {}}
      />
    )
    fireEvent.click(screen.getByText("工作台助手"))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it("无成员时显示引导文案", () => {
    render(
      <WorkbenchChatSwitcher
        members={[]}
        activeId={null}
        onSelect={() => {}}
        invitable={[]}
        onToggleMember={() => {}}
      />
    )
    expect(screen.getByText(/还没有工作台成员/)).toBeTruthy()
  })
})
