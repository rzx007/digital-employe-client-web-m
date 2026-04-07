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

export type SerializedCommandPillNode = Spread<
  {
    commandId: string
    commandTitle: string
    type: "command-pill"
    version: 1
  },
  SerializedLexicalNode
>

function CommandPillComponent({ commandTitle }: { commandTitle: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[calc(var(--radius)-3px)] bg-primary/45 px-1.5 py-0.5 text-sm font-medium text-primary-foreground",
        "align-middle select-none"
      )}
      contentEditable={false}
    >
      /{commandTitle}
    </span>
  )
}

export class CommandPillNode extends DecoratorNode<ReactElement | null> {
  __commandId: string
  __commandTitle: string

  static getType(): string {
    return "command-pill"
  }

  static clone(node: CommandPillNode): CommandPillNode {
    return new CommandPillNode(
      node.__commandId,
      node.__commandTitle,
      node.__key
    )
  }

  constructor(commandId: string, commandTitle: string, key?: NodeKey) {
    super(key)
    this.__commandId = commandId
    this.__commandTitle = commandTitle
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    // Needs to have some display otherwise React portal might have issues
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
        if (!domNode.hasAttribute("data-lexical-command-pill")) {
          return null
        }
        return {
          conversion: convertCommandPillElement,
          priority: 1,
        }
      },
    }
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span")
    element.setAttribute("data-lexical-command-pill", "true")
    element.setAttribute("data-command-id", this.__commandId)
    element.setAttribute("data-command-title", this.__commandTitle)
    element.textContent = `/${this.__commandTitle}`
    return { element }
  }

  static importJSON(
    serializedNode: SerializedCommandPillNode
  ): CommandPillNode {
    const node = $createCommandPillNode(
      serializedNode.commandId,
      serializedNode.commandTitle
    )
    return node
  }

  exportJSON(): SerializedCommandPillNode {
    return {
      commandId: this.__commandId,
      commandTitle: this.__commandTitle,
      type: "command-pill",
      version: 1,
    }
  }

  getTextContent(): string {
    // 不让命令 Pill 参与纯文本 value 的计算
    return ""
  }

  getCommandId(): string {
    return this.__commandId
  }

  getCommandTitle(): string {
    return this.__commandTitle
  }

  decorate(): ReactElement {
    return <CommandPillComponent commandTitle={this.__commandTitle} />
  }
}

function convertCommandPillElement(domNode: HTMLElement): DOMConversionOutput {
  const commandId = domNode.getAttribute("data-command-id")
  const commandTitle = domNode.getAttribute("data-command-title")
  if (commandId && commandTitle) {
    const node = $createCommandPillNode(commandId, commandTitle)
    return { node }
  }
  return { node: null }
}

export function $createCommandPillNode(
  commandId: string,
  commandTitle: string
): CommandPillNode {
  return new CommandPillNode(commandId, commandTitle)
}

export function $isCommandPillNode(
  node: LexicalNode | null | undefined
): node is CommandPillNode {
  return node instanceof CommandPillNode
}
