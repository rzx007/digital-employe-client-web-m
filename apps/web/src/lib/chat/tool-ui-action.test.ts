import { describe, expect, it } from "vitest"

import {
  buildPlanManualConfirmOutbound,
  buildPlanManualCancelOutbound,
} from "./plan-generated-payload"
import {
  buildRecruitmentHireAllOutbound,
  buildRecruitmentHireOutbound,
} from "./recruitment-tool-payload"
import { resolveLegacyUserActionDisplayText } from "./tool-ui-action"

describe("ToolUiAction outbound builders", () => {
  it("splits display vs agent text for single hire", () => {
    const outbound = buildRecruitmentHireOutbound({
      index: 1,
      name: "张三",
      description: "分析",
      skill_ids: [1, 2],
      skills_summary: "",
    })
    expect(outbound.displayText).toBe("已录用候选人：张三")
    expect(outbound.agentText).toContain("skill_ids")
    expect(outbound.agentText).not.toBe(outbound.displayText)
  })

  it("splits display vs agent text for batch hire", () => {
    const outbound = buildRecruitmentHireAllOutbound([
      {
        index: 1,
        name: "A",
        description: "",
        skill_ids: [],
        skills_summary: "",
      },
      {
        index: 2,
        name: "B",
        description: "",
        skill_ids: [],
        skills_summary: "",
      },
    ])
    expect(outbound.displayText).toContain("已请求录用 2 位候选人")
    expect(outbound.displayText).toContain("A、B")
    expect(outbound.agentText).toContain("hire_employees")
  })

  it("splits display vs agent text for plan confirm", () => {
    const outbound = buildPlanManualConfirmOutbound(12, "舆情巡检")
    expect(outbound.displayText).toBe("已确认执行编排计划「舆情巡检」")
    expect(outbound.agentText).toContain("confirm_orchestration_plan")
  })

  it("splits display vs agent text for plan cancel", () => {
    const outbound = buildPlanManualCancelOutbound(3)
    expect(outbound.displayText).toBe("已取消编排计划 #3")
    expect(outbound.agentText).toContain("cancel_plan")
  })
})

describe("resolveLegacyUserActionDisplayText", () => {
  it("maps legacy plan confirm agent text", () => {
    expect(
      resolveLegacyUserActionDisplayText(
        "【手动操作】我已在卡片上确认执行编排计划 #5（周报），请知晓，无需再调用 confirm_orchestration_plan。"
      )?.displayText
    ).toBe("已确认执行编排计划「周报」")
  })

  it("maps legacy hire agent text", () => {
    expect(
      resolveLegacyUserActionDisplayText(
        '录用「李四」\ndescription: 无\nskill_ids: []'
      )?.displayText
    ).toBe("已录用候选人：李四")
  })
})
