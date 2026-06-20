// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"

// ---- mock approveHitl ----
const approveHitlMock = vi.fn()
vi.mock("@/api/chat", () => ({
  approveHitl: (...args: unknown[]) => approveHitlMock(...args),
}))

// ---- mock isValidApproveMessageId & toast ----
vi.mock("@/lib/chat/hitl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/hitl")>()
  return {
    ...actual,
    isValidApproveMessageId: () => true,
  }
})

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { ExternalDirAuthCard } from "./external-dir-auth-card"

const TEST_PATH = "/home/user/documents"

function makeBlock(path: string = TEST_PATH) {
  return {
    kind: "external_dir_authorization" as const,
    key: "test:external-dir:0",
    toolCallId: "tc-1",
    toolName: "request_external_dir_access",
    state: "input-available",
    input: { path },
    resultText: null,
  }
}

afterEach(() => {
  cleanup()
  approveHitlMock.mockReset()
})

describe("ExternalDirAuthCard", () => {
  it("展示目标路径", () => {
    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="input-available"
        resultText={null}
        conversationId={1}
        messageId={100}
        onHitlApproved={vi.fn()}
      />
    )
    expect(screen.getByText(new RegExp(TEST_PATH))).toBeTruthy()
  })

  it("点「永久」→ approveHitl 调用带 decisions approve + scope permanent", async () => {
    approveHitlMock.mockResolvedValue({ data: { resumed: true } })

    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="input-available"
        resultText={null}
        conversationId={1}
        messageId={100}
        onHitlApproved={vi.fn()}
      />
    )

    const btn = screen.getByRole("button", { name: /永久/ })
    fireEvent.click(btn)

    await vi.waitFor(() => expect(approveHitlMock).toHaveBeenCalledOnce())

    const [convId, msgId, decisions, options] = approveHitlMock.mock.calls[0]
    expect(convId).toBe(1)
    expect(msgId).toBe(100)
    expect(decisions).toEqual([{ type: "approve" }])
    expect(options?.external_dir).toEqual({ path: TEST_PATH, scope: "permanent" })
  })

  it("点「仅这次」→ scope 为 once", async () => {
    approveHitlMock.mockResolvedValue({ data: { resumed: true } })

    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="input-available"
        resultText={null}
        conversationId={1}
        messageId={100}
        onHitlApproved={vi.fn()}
      />
    )

    const btn = screen.getByRole("button", { name: /仅这次/ })
    fireEvent.click(btn)

    await vi.waitFor(() => expect(approveHitlMock).toHaveBeenCalledOnce())

    const [, , decisions, options] = approveHitlMock.mock.calls[0]
    expect(decisions).toEqual([{ type: "approve" }])
    expect(options?.external_dir).toEqual({ path: TEST_PATH, scope: "once" })
  })

  it("点「本会话」→ scope 为 session", async () => {
    approveHitlMock.mockResolvedValue({ data: { resumed: true } })

    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="input-available"
        resultText={null}
        conversationId={1}
        messageId={100}
        onHitlApproved={vi.fn()}
      />
    )

    const btn = screen.getByRole("button", { name: "本会话" })
    fireEvent.click(btn)

    await vi.waitFor(() => expect(approveHitlMock).toHaveBeenCalledOnce())

    const [, , decisions, options] = approveHitlMock.mock.calls[0]
    expect(decisions).toEqual([{ type: "approve" }])
    expect(options?.external_dir).toEqual({ path: TEST_PATH, scope: "session" })
  })

  it("点「放行所有(本会话)」→ scope 为 auto", async () => {
    approveHitlMock.mockResolvedValue({ data: { resumed: true } })

    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="input-available"
        resultText={null}
        conversationId={1}
        messageId={100}
        onHitlApproved={vi.fn()}
      />
    )

    const btn = screen.getByRole("button", { name: /放行所有/ })
    fireEvent.click(btn)

    await vi.waitFor(() => expect(approveHitlMock).toHaveBeenCalledOnce())

    const [, , decisions, options] = approveHitlMock.mock.calls[0]
    expect(decisions).toEqual([{ type: "approve" }])
    expect(options?.external_dir).toEqual({ path: TEST_PATH, scope: "auto" })
  })

  it("点「拒绝」→ decisions 含 type:reject，不带 external_dir", async () => {
    approveHitlMock.mockResolvedValue({ data: { resumed: false } })

    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="input-available"
        resultText={null}
        conversationId={1}
        messageId={100}
        onHitlApproved={vi.fn()}
      />
    )

    const btn = screen.getByRole("button", { name: /拒绝/ })
    fireEvent.click(btn)

    await vi.waitFor(() => expect(approveHitlMock).toHaveBeenCalledOnce())

    const [, , decisions, options] = approveHitlMock.mock.calls[0]
    expect(decisions[0].type).toBe("reject")
    // 拒绝不带 external_dir
    expect(options?.external_dir).toBeUndefined()
  })

  it("onHitlApproved 在审批成功后被调用", async () => {
    approveHitlMock.mockResolvedValue({ data: { resumed: true, assistant_message_id: 200 } })
    const onApproved = vi.fn()

    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="input-available"
        resultText={null}
        conversationId={1}
        messageId={100}
        onHitlApproved={onApproved}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /永久/ }))
    await vi.waitFor(() => expect(onApproved).toHaveBeenCalledOnce())
    expect(onApproved.mock.calls[0][0]).toMatchObject({
      kind: "external_dir_authorization",
    })
  })

  it("state=output-available 时不显示按钮（已确认态）", () => {
    render(
      <ExternalDirAuthCard
        toolName="request_external_dir_access"
        input={{ path: TEST_PATH }}
        state="output-available"
        resultText="ok"
        conversationId={1}
        messageId={100}
        onHitlApproved={vi.fn()}
      />
    )

    expect(screen.queryByRole("button", { name: /永久/ })).toBeNull()
  })
})
