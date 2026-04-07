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
  CommandEmpty,
} from "@workspace/ui/components/command"
import { EmployeeContactAvatar } from "../chat/contact-avatars"
import { $createMentionPillNode } from "./mention-pill-node"

export interface MentionCandidate {
  id: string
  name: string
  avatar?: string
  role?: string
}

class MentionOption extends MenuOption {
  id: string
  name: string
  avatar?: string
  role?: string
  onSelect: () => void

  constructor(candidate: MentionCandidate) {
    super(candidate.name)
    this.id = candidate.id
    this.name = candidate.name
    this.avatar = candidate.avatar
    this.role = candidate.role
    this.onSelect = () => { }
  }
}

function MentionFloatingMenu({
  anchorElementRef,
  options,
  selectedIndex,
  selectOptionAndCleanUp,
  setHighlightedIndex,
}: {
  anchorElementRef: React.MutableRefObject<HTMLElement | null>
  options: MentionOption[]
  selectedIndex: number | null
  selectOptionAndCleanUp: (option: MentionOption) => void
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

  const isBottomOverflow = rect.bottom + 240 > window.innerHeight
  const topPosition = isBottomOverflow ? rect.top - 4 : rect.bottom + 4

  return createPortal(
    <div
      className="z-50 w-52 animate-in overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg fade-in-0 zoom-in-95"
      style={{
        position: "fixed",
        top: topPosition,
        left: rect.left,
        maxHeight: "240px",
        overflowY: "auto",
        transform: isBottomOverflow ? "translateY(-100%)" : "none",
      }}
    >
      <Command>
        <CommandList>
          <CommandEmpty className="px-2 py-1.5 text-xs text-muted-foreground">
            未找到匹配的成员
          </CommandEmpty>
          <CommandGroup>
            {options.map((option, i) => (
              <CommandItem
                key={option.key}
                onSelect={() => {
                  setHighlightedIndex(i)
                  selectOptionAndCleanUp(option)
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5",
                  "hover:bg-accent hover:text-accent-foreground",
                  selectedIndex === i && "bg-accent text-accent-foreground"
                )}
                onMouseEnter={() => {
                  setHighlightedIndex(i)
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                }}
              >
                <EmployeeContactAvatar
                  name={option.name}
                  avatar={option.avatar}
                  avatarClassName="size-5"
                  fallbackClassName="text-[9px]"
                />
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">
                    {option.name}
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

export function MentionPlugin({
  candidates = [],
}: {
  candidates?: MentionCandidate[]
}) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState<string | null>(null)

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("@", {
    minLength: 0,
  })

  const options = useMemo(() => {
    const items = candidates.map(
      (c) =>
        new MentionOption({
          id: c.id,
          name: c.name,
          avatar: c.avatar,
          role: c.role,
        })
    )

    if (!queryString) {
      return items
    }

    const regex = new RegExp(queryString, "i")
    return items.filter(
      (option) =>
        regex.test(option.name) || (option.role && regex.test(option.role))
    )
  }, [candidates, queryString])

  const onSelectOption = useCallback(
    (
      selectedOption: MentionOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void
    ) => {
      editor.update(() => {
        if (nodeToRemove) {
          nodeToRemove.remove()
        }
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          selection.insertNodes([
            $createMentionPillNode(selectedOption.id, selectedOption.name),
            $createTextNode(" "),
          ])
        }
      })
      closeMenu()
    },
    [editor]
  )

  if (candidates.length === 0) {
    return null
  }

  return (
    <LexicalTypeaheadMenuPlugin<MentionOption>
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
          <MentionFloatingMenu
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
