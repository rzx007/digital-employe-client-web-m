# Artifact 组件使用文档

## 概述

Artifact 是一个右侧编辑器面板，用于展示和编辑 AI 生成的内容，支持 4 种类型：

- **text** - 文本内容
- **code** - 代码块（带语法高亮）
- **sheet** - Markdown 表格
- **image** - 图像

## 快速开始

### 1. 导入组件

```tsx
import {
  ArtifactPreview,
  ArtifactPanel,
  useArtifactStore,
} from "@workspace/ui/components/ai-elements/artifact"
```

### 2. 在消息中显示 ArtifactPreview

```tsx
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"

function MessageComponent({ message }) {
  const meta = message.metadata as any
  const hasArtifact = meta?.artifactToolCallId && meta?.artifact

  return (
    <Message from={message.role}>
      <MessageContent>
        <MessageResponse>
          {message.parts?.reduce(
            (acc, part) => acc + (part.type === "text" ? part.text : ""),
            ""
          )}
        </MessageResponse>

        {hasArtifact && (
          <ArtifactPreview
            artifact={meta.artifact}
            onClick={() => openArtifact(meta.artifact.id)}
          />
        )}
      </MessageContent>
    </Message>
  )
}
```

### 3. 显示右侧面板

```tsx
function ChatPage() {
  const {
    activeArtifactId,
    isPanelOpen,
    isFullscreen,
    closeArtifact,
    toggleFullscreen,
    artifacts,
  } = useArtifactStore()

  const activeArtifact = activeArtifactId
    ? artifacts.get(activeArtifactId)
    : null

  return (
    <div className="flex h-full">
      {/* 聊天区域 */}
      <div className="flex-1">{/* 消息列表 */}</div>

      {/* Artifact 面板 */}
      {isPanelOpen && activeArtifact && (
        <div className="w-[600px] border-l">
          <ArtifactPanel
            artifact={activeArtifact}
            isOpen={isPanelOpen}
            isFullscreen={isFullscreen}
            onClose={closeArtifact}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      )}
    </div>
  )
}
```

### 4. 打开 Artifact

```tsx
import { useArtifactStore } from "@/stores/artifact-store"

function openArtifact(artifactId: string) {
  const { openArtifact, addArtifact } = useArtifactStore()

  // 添加到 store（如果还没添加）
  // addArtifact(artifact)

  // 打开面板
  openArtifact(artifactId)
}
```

## 后端触发 Artifact

### Python 后端示例

```python
from langchain.tools import tool
import json
import uuid

@tool
def create_code_artifact(code: str, language: str, title: str, description: str):
    """Create a code artifact"""
    artifact = {
        "artifact": {
            "id": f"artifact_{uuid.uuid4().hex[:8]}",
            "type": "code",
            "title": title,
            "content": code,
            "language": language,
            "metadata": {
                "description": description
            }
        }
    }
    return json.dumps(artifact)
```

### 工具调用返回格式

```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "tool_output": {
    "tool_call_id": "call_abc123",
    "output": "{\"artifact\":{\"id\":\"artifact-xxx\",\"type\":\"code\",\"title\":\"My Script\",\"content\":\"import pandas as pd\",\"language\":\"python\",\"metadata\":{}}}"
  }
}
```

## 组件 API

### ArtifactPreview

```tsx
interface ArtifactPreviewProps extends HTMLAttributes<HTMLDivElement> {
  artifact: Artifact // Artifact 对象
  onClick: () => void // 点击事件
  className?: string // 自定义类名
}
```

### ArtifactPanel

```tsx
interface ArtifactPanelProps {
  artifact: Artifact | null // 当前显示的 Artifact
  isOpen: boolean // 是否打开
  isFullscreen: boolean // 是否全屏
  onClose: () => void // 关闭回调
  onToggleFullscreen: () => void // 全屏切换回调
  className?: string // 自定义类名
}
```

### ArtifactHeader

```tsx
interface ArtifactHeaderProps {
  artifact: Artifact // Artifact 对象
  onClose: () => void // 关闭回调
  onToggleFullscreen: () => void // 全屏切换回调
  isFullscreen: boolean // 是否全屏
}
```

### Content Renderers

所有渲染器都具有相同的 props 接口：

```tsx
interface XRendererProps {
  artifact: Artifact // Artifact 对象
  className?: string // 自定义类名
}
```

## Store API

```tsx
interface ArtifactStore {
  // 状态
  activeArtifactId: string | null
  isPanelOpen: boolean
  isFullscreen: boolean
  artifacts: Map<string, Artifact>

  // 操作
  openArtifact: (id: string) => void
  closeArtifact: () => void
  addArtifact: (artifact: Artifact) => void
  removeArtifact: (id: string) => void
  toggleFullscreen: () => void
  setPanelOpen: (open: boolean) => void
}
```

## 完整示例

参见 `apps/web/app/chat/[chatId]/page.tsx` 中的完整实现。

## 类型定义

### Artifact

```tsx
interface Artifact {
  id: string // 唯一标识符
  type: "text" | "code" | "sheet" | "image" // 类型
  title: string // 标题
  content: string // 内容
  language?: string // 语言（code 类型专用）
  metadata?: Record<string, any> // 额外元数据
}
```

### ArtifactMetadata

```tsx
interface ArtifactMetadata {
  artifactToolCallId: string // 工具调用 ID
  artifact: Artifact // Artifact 对象
}
```
