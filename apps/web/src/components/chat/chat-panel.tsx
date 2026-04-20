import * as React from "react"
import type { UIMessage } from "ai"

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
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import logo from "@/assets/logo.svg"
import {
  classifyMessageParts,
  getLatestArtifactFromUIMessage,
} from "@/lib/chat/message-utils"
import type { Message as StoredMessage } from "@/lib/mock-data/messages"
import { Spinner } from "@/components/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useChatStore } from "@/stores/chat-store"
import { useArtifactStore } from "@/stores/artifact-store"

import { ArtifactPreview } from "../artifact"
import { ChatPromptInput } from "../chat-prompt-input"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "../lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "../lexical-editor/mention-plugin"
import { ChatPanelHeader } from "./chat-panel-header"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { ThinkingBlock } from "./thinking-block"
import { ToolGroupBlock } from "./tool-group-block"
import { WorkbenchView } from "./workbench-view"
import {
  getContactDisplayName,
  isMessageMetadata,
  type ChatViewContact,
} from "./chat-view-shared"

const EMPTY_MESSAGES: UIMessage[] = []

function renderClassifiedBlocks(
  blocks: import("@/lib/chat/message-classifier").ClassifiedBlock[]
) {
  return blocks.map((block) => {
    if (block.kind === "thinking") {
      return <ThinkingBlock key={block.key} text={block.text} />
    }

    if (block.kind === "tool-group") {
      return <ToolGroupBlock key={block.key} block={block} />
    }

    if (block.kind === "final-response") {
      return (
        <MessageResponse key={block.key}>{block.text}</MessageResponse>
      )
    }

    return null
  })
}

export function ChatPanel({
  contact,
  title,
  conversationId,
  messages,
  storedMessages = [],
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
  conversationId?: string | number
  messages: UIMessage[]
  storedMessages?: StoredMessage[]
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
  const isMobile = useIsMobile()
  const { addArtifact, openArtifact, setFullscreen } = useArtifactStore()
  const { showWorkbench, setShowWorkbench } = useChatStore()

  const contactDisplayName = contact
    ? getContactDisplayName(contact)
    : "AI 助手"

  const displayMessages = isDraftMode ? EMPTY_MESSAGES : messages
  const showStreamingIndicator =
    !isDraftMode &&
    (status === "submitted" || status === "streaming") &&
    !error &&
    displayMessages.length > 0

  React.useEffect(() => {
    displayMessages.forEach((message) => {
      const artifact = getLatestArtifactFromUIMessage(message)

      if (artifact) {
        addArtifact(artifact)
      }
    })
  }, [addArtifact, displayMessages])

  const formatTime = React.useCallback((date: Date) => {
    return format(date, "HH:mm", { locale: zhCN })
  }, [])

  const slashCommands = React.useMemo<SlashCommandItem[]>(() => {
    const skills =
      contact?.type === "employee" ? contact.employee?.skills : undefined
    console.log("skills", skills)
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
    console.log("contact", contact)
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
            conversationId={conversationId}
            contact={contact}
            onOpenContacts={onOpenContacts}
            onOpenConversations={onOpenConversations}
            onNewConversation={onNewConversation}
            showWorkbench={showWorkbench}
            onToggleWorkbench={() => setShowWorkbench(!showWorkbench)}
          />
          {showWorkbench && contact?.type === "employee" ? (
            <WorkbenchView
              contact={contact}
              onClose={() => setShowWorkbench(false)}
            />
          ) : (
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
                      const liveArtifact =
                        getLatestArtifactFromUIMessage(message)
                      const classifiedBlocks = classifyMessageParts(message)
                      const storedMessage = storedMessages.find(
                        (item) => item.id === message.id
                      )
                      const timestamp = storedMessage?.timestamp
                      const metadata = isMessageMetadata(
                        storedMessage?.metadata
                      )
                        ? storedMessage.metadata
                        : null
                      const artifact =
                        liveArtifact ?? metadata?.artifact ?? null

                      const handleOpenArtifact = () => {
                        if (!artifact) {
                          return
                        }

                        addArtifact(artifact)
                        setFullscreen(isMobile)
                        openArtifact(artifact.id)
                      }

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
                          <MessageContent>
                            <div className="space-y-3">
                              {classifiedBlocks.length > 0 ? (
                                renderClassifiedBlocks(classifiedBlocks)
                              ) : metadata?.artifact ? null : (
                                <MessageResponse />
                              )}
                            </div>
                          </MessageContent>
                          {artifact && (
                            <ArtifactPreview
                              artifact={artifact}
                              onClick={handleOpenArtifact}
                            />
                          )}
                          {timestamp && (
                            <div
                              className={cn(
                                "mt-1 text-[10px] text-muted-foreground",
                                message.role === "user" && "text-right"
                              )}
                            >
                              {formatTime(timestamp)}
                            </div>
                          )}
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
          )}
        </>
      )}
    </div>
  )
}
