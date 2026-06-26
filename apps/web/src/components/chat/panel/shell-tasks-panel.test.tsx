// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

import { ShellTasksRow } from "./shell-tasks-panel"

const mutate = vi.fn()
vi.mock("@/hooks/use-kill-shell-execution", () => ({
  useKillShellExecution: () => ({ mutate, isPending: false }),
}))

describe("ShellTasksRow", () => {
  it("running 项渲染终止按钮并在点击时调用 kill", () => {
    const exec = {
      session_id: "s1",
      command: "sleep 999",
      intent: null,
      status: "running" as const,
      running: true,
      exit_code: null,
      started_wall: Date.now() / 1000,
      elapsed_seconds: 3,
    }
    render(<ShellTasksRow exec={exec} conversationId="42" />)
    const btn = screen.getByRole("button", { name: /终止/ })
    fireEvent.click(btn)
    expect(mutate).toHaveBeenCalledWith("s1")
  })
})
