import { useCallback, useState, useMemo } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import {
  TextNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
} from "lexical"
import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@workspace/ui/lib/utils"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { $createCommandPillNode } from "./command-pill-node"

export interface SlashCommandItem {
  id: string
  title: string
  icon: React.ReactElement
  description: string
  keywords: string[]
  kind?: "skill" | "shortcut" // 默认按 skill 处理
  prompt?: string // 仅 shortcut：选中后注入正文的模板
}

export class SlashCommandOption extends MenuOption {
  id: string
  title: string
  icon: React.ReactElement
  description: string
  keywords: Array<string>
  kind?: "skill" | "shortcut"
  prompt?: string // 仅 shortcut：由调用方(resolveCuratorSend)读取，插件本身不消费
  onSelect: (queryString: string) => void

  constructor(item: SlashCommandItem, onSelect: (queryString: string) => void) {
    super(item.title)
    this.id = item.id
    this.title = item.title
    this.icon = item.icon
    this.description = item.description
    this.keywords = item.keywords
    this.kind = item.kind
    this.prompt = item.prompt
    this.onSelect = onSelect.bind(this)
  }
}

export function FloatingMenu({
  anchorElementRef,
  options,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
}: {
  anchorElementRef: React.MutableRefObject<HTMLElement | null>
  options: SlashCommandOption[]
  selectedIndex: number | null
  selectOptionAndCleanUp: (option: SlashCommandOption) => void
  setHighlightedIndex: (index: number) => void
}) {
  const [rect, setRect] = useState<{
    top: number
    left: number
    bottom: number
  } | null>(null)

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (anchorElementRef.current) {
        const { top, left, bottom } =
          anchorElementRef.current.getBoundingClientRect()
        setRect({ top, left, bottom })
      }
    }, 10)
    return () => clearTimeout(timeoutId)
  }, [anchorElementRef, options.length])

  if (!rect || options.length === 0) {
    return null
  }

  const isBottomOverflow = rect.bottom + 300 > window.innerHeight
  const topPosition = isBottomOverflow ? rect.top - 40 : rect.bottom + 4

  const indexed = options.map((option, i) => ({ option, i }))
  const shortcuts = indexed.filter((x) => x.option.kind === "shortcut")
  const skills = indexed.filter((x) => x.option.kind !== "shortcut")
  const renderItem = (option: SlashCommandOption, i: number) => (
    <CommandItem
      key={option.key}
      // 把 DOM 节点登记到 option.ref：Lexical 方向键导航据此 scrollIntoView，
      // 缺失则高亮变化但菜单不滚动（option.ref.current 恒 null）。
      ref={option.setRefElement}
      onSelect={() => {
        setHighlightedIndex(i)
        selectOptionAndCleanUp(option)
      }}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-sm p-2 hover:bg-accent hover:text-accent-foreground",
        selectedIndex === i && "bg-accent text-accent-foreground"
      )}
      onMouseEnter={() => {
        setHighlightedIndex(i)
      }}
      onMouseDown={(e) => {
        e.preventDefault()
      }}
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
        {option.icon}
      </div>
      <div className="flex flex-col">
        <span className="text-sm leading-none font-medium">
          {option.title}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {option.description}
        </span>
      </div>
    </CommandItem>
  )

  return createPortal(
    <div
      data-prompt-typeahead-menu="true"
      className="z-50 max-w-2xl animate-in overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md fade-in-0 zoom-in-95"
      style={{
        position: "fixed",
        top: topPosition,
        left: rect.left - 18,
        maxHeight: "300px",
        overflowY: "auto",
        transform: isBottomOverflow ? "translateY(-100%)" : "none",
      }}
    >
      <Command>
        <CommandList>
          {shortcuts.length > 0 && (
            <CommandGroup heading="快捷指令">
              {shortcuts.map(({ option, i }) => renderItem(option, i))}
            </CommandGroup>
          )}
          {skills.length > 0 && (
            <CommandGroup heading="技能">
              {skills.map(({ option, i }) => renderItem(option, i))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>,
    document.body
  )
}

export function SlashCommandPlugin({
  commands = [],
}: {
  commands?: SlashCommandItem[]
}) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("/", {
    minLength: 0,
  })

  const options = useMemo(() => {
    const items = commands.map(
      (cmd) =>
        new SlashCommandOption(cmd, () => {
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              selection.insertNodes([
                $createCommandPillNode(cmd.id, cmd.title),
                $createTextNode(" "),
              ])
            }
          })
        })
    )

    if (!queryString) {
      return items
    }

    const regex = new RegExp(queryString, "i")
    return items.filter(
      (option) =>
        regex.test(option.title) ||
        option.keywords.some((keyword) => regex.test(keyword))
    )
  }, [commands, editor, queryString])

  const onSelectOption = useCallback(
    (
      selectedOption: SlashCommandOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
      matchingString: string
    ) => {
      editor.update(() => {
        if (nodeToRemove) {
          nodeToRemove.remove()
        }
        selectedOption.onSelect(matchingString)
      })
      closeMenu()
    },
    [editor]
  )

  if (commands.length === 0) {
    return null
  }

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) => {
        if (anchorElementRef.current == null || options.length === 0) {
          return null
        }

        return (
          <FloatingMenu
            anchorElementRef={anchorElementRef}
            options={options}
            selectedIndex={selectedIndex}
            selectOptionAndCleanUp={selectOptionAndCleanUp}
            setHighlightedIndex={setHighlightedIndex}
          />
        )
      }}
    />
  )
}
