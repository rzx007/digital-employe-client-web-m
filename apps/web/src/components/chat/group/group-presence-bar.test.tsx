// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GroupPresenceBar } from "./group-presence-bar"

describe("GroupPresenceBar", () => {
  it("shows running count and opens overview on click", () => {
    const onOpen = vi.fn()
    render(
      <GroupPresenceBar
        members={[
          { member_id: 1, employee_id: 1, employee_name: "张三", state: "running", role_in_room: "worker", conversation_id: 9 },
          { member_id: 2, employee_id: 2, employee_name: "李四", state: "ready", role_in_room: "worker", conversation_id: null },
        ]}
        onOpenOverview={onOpen}
      />
    )
    expect(screen.getByText(/1 进行中/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button"))
    expect(onOpen).toHaveBeenCalled()
  })

  it("excludes the leader from the worker count", () => {
    render(
      <GroupPresenceBar
        members={[
          { member_id: 1, employee_id: null, employee_name: "组长", state: "running", role_in_room: "leader", conversation_id: 1 },
          { member_id: 2, employee_id: 2, employee_name: "李四", state: "ready", role_in_room: "worker", conversation_id: null },
        ]}
        onOpenOverview={() => {}}
      />
    )
    // 仅 1 个 worker（组长不计入队员数）
    expect(screen.getByText(/1 位队员/)).toBeTruthy()
  })
})
