import { describe, expect, it } from "vitest"

import {
  parseGroupCreatedToolPayload,
  resolveGroupCreatedBlockKind,
} from "./group-created-tool-payload"

const groupCreatedOutput = JSON.stringify({
  type: "group_created",
  group_id: 13,
  group_name: "FDE 前端开发团队",
  group_conversation_id: 602,
  members: "张三、李四",
  message: "已拉群",
})

describe("parseGroupCreatedToolPayload", () => {
  it("parses group_created payload", () => {
    const payload = parseGroupCreatedToolPayload(groupCreatedOutput)
    expect(payload).toEqual({
      groupId: 13,
      groupConversationId: 602,
      groupName: "FDE 前端开发团队",
      message: "已拉群",
      members: "张三、李四",
    })
  })

  it("returns null for unrelated tool results", () => {
    expect(
      parseGroupCreatedToolPayload('{"type":"employee_hired","employee_id":1}')
    ).toBeNull()
  })
})

describe("resolveGroupCreatedBlockKind", () => {
  it("maps successful create_group_and_dispatch to group-created card", () => {
    expect(
      resolveGroupCreatedBlockKind(
        "create_group_and_dispatch",
        "output-available",
        groupCreatedOutput
      )
    ).toBe("group-created")
  })

  it("returns null for other tools", () => {
    expect(
      resolveGroupCreatedBlockKind(
        "hire_employee",
        "output-available",
        groupCreatedOutput
      )
    ).toBeNull()
  })
})
