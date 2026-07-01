// @vitest-environment happy-dom
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"

import {
  FloatingMenu,
  SlashCommandOption,
  type SlashCommandItem,
} from "./slash-command-plugin"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function makeOption(item: Partial<SlashCommandItem>): SlashCommandOption {
  return new SlashCommandOption(
    {
      id: item.id ?? "x",
      title: item.title ?? "标题",
      icon: <span data-testid="icon" />,
      description: item.description ?? "",
      keywords: item.keywords ?? [],
      kind: item.kind,
      prompt: item.prompt,
    },
    () => {}
  )
}

// 回归：Lexical 方向键滚动依赖 option.ref.current 指向真实 DOM；
// 自定义渲染必须把 option.setRefElement 挂到每个菜单项的 DOM 上，否则
// LexicalTypeaheadMenuPlugin 的 KEY_ARROW_* 处理器因 `option.ref.current == null`
// 跳过 SCROLL_TYPEAHEAD_OPTION_INTO_VIEW_COMMAND → 高亮变了但不滚动。
describe("FloatingMenu option ref 注册（滚动前置条件）", () => {
  it("渲染后每个菜单项的 option.ref.current 指向 DOM 元素", () => {
    vi.useFakeTimers()
    const shortcut = makeOption({ id: "s1", title: "快捷", kind: "shortcut" })
    const skill = makeOption({ id: "k1", title: "技能", kind: "skill" })
    const anchorElementRef = {
      current: {
        getBoundingClientRect: () => ({ top: 10, left: 10, bottom: 30 }),
      },
    } as unknown as React.MutableRefObject<HTMLElement | null>

    act(() => {
      render(
        <FloatingMenu
          anchorElementRef={anchorElementRef}
          options={[shortcut, skill]}
          selectedIndex={0}
          selectOptionAndCleanUp={() => {}}
          setHighlightedIndex={() => {}}
        />
      )
    })
    // 推进内部 10ms 定位 setTimeout → 菜单真正挂载
    act(() => {
      vi.advanceTimersByTime(20)
    })

    expect(shortcut.ref.current).not.toBeNull()
    expect(skill.ref.current).not.toBeNull()
  })
})
