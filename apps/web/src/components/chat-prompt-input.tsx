import { useState, useCallback, useMemo } from "react"
import type { FileUIPart } from "ai"
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@workspace/ui/components/ai-elements/attachments"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
} from "@workspace/ui/components/ai-elements/prompt-input"
import {
  LexicalPromptInputTextarea,
  type PromptChangeEvent,
} from "./lexical-editor/prompt-input-textarea"
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@workspace/ui/components/ai-elements/model-selector"
import { IconSettings, IconMap } from "@tabler/icons-react"
import type { SlashCommandItem } from "./lexical-editor/slash-command-plugin"

// Ensure models logic is shared or injected. We'll use a local constant for now.
const models = [
  {
    chef: "ZhiPu",
    chefSlug: "zhipu",
    id: "zhipu-glm-5.0",
    name: "GLM 5.0",
    providers: ["zhipu"],
  },
]

const AttachmentItem = ({
  attachment,
  onRemove,
}: {
  attachment: FileUIPart & { id: string }
  onRemove: (id: string) => void
}) => {
  const handleRemove = useCallback(() => {
    onRemove(attachment.id)
  }, [onRemove, attachment.id])

  return (
    <Attachment data={attachment} onRemove={handleRemove}>
      <AttachmentPreview />
      <AttachmentRemove />
    </Attachment>
  )
}

const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments()

  const handleRemove = useCallback(
    (id: string) => {
      attachments.remove(id)
    },
    [attachments]
  )

  if (attachments.files.length === 0) {
    return null
  }

  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <AttachmentItem
          attachment={attachment}
          key={attachment.id}
          onRemove={handleRemove}
        />
      ))}
    </Attachments>
  )
}

const ModelItem = ({
  m,
  onSelect,
}: {
  m: (typeof models)[0]
  onSelect: (id: string) => void
}) => {
  const handleSelect = useCallback(() => {
    onSelect(m.id)
  }, [onSelect, m.id])

  return (
    <ModelSelectorItem onSelect={handleSelect} value={m.id}>
      <ModelSelectorLogo provider={m.chefSlug as "zhipu"} />
      <ModelSelectorName>{m.name}</ModelSelectorName>
    </ModelSelectorItem>
  )
}

interface ChatPromptInputProps {
  value: string
  onChange: (e: PromptChangeEvent) => void
  onSubmit: (message: PromptInputMessage) => void
  status: "submitted" | "streaming" | "ready" | "error"
  disabled?: boolean
  placeholder?: string
  size?: "default" | "compact"
  className?: string
  /** 员工技能生成的斜杠命令 */
  slashCommands?: SlashCommandItem[]
}

export function ChatPromptInput({
  value,
  onChange,
  onSubmit,
  status,
  disabled,
  placeholder = "请输入任务，然后交给 Agent",
  size = "default",
  className,
  slashCommands,
}: ChatPromptInputProps) {
  const [model, setModel] = useState<string>(models[0]!.id)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)

  const selectedModelData = useMemo(
    () => models.find((m) => m.id === model) ?? models[0],
    [model]
  )

  const handleModelSelect = useCallback((modelId: string) => {
    setModel(modelId)
    setModelSelectorOpen(false)
  }, [])

  const isCompact = size === "compact"

  return (
    <div className={className}>
      <PromptInput globalDrop multiple onSubmit={onSubmit} className="">
        <PromptInputHeader>
          <PromptInputAttachmentsDisplay />
        </PromptInputHeader>
        <PromptInputBody
          className={isCompact ? "min-h-[60px]" : "min-h-[100px]"}
        >
          <LexicalPromptInputTextarea
            onChange={onChange}
            value={value}
            placeholder={placeholder}
            commands={slashCommands}
            className={`resize-none placeholder:text-muted-foreground/60 ${isCompact ? "min-h-[60px] text-base" : "min-h-28 text-lg"
              }`}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>

            {/* <PromptInputButton variant="ghost" size="icon-sm">
              <IconMap className="h-4 w-4" />
            </PromptInputButton> */}

            {/* <PromptInputButton variant="ghost" size="icon-sm">
              <IconSettings className="h-4 w-4" />
            </PromptInputButton> */}
          </PromptInputTools>
          <PromptInputTools>
            {/* <ModelSelector
              onOpenChange={setModelSelectorOpen}
              open={modelSelectorOpen}
            >
              <ModelSelectorTrigger asChild>
                <PromptInputButton className="min-w-20 px-1.5">
                  {selectedModelData?.name && (
                    <ModelSelectorName className="text-muted-foreground">
                      {selectedModelData.name}
                    </ModelSelectorName>
                  )}
                </PromptInputButton>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorList>
                  <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                  <ModelSelectorGroup heading="GLM 5.0">
                    {models.map((m) => (
                      <ModelItem
                        key={m.id}
                        m={m}
                        onSelect={handleModelSelect}
                      />
                    ))}
                  </ModelSelectorGroup>
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector> */}
            <PromptInputSubmit
              disabled={disabled}
              status={status}
              className="bg-primary/80 transition-colors hover:bg-primary"
            />
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
