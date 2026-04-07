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
}

class SlashCommandOption extends MenuOption {
  id: string
  title: string
  icon: React.ReactElement
  description: string
  keywords: Array<string>
  onSelect: (queryString: string) => void

  constructor(item: SlashCommandItem, onSelect: (queryString: string) => void) {
    super(item.title)
    this.id = item.id
    this.title = item.title
    this.icon = item.icon
    this.description = item.description
    this.keywords = item.keywords
    this.onSelect = onSelect.bind(this)
  }
}

function FloatingMenu({
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

  return createPortal(
    <div
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
          <CommandGroup heading="技能">
            {options.map((option, i) => (
              <CommandItem
                key={option.key}
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
                <div className="flex h-6 w-6 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                  {option.icon}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm leading-none font-medium">
                    {option.title}
                  </span>
                  <span className="text-xs text-muted-foreground line-clamp-2 ">
                    {option.description}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
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
