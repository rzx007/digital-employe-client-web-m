import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $createParagraphNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from "lexical"
import { $createMentionPillNode } from "./mention-pill-node"

export type InsertMentionPayload = {
  id: string
  name: string
}

export const INSERT_MENTION_COMMAND = createCommand<InsertMentionPayload>(
  "INSERT_MENTION_COMMAND"
)

export function $insertMentionAtEditor(id: string, name: string) {
  const selection = $getSelection()
  if ($isRangeSelection(selection)) {
    selection.insertNodes([
      $createMentionPillNode(id, name),
      $createTextNode(" "),
    ])
    return
  }

  const root = $getRoot()
  const children = root.getChildren()
  const lastChild = children.at(-1)

  if (lastChild && $isElementNode(lastChild)) {
    lastChild.append($createMentionPillNode(id, name))
    lastChild.append($createTextNode(" "))
    return
  }

  const paragraph = $createParagraphNode()
  paragraph.append($createMentionPillNode(id, name))
  paragraph.append($createTextNode(" "))
  root.append(paragraph)
}

export function InsertMentionPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      INSERT_MENTION_COMMAND,
      (payload) => {
        if (!payload?.id || !payload?.name) {
          return false
        }
        editor.update(() => {
          $insertMentionAtEditor(payload.id, payload.name)
        })
        editor.focus()
        return true
      },
      COMMAND_PRIORITY_EDITOR
    )
  }, [editor])

  return null
}
