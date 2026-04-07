import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactElement } from "react"

export type SerializedMentionPillNode = Spread<
  {
    mentionId: string
    mentionName: string
    type: "mention-pill"
    version: 1
  },
  SerializedLexicalNode
>

function MentionPillComponent({ mentionName }: { mentionName: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[13px] font-medium",
        "align-middle select-none",
        "bg-primary/10 text-primary"
      )}
      contentEditable={false}
    >
      <span className="text-primary/60">@</span>
      {mentionName}
    </span>
  )
}

export class MentionPillNode extends DecoratorNode<ReactElement | null> {
  __mentionId: string
  __mentionName: string

  static getType(): string {
    return "mention-pill"
  }

  static clone(node: MentionPillNode): MentionPillNode {
    return new MentionPillNode(node.__mentionId, node.__mentionName, node.__key)
  }

  constructor(mentionId: string, mentionName: string, key?: NodeKey) {
    super(key)
    this.__mentionId = mentionId
    this.__mentionName = mentionName
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    span.style.display = "inline-flex"
    span.style.verticalAlign = "middle"
    return span
  }

  updateDOM(): false {
    return false
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-mention-pill")) {
          return null
        }
        return {
          conversion: convertMentionPillElement,
          priority: 1,
        }
      },
    }
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span")
    element.setAttribute("data-lexical-mention-pill", "true")
    element.setAttribute("data-mention-id", this.__mentionId)
    element.setAttribute("data-mention-name", this.__mentionName)
    element.textContent = `@${this.__mentionName}`
    return { element }
  }

  static importJSON(
    serializedNode: SerializedMentionPillNode
  ): MentionPillNode {
    return $createMentionPillNode(
      serializedNode.mentionId,
      serializedNode.mentionName
    )
  }

  exportJSON(): SerializedMentionPillNode {
    return {
      mentionId: this.__mentionId,
      mentionName: this.__mentionName,
      type: "mention-pill",
      version: 1,
    }
  }

  getTextContent(): string {
    return ""
  }

  getMentionId(): string {
    return this.__mentionId
  }

  getMentionName(): string {
    return this.__mentionName
  }

  decorate(): ReactElement {
    return <MentionPillComponent mentionName={this.__mentionName} />
  }
}

function convertMentionPillElement(domNode: HTMLElement): DOMConversionOutput {
  const mentionId = domNode.getAttribute("data-mention-id")
  const mentionName = domNode.getAttribute("data-mention-name")
  if (mentionId && mentionName) {
    return { node: $createMentionPillNode(mentionId, mentionName) }
  }
  return { node: null }
}

export function $createMentionPillNode(
  mentionId: string,
  mentionName: string
): MentionPillNode {
  return new MentionPillNode(mentionId, mentionName)
}

export function $isMentionPillNode(
  node: LexicalNode | null | undefined
): node is MentionPillNode {
  return node instanceof MentionPillNode
}
