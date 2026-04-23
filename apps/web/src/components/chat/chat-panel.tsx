import * as React from "react"
import type { UIMessage } from "ai"
import { AnimatePresence, motion } from "motion/react"

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { cn } from "@workspace/ui/lib/utils"
import { IconSparkles } from "@tabler/icons-react"
import logo from "@/assets/logo.svg"
import {
  classifyMessageParts,
} from "@/lib/chat/message-utils"
import type { ArtifactData } from "@/lib/chat/langchain-sse-schema"
import { Spinner } from "@/components/spinner"
import { useChatStore } from "@/stores/chat-store"
import { useArtifactStore } from "@/stores/artifact-store"

import { ChatPromptInput } from "../chat-prompt-input"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "../lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "../lexical-editor/mention-plugin"
import { ChatPanelHeader } from "./chat-panel-header"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { ThinkingBlock } from "./thinking-block"
import { ToolGroupBlock } from "./tool-group-block"
import {
  getContactDisplayName,
  type ChatViewContact,
  chatTransport,
} from "./chat-view-shared"

const EMPTY_MESSAGES: UIMessage[] = []

type CommandMeta = { id?: string; title?: string } | null
type MentionMeta = Array<{ id?: string; name?: string }>
type MessageMeta = {
  command?: { id?: string; title?: string } | null
  mentions?: Array<{ id?: string; name?: string }>
}

function getMessageMeta(message: UIMessage): MessageMeta | null {
  if (!message || typeof message !== "object") {
    return null
  }
  const meta = (message as UIMessage & { metadata?: unknown }).metadata
  return meta && typeof meta === "object" ? (meta as MessageMeta) : null
}

function MessageMetaBadges({
  commandMeta,
  mentionMeta,
  messageId,
}: {
  commandMeta: CommandMeta
  mentionMeta: MentionMeta
  messageId: string
}) {
  if (!commandMeta?.title && mentionMeta.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {commandMeta?.title && (
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
          /{commandMeta.title}
        </span>
      )}
      {mentionMeta.map((mention, index) => (
        <span
          key={mention.id ?? `${messageId}:mention:${index}`}
          className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-600"
        >
          @{mention.name ?? "unknown"}
        </span>
      ))}
    </div>
  )
}

const motionTransition = { duration: 0.3, ease: "easeOut" as const }

function renderClassifiedBlocks(
  blocks: import("@/lib/chat/message-classifier").ClassifiedBlock[],
  options?: {
    commandMeta?: CommandMeta
    mentionMeta?: MentionMeta
    messageId?: string
  }
) {
  return (
    <AnimatePresence mode="popLayout">
      {blocks.map((block) => {
        if (block.kind === "tool-group") {
          return (
            <motion.div
              key={block.key}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={motionTransition}
            >
              <ToolGroupBlock className="w-full ml-1" block={block} />
            </motion.div>
          )
        }

        const text = block.text

        if (block.kind === "thinking") {
          return (
            <motion.div
              key={block.key}
              layout
              initial={{ opacity: 0.5 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
              transition={motionTransition}
            >
              <ThinkingBlock className="w-full" text={text} />
            </motion.div>
          )
        }

        const commandMeta = options?.commandMeta ?? null
        const mentionMeta = options?.mentionMeta ?? []
        const messageId = options?.messageId ?? block.key

        return (
          <motion.div
            key={block.key}
            layout
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition}
            className="w-full flex items-center space-x-2"
          >
            <MessageMetaBadges
              commandMeta={commandMeta}
              mentionMeta={mentionMeta}
              messageId={messageId}
            />
            <MessageResponse className="flex-1">{text}</MessageResponse>
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}

export function ChatPanel({
  contact,
  title,
  messages,
  inputValue,
  status,
  error,
  isDraftMode,
  isSubmitDisabled,
  onInputChange,
  onSend,
  onStop,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  title: string
  messages: UIMessage[]
  inputValue: string
  status: "submitted" | "streaming" | "ready" | "error"
  error?: Error
  isDraftMode: boolean
  isSubmitDisabled: boolean
  onInputChange: (event: PromptChangeEvent) => void
  onSend: (message: PromptInputMessage) => Promise<void>
  onStop?: () => void
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const { addArtifact, openArtifact } = useArtifactStore()
  const contactDisplayName = contact
    ? getContactDisplayName(contact)
    : "AI 助手"

  const displayMessages = isDraftMode ? EMPTY_MESSAGES : messages
  const showStreamingIndicator =
    !isDraftMode &&
    (status === "submitted" || status === "streaming") &&
    !error &&
    displayMessages.length > 0

  // 注册流式 artifact 事件处理器
  React.useEffect(() => {
    const handleArtifact = (data: ArtifactData) => {
      const artifact: import("@/types/artifact").Artifact = {
        id: data.id,
        type: data.artifactType,
        title: data.title,
        content: data.content,
        language: data.language ?? undefined,
      }
      addArtifact(artifact)
      openArtifact(data.id)
    }

    chatTransport.setArtifactHandler(handleArtifact)
    return () => {
      chatTransport.setArtifactHandler(undefined)
    }
  }, [addArtifact, openArtifact])

  const slashCommands = React.useMemo<SlashCommandItem[]>(() => {
    const skills =
      contact?.type === "employee" ? contact.employee?.skills : undefined
    if (!skills?.length) return []
    return skills.map((skill) => ({
      id: String(skill.id),
      title: skill.skillName || skill.skill_name,
      icon: <IconSparkles className="h-4 w-4" />,
      description: skill.description || skill.skill_description || "",
      keywords: [
        skill.skill_name ? skill.skill_name.toLowerCase() : "",
        ...(skill.skill_description
          ? skill.skill_description.toLowerCase().split(/\s+/).slice(0, 3)
          : []),
      ],
    }))
    // return [
    //   {
    //     id: "skill-1",
    //     title: "技能 1",
    //     icon: <IconSparkles className="h-4 w-4" />,
    //     description: 'Answer questions about the AI SDK and help build AI-powered features. ',
    //     keywords: ["技能", "技能 1", "描述 1"],
    //   }
    // ]
  }, [contact])
  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (contact?.type === "group") {
      return (contact.group?.participants ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        role: p.role,
      }))
    }
    if (contact?.type === "curator") {
      const { contacts } = useChatStore.getState()
      return contacts
        .filter((c) => c.type === "employee" && c.employee)
        .map((c) => ({
          id: c.employee!.id,
          name: c.employee!.name,
          avatar: c.employee!.avatar,
          role: c.employee!.role,
        }))
    }
    return []
  }, [contact])

  return (
    <div
      className={cn("flex flex-1 flex-col bg-background", className)}
      {...props}
    >
      {contact && (
        <>
          <ChatPanelHeader
            title={title}
            contact={contact}
            onOpenContacts={onOpenContacts}
            onOpenConversations={onOpenConversations}
            onNewConversation={onNewConversation}
          />
          <>
            <Conversation className="min-h-0 flex-1 overflow-y-auto pt-4">
              <ConversationContent>
                {isDraftMode ? (
                  <ConversationEmptyState className="py-16">
                    <div className="flex flex-col items-center gap-6">
                      <img
                        src={logo}
                        alt="Logo"
                        className="size-12 opacity-80"
                      />
                      <div className="space-y-3 text-center">
                        <h2 className="text-md font-semibold tracking-tight">
                          数字员工智能助手
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          随时为您解答问题、处理任务、提升效率
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        {[
                          "智能问答",
                          "数据分析",
                          "文档生成",
                          "流程自动化",
                        ].map((label) => (
                          <span
                            key={label}
                            className="rounded-full border border-border/60 bg-muted/50 px-3 py-1 text-xs text-muted-foreground"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </ConversationEmptyState>
                ) : displayMessages.length === 0 ? (
                  <ConversationEmptyState className="py-16">
                    <div className="flex flex-col items-center gap-5">
                      <img
                        src={logo}
                        alt="Logo"
                        className="h-10 w-10 opacity-50"
                      />
                      <div className="space-y-1.5 text-center">
                        <h3 className="text-sm font-medium">开始新对话</h3>
                        <p className="text-xs text-muted-foreground">
                          在下方输入消息，开启与 {contactDisplayName} 的对话
                        </p>
                      </div>
                    </div>
                  </ConversationEmptyState>
                ) : (
                  displayMessages.map((message) => {
                    const classifiedBlocks = classifyMessageParts(message)
                    const messageMeta = getMessageMeta(message)
                    const commandMeta =
                      messageMeta &&
                        typeof messageMeta === "object" &&
                        "command" in messageMeta &&
                        messageMeta.command &&
                        typeof messageMeta.command === "object"
                        ? (messageMeta.command as { id?: string; title?: string })
                        : null
                    const mentionMeta =
                      messageMeta &&
                        typeof messageMeta === "object" &&
                        "mentions" in messageMeta &&
                        Array.isArray(messageMeta.mentions)
                        ? (messageMeta.mentions as Array<{
                          id?: string
                          name?: string
                        }>)
                        : []

                    return (
                      <Message
                        key={message.id}
                        from={message.role}
                        className="mx-auto max-w-4xl"
                      >
                        {message.role === "assistant" && (
                          <div className="mb-2 flex items-center gap-2">
                            {contact.type === "group" ? (
                              <GroupMembersAvatar
                                participants={contact.group?.participants}
                                className="size-6"
                                itemClassName="h-3 w-3"
                                fallbackClassName="text-[8px]"
                                placeholderClassName="h-3 w-3"
                              />
                            ) : contact.type === "curator" ? (
                              <EmployeeContactAvatar
                                name={contact.curator?.name}
                                avatar={contact.curator?.avatar}
                                status={contact.curator?.status}
                                avatarClassName="size-6"
                                fallbackClassName="text-[10px]"
                              />
                            ) : (
                              <EmployeeContactAvatar
                                name={contact.employee?.name}
                                avatar={contact.employee?.avatar}
                                status={contact.employee?.status}
                                avatarClassName="size-6"
                                fallbackClassName="text-[10px]"
                              />
                            )}
                            <span className="text-xs text-muted-foreground">
                              {contactDisplayName}
                            </span>
                          </div>
                        )}

                        <MessageContent className="w-auto">
                          <div className="space-y-3">
                            {classifiedBlocks.length > 0 ? (
                              renderClassifiedBlocks(classifiedBlocks, {
                                commandMeta,
                                mentionMeta,
                                messageId: message.id,
                              })
                            ) : (
                              <MessageResponse />
                            )}
                          </div>
                        </MessageContent>
                      </Message>
                    )
                  })
                )}

                {showStreamingIndicator && (
                  <Message
                    from="assistant"
                    className="mx-auto -mt-4 max-w-4xl"
                  >
                    <MessageContent className="rounded-lg bg-muted/40 px-3 py-2.5">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Spinner
                          className="size-3.5"
                          style={{ color: "#8B5CF6" }}
                        />
                        <Shimmer className="text-xs">正在生成回复...</Shimmer>
                      </div>
                    </MessageContent>
                  </Message>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <div className="border-none p-4">
              <ChatPromptInput
                value={inputValue}
                onChange={onInputChange}
                onSubmit={onSend}
                onStop={onStop}
                status={status}
                disabled={isSubmitDisabled}
                size="compact"
                className="mx-auto w-full max-w-4xl overflow-hidden shadow-xl"
                slashCommands={slashCommands}
                mentionCandidates={mentionCandidates}
              />
              {error && (
                <p className="mt-2 text-xs text-destructive">
                  {error.message}
                </p>
              )}
            </div>
          </>
        </>
      )}
    </div>
  )
}
