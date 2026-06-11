# 聊天输入框语音消息 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 聊天输入框支持语音录音 → ASR 转写发给模型，消息列表展示微信式语音胶囊（真实波形、可播放、右键看转写文本）。

**Architecture:** 录音器（LiveWaveform 声波 + MediaRecorder 共享麦克风流）只产出 `{ 转写文本, 时长, 波形峰值, blob }`；音频上传在视图层 `doSend` 内紧跟会话 ID 就绪后进行（草稿视图先建会话）；语音元数据走现有 `extra_meta` 通道随用户消息持久化（消息表零改动）；播放状态/blob 缓存放模块级单例（消息列表是虚拟滚动，胶囊组件会被卸载）。

**Tech Stack:** React 19 + TypeScript（vitest 单测，`pnpm --filter web test:unit`）、FastAPI + pytest（`cd apps/server && uv run pytest`）、ElevenLabs LiveWaveform（源码拷入）、sonner toast。

**Spec:** `docs/superpowers/specs/2026-06-11-voice-message-input-design.md`（实现中遇到歧义以 spec 为准）

**关键约定（来自 spec，实现时不得偏离）：**
- `extra_meta.voice = { duration_ms: number, audio_path: "voice/<uuid>.webm", waveform: number[] }`（snake_case，前后端不做大小写转换，前端读作 `metadata.voice`）
- 后端物理路径固定 `<artifacts_root>/<conversation_id>/voice/`，**禁止使用 `_resolve_conversation_dir`**（群会话会解析到 room 共享目录）
- 语音消息**绕过 pending 队列**直接 `doSend`
- 群聊不做：`chat-panel.tsx` 按 `contact?.type !== "group"` 隐藏麦克风（仿 `showContextBudget` 先例）
- 转写失败 toast 报错、消息不发出；最长 60s 自动停止；短于 1s 丢弃并提示「说话时间太短」
- 统一 webm，不转码

**代码风格（CLAUDE.md）：** 无分号、双引号、尾逗号、2 空格缩进。每个任务完成后运行 `pnpm typecheck`。提交信息用中文、conventional commits。

---

### Task 1: 拷入 LiveWaveform 组件

**Files:**
- Create: `packages/ui/src/components/ai-elements/live-waveform.tsx`

- [ ] **Step 1: 下载源码**

```bash
curl -sL "https://raw.githubusercontent.com/elevenlabs/ui/main/apps/www/registry/elevenlabs-ui/ui/live-waveform.tsx" -o packages/ui/src/components/ai-elements/live-waveform.tsx
```

约 560 行。若网络失败，从 GitHub 仓库 `elevenlabs/ui` 路径 `apps/www/registry/elevenlabs-ui/ui/live-waveform.tsx` 获取。

- [ ] **Step 2: 修正 import 路径**

文件头部 `import { cn } from "@/lib/utils"` 改为：

```typescript
import { cn } from "@workspace/ui/lib/utils"
```

保留文件其余内容原样（含 `"use client"`）。确认存在以下导出与 props（spec 已验证）：`LiveWaveform`、`active`、`processing`、`onStreamReady`、`onError`、`mode`、`barColor`、`height`。

- [ ] **Step 3: 跑格式化与类型检查**

```bash
pnpm format
pnpm typecheck
```

Expected: 通过。若 lint 因第三方源码风格报错（如 prefer-const），做最小修正。

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ai-elements/live-waveform.tsx
git commit -m "feat(ui): 拷入 ElevenLabs LiveWaveform 实时声波组件"
```

---

### Task 2: 转写模块提升为共享 + 麦克风错误文案提取

**Files:**
- Create: `apps/web/src/lib/voice/transcribe.ts`
- Create: `apps/web/src/lib/voice/mic-error.ts`
- Modify: `apps/web/src/lib/pet/transcribe-audio.ts`（改为转发引用）
- Modify: `apps/web/src/components/pet/use-pet-voice-curator.ts`（错误文案改用共享函数）

- [ ] **Step 1: 创建共享转写模块**

把 `apps/web/src/lib/pet/transcribe-audio.ts` 的**全部内容**（含 `DEFAULT_TRANSCRIPTION_URL`、`extractTranscript`）移动到新文件 `apps/web/src/lib/voice/transcribe.ts`，并把导出函数 `transcribePetAudio` 改名为 `transcribeAudio`。文件头注释改为：

```typescript
/**
 * 语音转写：上传音频到 Finch（或兼容）转写接口。
 * 聊天语音消息与宠物语音共用。
 * 直连外网地址可能受 CORS 限制，失败时请在后端做代理或配置 Finch CORS。
 */
```

- [ ] **Step 2: 宠物模块改为转发引用**

`apps/web/src/lib/pet/transcribe-audio.ts` 整个文件替换为：

```typescript
export { transcribeAudio as transcribePetAudio } from "@/lib/voice/transcribe"
```

- [ ] **Step 3: 提取麦克风错误文案**

读 `apps/web/src/components/pet/use-pet-voice-curator.ts` 第 30-57 行附近的 DOMException → 中文文案映射逻辑，提取为 `apps/web/src/lib/voice/mic-error.ts`：

```typescript
/** 把 getUserMedia / MediaRecorder 抛出的异常映射为用户可读的中文文案。 */
export function describeMicError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "麦克风权限被拒绝，请在系统设置中允许应用使用麦克风"
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "未找到麦克风设备，请连接麦克风后重试"
      case "NotReadableError":
      case "TrackStartError":
        return "麦克风被其他应用占用，请关闭后重试"
      default:
        return `麦克风不可用（${err.name}）`
    }
  }
  return err instanceof Error ? err.message : "麦克风不可用"
}
```

**注意：** 以 `use-pet-voice-curator.ts` 实际现有文案为准——若它的文案与上面不同，照抄它的（保持宠物语音行为零变化），上面代码仅为结构示意。然后把 `use-pet-voice-curator.ts` 中原映射逻辑替换为对 `describeMicError` 的调用。

- [ ] **Step 4: 全局搜索确认无残留引用**

```bash
grep -rn "transcribePetAudio" apps/web/src --include="*.ts" --include="*.tsx"
```

Expected: 只剩 `lib/pet/transcribe-audio.ts`（转发处）和 `use-pet-voice-curator.ts`（使用处）。

- [ ] **Step 5: 类型检查 + Commit**

```bash
pnpm typecheck
git add -A apps/web/src/lib/voice apps/web/src/lib/pet apps/web/src/components/pet
git commit -m "refactor(voice): 转写与麦克风错误文案提升为共享模块，宠物语音行为不变"
```

---

### Task 3: 波形峰值计算（TDD）

**Files:**
- Create: `apps/web/src/lib/voice/compute-waveform.ts`
- Test: `apps/web/src/lib/voice/compute-waveform.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, expect, it } from "vitest"
import { peaksFromChannelData, WAVEFORM_BUCKETS } from "./compute-waveform"

describe("peaksFromChannelData", () => {
  it("产出默认桶数的 0-100 整数峰值", () => {
    const data = new Float32Array(4000).map((_, i) => Math.sin(i / 10) * 0.8)
    const peaks = peaksFromChannelData(data)
    expect(peaks).toHaveLength(WAVEFORM_BUCKETS)
    for (const p of peaks) {
      expect(Number.isInteger(p)).toBe(true)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(100)
    }
  })

  it("峰值按全局最大值归一化（最大桶为 100）", () => {
    const data = new Float32Array(400)
    data[10] = 0.5
    const peaks = peaksFromChannelData(data, 4)
    expect(Math.max(...peaks)).toBe(100)
  })

  it("空数据返回空数组", () => {
    expect(peaksFromChannelData(new Float32Array(0))).toEqual([])
  })

  it("样本数少于桶数时不抛出且不超过样本数", () => {
    const data = new Float32Array(5).fill(0.5)
    const peaks = peaksFromChannelData(data, 40)
    expect(peaks.length).toBeGreaterThan(0)
    expect(peaks.length).toBeLessThanOrEqual(40)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter web test:unit -- compute-waveform
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```typescript
export const WAVEFORM_BUCKETS = 40

/** 纯函数：单声道采样 → 归一化振幅峰值（0-100 整数）。 */
export function peaksFromChannelData(
  data: Float32Array,
  buckets = WAVEFORM_BUCKETS
): number[] {
  if (data.length === 0 || buckets <= 0) return []
  const bucketSize = Math.max(1, Math.floor(data.length / buckets))
  const peaks: number[] = []
  for (let i = 0; i < buckets; i++) {
    const start = i * bucketSize
    if (start >= data.length) break
    const end = Math.min(start + bucketSize, data.length)
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j] ?? 0)
      if (v > max) max = v
    }
    peaks.push(max)
  }
  const globalMax = Math.max(...peaks)
  if (globalMax <= 0) return peaks.map(() => 0)
  return peaks.map((p) => Math.round((p / globalMax) * 100))
}

/** 解码音频 blob 并计算波形峰值；任何失败返回空数组（渲染端会退化为装饰条）。 */
export async function computeWaveform(blob: Blob): Promise<number[]> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const ctx = new AudioContext()
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      return peaksFromChannelData(audioBuffer.getChannelData(0))
    } finally {
      void ctx.close()
    }
  } catch {
    return []
  }
}
```

（`computeWaveform` 依赖浏览器 AudioContext，不写单测——纯逻辑已在 `peaksFromChannelData` 覆盖，异常路径由 try/catch 返回空数组兜底。）

- [ ] **Step 4: 运行确认通过**

```bash
pnpm --filter web test:unit -- compute-waveform
```

Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/voice/compute-waveform.ts apps/web/src/lib/voice/compute-waveform.test.ts
git commit -m "feat(voice): 波形峰值计算（发送端解码，归一化 40 桶）"
```

---

### Task 4: 后端 voice 存储与端点（TDD）

**Files:**
- Modify: `apps/server/src/schemas/resource.py`（加 `VoiceUploadResult`）
- Modify: `apps/server/src/service/resource_service.py`（加 `save_voice_file` / `resolve_voice_path`）
- Modify: `apps/server/src/api/chat_api.py`（加两个端点，放在现有 resources 端点之后）
- Test: `apps/server/tests/test_voice_resources.py`

- [ ] **Step 1: 写失败测试**

```python
from pathlib import Path

from src.schemas.resource import VoiceUploadResult
from src.service.resource_service import ResourceService


def test_save_voice_file_writes_to_voice_dir(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"webm-bytes")
    assert isinstance(result, VoiceUploadResult)
    assert result.audio_path.startswith("voice/")
    assert result.audio_path.endswith(".webm")
    saved = tmp_path / "42" / result.audio_path
    assert saved.is_file()
    assert saved.read_bytes() == b"webm-bytes"


def test_save_voice_file_rejects_empty(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"")
    assert isinstance(result, str)


def test_save_voice_file_rejects_oversize(tmp_path: Path):
    big = b"x" * (10 * 1024 * 1024 + 1)
    result = ResourceService.save_voice_file(str(tmp_path), 42, big)
    assert isinstance(result, str)


def test_resolve_voice_path_roundtrip(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"abc")
    assert isinstance(result, VoiceUploadResult)
    resolved = ResourceService.resolve_voice_path(str(tmp_path), 42, result.audio_path)
    assert resolved is not None
    assert resolved.read_bytes() == b"abc"


def test_resolve_voice_path_rejects_traversal(tmp_path: Path):
    (tmp_path / "42").mkdir(parents=True)
    (tmp_path / "secret.webm").write_bytes(b"top")
    assert (
        ResourceService.resolve_voice_path(str(tmp_path), 42, "voice/../../secret.webm")
        is None
    )


def test_resolve_voice_path_rejects_other_prefix(tmp_path: Path):
    assert ResourceService.resolve_voice_path(str(tmp_path), 42, "uploads/a.webm") is None


def test_resolve_voice_path_missing_file(tmp_path: Path):
    assert ResourceService.resolve_voice_path(str(tmp_path), 42, "voice/none.webm") is None


def test_resolve_voice_path_isolated_per_conversation(tmp_path: Path):
    result = ResourceService.save_voice_file(str(tmp_path), 42, b"abc")
    assert isinstance(result, VoiceUploadResult)
    assert ResourceService.resolve_voice_path(str(tmp_path), 43, result.audio_path) is None
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/server && uv run pytest tests/test_voice_resources.py -v
```

Expected: FAIL（`VoiceUploadResult` / `save_voice_file` 不存在）。

- [ ] **Step 3: 实现 schema 与 service**

`apps/server/src/schemas/resource.py` 追加：

```python
class VoiceUploadResult(BaseModel):
    audio_path: str
```

`apps/server/src/service/resource_service.py`：顶部 import 区加 `import uuid`、从 schemas 导入 `VoiceUploadResult`；常量区加：

```python
MAX_VOICE_FILE_SIZE = 10 * 1024 * 1024
```

`ResourceService` 类内追加两个静态方法（**物理路径直接按 conversation_id 拼接，勿用 `_resolve_conversation_dir`**——群会话它会解析到 room 共享目录，与会话删除清理路径不一致）：

```python
    @staticmethod
    def save_voice_file(
        root_path: str, conversation_id: int, file_bytes: bytes
    ) -> VoiceUploadResult | str:
        """保存语音消息音频到 <root>/<conversation_id>/voice/。

        语音目录独立于 uploads/，不进资源面板列举。
        """
        if not file_bytes:
            return "语音文件为空"
        if len(file_bytes) > MAX_VOICE_FILE_SIZE:
            return f"语音文件过大（最大 {MAX_VOICE_FILE_SIZE // (1024 * 1024)}MB）"

        voice_dir = Path(root_path) / str(conversation_id) / "voice"
        voice_dir.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}.webm"
        (voice_dir / name).write_bytes(file_bytes)
        return VoiceUploadResult(audio_path=f"voice/{name}")

    @staticmethod
    def resolve_voice_path(
        root_path: str, conversation_id: int, audio_path: str
    ) -> Path | None:
        """解析语音音频物理路径；非 voice/ 前缀或越出目录返回 None。"""
        if not audio_path.startswith("voice/"):
            return None
        conversation_dir = Path(root_path) / str(conversation_id)
        voice_dir = (conversation_dir / "voice").resolve()
        target = (conversation_dir / audio_path).resolve()
        try:
            target.relative_to(voice_dir)
        except ValueError:
            return None
        if not target.is_file():
            return None
        return target
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/server && uv run pytest tests/test_voice_resources.py -v
```

Expected: PASS（8 个用例）。

- [ ] **Step 5: 加 API 端点**

`apps/server/src/api/chat_api.py`，紧跟现有 `download_conversation_resource` 端点之后追加（import 区按需补 `FileResponse`（`fastapi.responses`）、`HTTPException`、`VoiceUploadResult`；其余 `UploadFile`/`File`/`Query`/`get_settings` 等该文件已有）：

```python
@router.post("/chat/conversations/{conversation_id}/voice/upload")
async def upload_voice_audio(
    conversation_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ResponseBase[VoiceUploadResult]:
    """上传语音消息音频，存到会话目录下 voice/ 子目录（不进资源面板）。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    file_bytes = await file.read()
    settings = get_settings()
    result = ResourceService.save_voice_file(
        settings.artifacts_path, conversation.id, file_bytes
    )
    if isinstance(result, str):
        return ResponseBase(data=None, msg=result)
    return ResponseBase(data=result)


@router.get("/chat/conversations/{conversation_id}/voice/audio")
def get_voice_audio(
    conversation_id: int,
    path: str = Query(..., description="语音相对路径，如 voice/<uuid>.webm"),
    db: Session = Depends(get_db),
):
    """返回语音消息音频文件。"""
    conversation = ChatService.get_conversation(db, conversation_id)
    settings = get_settings()
    resolved = ResourceService.resolve_voice_path(
        settings.artifacts_path, conversation.id, path
    )
    if resolved is None:
        raise HTTPException(status_code=404, detail="语音文件不存在")
    return FileResponse(resolved, media_type="audio/webm")
```

**注意：** 响应包裹风格、`ChatService.get_conversation`、`get_settings` 用法与该文件现有 `upload_conversation_resource`（约 423 行）完全一致，照它对齐。`ResponseBase` 若该文件实际命名不同（如 `BaseResponse` 泛型），以现有 resources 端点的写法为准。

- [ ] **Step 6: 全部后端测试回归 + Commit**

```bash
cd apps/server && uv run pytest tests/ -x -q
```

Expected: 全部通过（既有测试不回归）。

```bash
git add apps/server/src/schemas/resource.py apps/server/src/service/resource_service.py apps/server/src/api/chat_api.py apps/server/tests/test_voice_resources.py
git commit -m "feat(server): 语音消息音频上传/下载端点，独立 voice/ 目录防穿越"
```

---

### Task 5: 前端类型与 API 函数

**Files:**
- Modify: `apps/web/src/types/chat.ts`（加 `VoiceMessageMeta`）
- Modify: `packages/ui/src/components/ai-elements/prompt-input.tsx`（`PromptInputMessage` 加 `voice?`，约 487 行）
- Modify: `apps/web/src/api/conversation.ts`（加两个 API 函数）
- Create: `apps/web/src/lib/voice/voice-meta.ts`（类型守卫）

- [ ] **Step 1: 加类型**

`apps/web/src/types/chat.ts` 追加：

```typescript
/** 语音消息元数据，随 extra_meta.voice 持久化（snake_case，前后端一致） */
export interface VoiceMessageMeta {
  duration_ms: number
  audio_path: string
  waveform: number[]
}
```

`packages/ui/src/components/ai-elements/prompt-input.tsx` 中 `PromptInputMessage` 接口（约 487 行，实际以 `interface PromptInputMessage` 搜索定位）追加可选字段：

```typescript
  /** 语音消息载荷：录音器产出，由视图层负责上传与发送 */
  voice?: {
    durationMs: number
    waveform: number[]
    blob: Blob
  }
```

- [ ] **Step 2: 加类型守卫**

`apps/web/src/lib/voice/voice-meta.ts`：

```typescript
import type { VoiceMessageMeta } from "@/types/chat"

/** 从消息 metadata 中提取合法的语音元数据；不合法返回 null。 */
export function getVoiceMeta(
  metadata: Record<string, unknown> | undefined
): VoiceMessageMeta | null {
  const v = metadata?.voice
  if (!v || typeof v !== "object") return null
  const meta = v as Record<string, unknown>
  if (typeof meta.duration_ms !== "number") return null
  if (typeof meta.audio_path !== "string" || !meta.audio_path) return null
  return {
    duration_ms: meta.duration_ms,
    audio_path: meta.audio_path,
    waveform: Array.isArray(meta.waveform)
      ? meta.waveform.filter((n): n is number => typeof n === "number")
      : [],
  }
}
```

- [ ] **Step 3: 加 API 函数**

`apps/web/src/api/conversation.ts` 追加（参照同文件 `uploadConversationFile` 与 `downloadResource` 的既有写法）：

```typescript
export async function uploadVoiceAudio(
  conversationId: number | string,
  blob: Blob
) {
  const formData = new FormData()
  formData.append("file", blob, "recording.webm")
  return request<ApiResponse<{ audio_path: string }>>(
    `/chat/conversations/${conversationId}/voice/upload`,
    {
      method: "POST",
      body: formData,
    }
  )
}

export async function fetchVoiceAudioBlob(
  conversationId: number | string,
  path: string
): Promise<Blob> {
  const res = await request.raw(
    `/chat/conversations/${conversationId}/voice/audio`,
    { params: { path }, responseType: "blob" }
  )
  const raw = res._data
  if (raw == null) {
    throw new Error("语音文件不存在")
  }
  return raw instanceof Blob ? raw : new Blob([raw])
}
```

- [ ] **Step 4: 类型检查 + Commit**

```bash
pnpm typecheck
git add apps/web/src/types/chat.ts packages/ui/src/components/ai-elements/prompt-input.tsx apps/web/src/api/conversation.ts apps/web/src/lib/voice/voice-meta.ts
git commit -m "feat(voice): 语音元数据类型、类型守卫与上传/拉取 API"
```

---

### Task 6: 播放管理单例（TDD）

**Files:**
- Create: `apps/web/src/lib/voice/playback-manager.ts`
- Test: `apps/web/src/lib/voice/playback-manager.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { VoicePlaybackManager } from "./playback-manager"

class FakeAudio {
  static instances: FakeAudio[] = []
  src: string
  paused = true
  currentTime = 0
  duration = 10
  ontimeupdate: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(src: string) {
    this.src = src
    FakeAudio.instances.push(this)
  }
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
}

describe("VoicePlaybackManager", () => {
  let fetchBlob: ReturnType<typeof vi.fn>
  let manager: VoicePlaybackManager

  beforeEach(() => {
    FakeAudio.instances = []
    vi.stubGlobal("Audio", FakeAudio)
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    })
    fetchBlob = vi.fn(async () => new Blob(["x"]))
    manager = new VoicePlaybackManager(fetchBlob)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("toggle 开始播放并更新状态", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    expect(manager.getSnapshot().playingMessageId).toBe("m1")
    expect(FakeAudio.instances).toHaveLength(1)
  })

  it("再次 toggle 同一消息则停止", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    await manager.toggle("m1", 1, "voice/a.webm")
    expect(manager.getSnapshot().playingMessageId).toBeNull()
  })

  it("播 B 自动停 A（单实例）", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    const first = FakeAudio.instances[0]!
    await manager.toggle("m2", 1, "voice/b.webm")
    expect(first.paused).toBe(true)
    expect(manager.getSnapshot().playingMessageId).toBe("m2")
  })

  it("blob 按消息缓存，重复播放不再请求", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    await manager.toggle("m1", 1, "voice/a.webm")
    await manager.toggle("m1", 1, "voice/a.webm")
    expect(fetchBlob).toHaveBeenCalledTimes(1)
  })

  it("播放结束（onended）后状态归零", async () => {
    await manager.toggle("m1", 1, "voice/a.webm")
    FakeAudio.instances[0]!.onended?.()
    expect(manager.getSnapshot().playingMessageId).toBeNull()
  })

  it("拉取失败时抛出且状态保持空", async () => {
    fetchBlob.mockRejectedValueOnce(new Error("404"))
    await expect(manager.toggle("m1", 1, "voice/a.webm")).rejects.toThrow()
    expect(manager.getSnapshot().playingMessageId).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter web test:unit -- playback-manager
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```typescript
import { useSyncExternalStore } from "react"
import { fetchVoiceAudioBlob } from "@/api/conversation"

export interface VoicePlaybackState {
  playingMessageId: string | null
  /** 0-1 播放进度 */
  progress: number
}

type BlobFetcher = (
  conversationId: number | string,
  path: string
) => Promise<Blob>

const IDLE: VoicePlaybackState = { playingMessageId: null, progress: 0 }

/**
 * 模块级播放单例。消息列表是虚拟滚动，胶囊组件随滚动卸载，
 * 因此 HTMLAudioElement、blob 缓存与播放状态都不能放组件内。
 */
export class VoicePlaybackManager {
  private audio: HTMLAudioElement | null = null
  private objectUrl: string | null = null
  private blobCache = new Map<string, Blob>()
  private listeners = new Set<() => void>()
  private state: VoicePlaybackState = IDLE

  constructor(private fetchBlob: BlobFetcher = fetchVoiceAudioBlob) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): VoicePlaybackState => this.state

  private emit(next: VoicePlaybackState) {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** 点击胶囊：未播则播放（自动停掉其他），正在播则停止。 */
  async toggle(
    messageId: string,
    conversationId: number | string,
    audioPath: string
  ) {
    if (this.state.playingMessageId === messageId) {
      this.stop()
      return
    }
    this.stop()

    let blob = this.blobCache.get(messageId)
    if (!blob) {
      blob = await this.fetchBlob(conversationId, audioPath)
      this.blobCache.set(messageId, blob)
    }

    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    this.audio = audio
    this.objectUrl = url
    audio.ontimeupdate = () => {
      if (audio.duration > 0) {
        this.emit({
          playingMessageId: messageId,
          progress: audio.currentTime / audio.duration,
        })
      }
    }
    audio.onended = () => this.stop()
    audio.onerror = () => this.stop()
    this.emit({ playingMessageId: messageId, progress: 0 })
    await audio.play()
  }

  stop() {
    if (this.audio) {
      this.audio.pause()
      this.audio.ontimeupdate = null
      this.audio.onended = null
      this.audio.onerror = null
      this.audio = null
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    if (this.state.playingMessageId) {
      this.emit(IDLE)
    }
  }
}

export const voicePlaybackManager = new VoicePlaybackManager()

/** 胶囊组件订阅播放状态（组件卸载不影响播放）。 */
export function useVoicePlayback(): VoicePlaybackState {
  return useSyncExternalStore(
    voicePlaybackManager.subscribe,
    voicePlaybackManager.getSnapshot
  )
}
```

- [ ] **Step 4: 运行确认通过**

```bash
pnpm --filter web test:unit -- playback-manager
```

Expected: PASS（6 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/voice/playback-manager.ts apps/web/src/lib/voice/playback-manager.test.ts
git commit -m "feat(voice): 播放管理单例——单实例播放、blob 缓存、虚拟滚动免疫"
```

---

### Task 7: 录音 hook 与录音覆盖层 UI

**Files:**
- Create: `apps/web/src/components/chat-prompt-input/use-voice-recorder.ts`
- Create: `apps/web/src/components/chat-prompt-input/voice-recorder.tsx`
- Test: `apps/web/src/components/chat-prompt-input/use-voice-recorder.test.ts`

- [ ] **Step 1: 写失败测试（hook 状态机）**

测试环境需要 jsdom + fake timers，mock `MediaRecorder` 与转写/波形模块：

```typescript
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/voice/transcribe", () => ({
  transcribeAudio: vi.fn(async () => "你好世界"),
}))
vi.mock("@/lib/voice/compute-waveform", () => ({
  computeWaveform: vi.fn(async () => [10, 50, 100]),
}))

import { transcribeAudio } from "@/lib/voice/transcribe"
import { useVoiceRecorder, MAX_RECORDING_MS } from "./use-voice-recorder"

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  state = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(public stream: MediaStream) {
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["audio"]) })
    this.onstop?.()
  }
}

function fakeStream(): MediaStream {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track] } as unknown as MediaStream
}

describe("useVoiceRecorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.instances = []
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("start → attachStream 进入 recording 并计时", () => {
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult: vi.fn(), onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    expect(result.current.phase).toBe("recording")
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(3000)
  })

  it("finish：转写成功后回调 onResult 并复位", async () => {
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await act(async () => {
      await result.current.finish()
    })
    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "你好世界",
        waveform: [10, 50, 100],
        durationMs: expect.any(Number),
        blob: expect.any(Blob),
      })
    )
    expect(result.current.phase).toBe("idle")
  })

  it("短于 1 秒：onError 提示且不转写", async () => {
    const onError = vi.fn()
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    await act(async () => {
      await result.current.finish()
    })
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("太短"))
    expect(onResult).not.toHaveBeenCalled()
    expect(vi.mocked(transcribeAudio)).not.toHaveBeenCalled()
    expect(result.current.phase).toBe("idle")
  })

  it("60 秒自动 finish", async () => {
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    await act(async () => {
      vi.advanceTimersByTime(MAX_RECORDING_MS + 100)
      await vi.runOnlyPendingTimersAsync()
    })
    expect(onResult).toHaveBeenCalled()
  })

  it("cancel 丢弃数据并释放 track", () => {
    const stream = fakeStream()
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(stream))
    act(() => result.current.cancel())
    expect(result.current.phase).toBe("idle")
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
  })

  it("转写失败：onError 且不回调 onResult", async () => {
    vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error("ASR 挂了"))
    const onError = vi.fn()
    const onResult = vi.fn()
    const { result } = renderHook(() =>
      useVoiceRecorder({ onResult, onError })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(fakeStream()))
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await act(async () => {
      await result.current.finish()
    })
    expect(onError).toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
    expect(result.current.phase).toBe("idle")
  })

  it("卸载时等价取消：释放 track", () => {
    const stream = fakeStream()
    const { result, unmount } = renderHook(() =>
      useVoiceRecorder({ onResult: vi.fn(), onError: vi.fn() })
    )
    act(() => result.current.start())
    act(() => result.current.attachStream(stream))
    unmount()
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled()
  })
})
```

**前置检查：** 若 `@testing-library/react` 未安装（`grep testing-library apps/web/package.json`），先 `pnpm --filter web add -D @testing-library/react`。若 vitest 配置无 jsdom 环境支持，确认 `jsdom` 在 devDependencies，缺则一并安装。

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter web test:unit -- use-voice-recorder
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 hook**

`apps/web/src/components/chat-prompt-input/use-voice-recorder.ts`：

```typescript
import * as React from "react"
import { transcribeAudio } from "@/lib/voice/transcribe"
import { computeWaveform } from "@/lib/voice/compute-waveform"

export const MAX_RECORDING_MS = 60_000
export const MIN_RECORDING_MS = 1_000

export type RecorderPhase = "idle" | "recording" | "transcribing"

export interface VoiceRecordingResult {
  text: string
  durationMs: number
  waveform: number[]
  blob: Blob
}

interface UseVoiceRecorderOptions {
  onResult: (result: VoiceRecordingResult) => void
  onError: (message: string) => void
}

/**
 * 录音状态机：idle → recording →（finish）transcribing → idle。
 * 麦克风流由 LiveWaveform 打开并经 attachStream 共享进来（一次授权一条流）。
 * 只产出数据（转写文本/时长/波形/blob），不接触会话 ID——上传在视图层 doSend。
 */
export function useVoiceRecorder({
  onResult,
  onError,
}: UseVoiceRecorderOptions) {
  const [phase, setPhase] = React.useState<RecorderPhase>("idle")
  const [elapsedMs, setElapsedMs] = React.useState(0)

  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const startedAtRef = React.useRef(0)
  const tickerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const finishingRef = React.useRef(false)

  const releaseStream = React.useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current)
      tickerRef.current = null
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.stop()
    }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    chunksRef.current = []
  }, [])

  const cancel = React.useCallback(() => {
    releaseStream()
    finishingRef.current = false
    setPhase("idle")
    setElapsedMs(0)
  }, [releaseStream])

  const finishRef = React.useRef<() => Promise<void>>(async () => {})

  const finish = React.useCallback(async () => {
    if (finishingRef.current) return
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive") return
    finishingRef.current = true

    if (tickerRef.current) {
      clearInterval(tickerRef.current)
      tickerRef.current = null
    }
    const durationMs = Date.now() - startedAtRef.current

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }))
      }
      recorder.stop()
    })
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []

    if (durationMs < MIN_RECORDING_MS) {
      finishingRef.current = false
      setPhase("idle")
      setElapsedMs(0)
      onError("说话时间太短")
      return
    }

    setPhase("transcribing")
    try {
      const text = (await transcribeAudio(blob)).trim()
      if (!text) {
        throw new Error("未识别到语音内容")
      }
      const waveform = await computeWaveform(blob)
      onResult({ text, durationMs, waveform, blob })
    } catch (err) {
      onError(err instanceof Error ? err.message : "语音转写失败")
    } finally {
      finishingRef.current = false
      setPhase("idle")
      setElapsedMs(0)
    }
  }, [onError, onResult])
  finishRef.current = finish

  /** 用户点击麦克风：进入 recording 视觉态（LiveWaveform 随之 active 并申请麦克风） */
  const start = React.useCallback(() => {
    chunksRef.current = []
    setElapsedMs(0)
    setPhase("recording")
  }, [])

  /** LiveWaveform onStreamReady：把它打开的流接给 MediaRecorder */
  const attachStream = React.useCallback((stream: MediaStream) => {
    if (recorderRef.current) return
    streamRef.current = stream
    const recorder = new MediaRecorder(stream)
    recorderRef.current = recorder
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.start()
    startedAtRef.current = Date.now()
    tickerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current
      setElapsedMs(elapsed)
      if (elapsed >= MAX_RECORDING_MS) {
        void finishRef.current()
      }
    }, 200)
  }, [])

  React.useEffect(() => cancel, [cancel])

  return { phase, elapsedMs, start, attachStream, finish, cancel }
}
```

**实现注意：** 测试用 fake timers，`Date.now()` 受 `vi.useFakeTimers()` 控制，elapsed 计算与测试兼容。卸载清理用 `useEffect(() => cancel, [cancel])` 返回 cancel 作为 cleanup。

- [ ] **Step 4: 运行确认通过**

```bash
pnpm --filter web test:unit -- use-voice-recorder
```

Expected: PASS（7 个用例）。

- [ ] **Step 5: 实现录音覆盖层组件**

`apps/web/src/components/chat-prompt-input/voice-recorder.tsx`：

```tsx
import * as React from "react"
import { IconX } from "@tabler/icons-react"
import { LiveWaveform } from "@workspace/ui/components/ai-elements/live-waveform"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { describeMicError } from "@/lib/voice/mic-error"
import type { RecorderPhase } from "./use-voice-recorder"

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function VoiceRecorderOverlay({
  phase,
  elapsedMs,
  onStreamReady,
  onSend,
  onCancel,
  onMicError,
}: {
  phase: RecorderPhase
  elapsedMs: number
  onStreamReady: (stream: MediaStream) => void
  onSend: () => void
  onCancel: () => void
  onMicError: (message: string) => void
}) {
  const [hovering, setHovering] = React.useState(false)
  const transcribing = phase === "transcribing"

  return (
    <div className="absolute inset-0 z-10 flex items-center gap-2 rounded-[inherit] bg-background/95 px-3 backdrop-blur-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 rounded-full"
        onClick={onCancel}
        disabled={transcribing}
        aria-label="取消录音"
      >
        <IconX className="size-4" />
      </Button>
      <button
        type="button"
        className={cn(
          "relative flex h-10 flex-1 items-center justify-center overflow-hidden",
          "rounded-full bg-primary/90 px-4 transition-colors",
          hovering && !transcribing && "bg-primary"
        )}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={() => {
          if (!transcribing) onSend()
        }}
        disabled={transcribing}
        aria-label="发送语音"
      >
        <LiveWaveform
          active={phase === "recording"}
          processing={transcribing}
          mode="scrolling"
          height={28}
          barColor="rgba(255,255,255,0.9)"
          className={cn(
            "w-full transition-opacity",
            hovering && !transcribing && "opacity-20"
          )}
          onStreamReady={onStreamReady}
          onError={(err) => onMicError(describeMicError(err))}
        />
        {hovering && !transcribing && (
          <span className="absolute text-sm font-medium text-primary-foreground">
            发送
          </span>
        )}
        {transcribing && (
          <span className="absolute text-sm text-primary-foreground/90">
            转写中…
          </span>
        )}
      </button>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatElapsed(elapsedMs)}
      </span>
    </div>
  )
}
```

**实现注意：** 图标库以项目实际为准——`grep -rn "@tabler/icons-react\|lucide-react" apps/web/src/components/chat-prompt-input/` 看现有用法，跟随之（`chat-message-item.tsx` 用了 `IconClipboardList`，大概率 tabler）。麦克风图标同理（`IconMicrophone`）。

- [ ] **Step 6: 类型检查 + Commit**

```bash
pnpm typecheck
git add apps/web/src/components/chat-prompt-input/use-voice-recorder.ts apps/web/src/components/chat-prompt-input/use-voice-recorder.test.ts apps/web/src/components/chat-prompt-input/voice-recorder.tsx
git commit -m "feat(voice): 录音状态机 hook 与微信式录音覆盖层"
```

---

### Task 8: 麦克风按钮接入输入框

**Files:**
- Modify: `apps/web/src/components/chat-prompt-input/chat-prompt-input.tsx`
- Modify: `apps/web/src/components/chat-prompt-input/types.ts`（`showVoiceInput` prop）
- Modify: `apps/web/src/components/chat/panel/chat-composer-area.tsx`（透传）
- Modify: `apps/web/src/components/chat/panel/chat-panel.tsx`（群聊隐藏）

- [ ] **Step 1: ChatPromptInput 接入录音**

`chat-prompt-input.tsx` 改动要点（保持现有结构，最小侵入）：

1. props 加 `showVoiceInput?: boolean`（`types.ts` 的 `ChatPromptInputProps` 同步加，默认 `false`）
2. 组件内使用 hook 与覆盖层：

```tsx
import { toast } from "sonner"
import { IconMicrophone } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { useVoiceRecorder } from "./use-voice-recorder"
import { VoiceRecorderOverlay } from "./voice-recorder"

// 组件函数体内：
const recorder = useVoiceRecorder({
  onResult: (result) => {
    onSubmit({
      text: result.text,
      files: [],
      voice: {
        durationMs: result.durationMs,
        waveform: result.waveform,
        blob: result.blob,
      },
    })
  },
  onError: (message) => toast.error(message),
})
```

**注意 `onSubmit` 的实际签名**：看 `ChatPromptInputProps["onSubmit"]` 与 `PromptInput` 组件的提交回调——若它是 `(message: PromptInputMessage, event?) => void`，按上面直接调；若经表单事件包装，找到 ChatPromptInput 拿到的 onSubmit prop 直接调用即可（绕过表单）。

3. `PromptInput` 根元素需要 `relative` 定位容器：在现有 `className` 合并处加 `"relative"`。
4. 渲染覆盖层（放在 `PromptInputBody` 之后、同级）：

```tsx
{recorder.phase !== "idle" && (
  <VoiceRecorderOverlay
    phase={recorder.phase}
    elapsedMs={recorder.elapsedMs}
    onStreamReady={recorder.attachStream}
    onSend={() => void recorder.finish()}
    onCancel={recorder.cancel}
    onMicError={(message) => {
      toast.error(message)
      recorder.cancel()
    }}
  />
)}
```

5. 麦克风按钮放 footer 右侧 `PromptInputTools` 内、`PromptInputSubmit` 之前：

```tsx
{showVoiceInput && (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="rounded-full"
    disabled={disabled || status === "streaming" || status === "submitted"}
    onClick={recorder.start}
    aria-label="语音输入"
  >
    <IconMicrophone className="size-4" />
  </Button>
)}
```

- [ ] **Step 2: 透传链**

`chat-composer-area.tsx`：props 加 `showVoiceInput?: boolean`，原样传给 `<ChatPromptInput showVoiceInput={showVoiceInput} />`。

`chat-panel.tsx`：找到渲染 `<ChatComposerArea>`（约 393 行 `onSend={handleComposerSend}` 附近），加：

```tsx
showVoiceInput={contact?.type !== "group"}
```

（仿同文件 `showContextBudget={contact?.type !== "group"}` 先例；若该先例不存在则确认 `contact` 在作用域内可用。）

- [ ] **Step 3: 手动冒烟**

```bash
pnpm dev
```

浏览器打开（默认 3399），进入单聊会话：麦克风按钮可见 → 点击出现录音覆盖层（浏览器会请求麦克风权限）→ 声波动、计时走 → ✕ 取消恢复。群聊会话不显示麦克风。

- [ ] **Step 4: 类型检查 + Commit**

```bash
pnpm typecheck
git add apps/web/src/components/chat-prompt-input apps/web/src/components/chat/panel
git commit -m "feat(voice): 输入框麦克风按钮与录音覆盖层接入，群聊隐藏"
```

---

### Task 9: 发送链路集成（两个视图 + prepareVoiceMeta）

**Files:**
- Create: `apps/web/src/lib/voice/prepare-voice-meta.ts`
- Modify: `apps/web/src/components/chat/views/chat-conversation-view.tsx`
- Modify: `apps/web/src/components/chat/views/chat-draft-view.tsx`

- [ ] **Step 1: prepareVoiceMeta**

```typescript
import { uploadVoiceAudio } from "@/api/conversation"
import type { VoiceMessageMeta } from "@/types/chat"

export interface VoiceDraft {
  durationMs: number
  waveform: number[]
  blob: Blob
}

/** 上传语音音频并组装 extra_meta.voice；上传失败抛错（调用方 toast 并终止发送）。 */
export async function prepareVoiceMeta(
  conversationId: number | string,
  voice: VoiceDraft
): Promise<VoiceMessageMeta> {
  const res = await uploadVoiceAudio(conversationId, voice.blob)
  const audioPath = res.data?.audio_path
  if (!audioPath) {
    throw new Error(res.msg || "语音上传失败")
  }
  return {
    duration_ms: voice.durationMs,
    audio_path: audioPath,
    waveform: voice.waveform,
  }
}
```

**注意：** `ApiResponse` 的字段形状（`data`/`msg`）以 `apps/web/src/api/types.ts` 实际定义为准。

- [ ] **Step 2: chat-conversation-view 集成**

两处改动：

**(a) `handleSend`（约 590-625 行）**——语音消息绕过 pending 队列。在 `if (isBusy)` 入队分支前加：

```typescript
const voicePayload =
  typeof message === "string" ? undefined : message.voice

if (isBusy && !voicePayload) {
  // …原有 enqueue 逻辑不动…
}
```

即仅当**非语音**消息才入队；语音消息落到后面的 `await doSend(message)`。

**(b) `doSend`（约 507-559 行）**——上传音频并透传元数据。在组装 `pendingMeta` 之前加：

```typescript
const voicePayload =
  typeof message === "string" ? undefined : message.voice

let voiceMeta: VoiceMessageMeta | undefined
if (voicePayload && conversationId != null) {
  try {
    voiceMeta = await prepareVoiceMeta(conversationId, voicePayload)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "语音上传失败")
    return
  }
}
```

`pendingMeta` 对象加一行：

```typescript
voice: voiceMeta,
```

（`pendingMeta` 同时进 `sendMessage` 的乐观 metadata 与请求 body 的 `extra_meta`，胶囊乐观渲染随之生效——此时 `audio_path` 已有效，可立即播放。）

- [ ] **Step 3: chat-draft-view 集成**

`doSend`（约 197-301 行）：在会话创建（约 214-228 行）与 `uploadDraftFiles`（约 230-233 行）之后、组装 metadata 之前，加与上面 (b) 完全相同的 `prepareVoiceMeta` 块（此处 `conversationId` 必已就绪）。metadata 对象同样加 `voice: voiceMeta`。

draft 视图同样检查其 busy 入队分支（约 325 行 `enqueue`）：语音消息绕过，处理方式同 (a)。

- [ ] **Step 4: 手动验证发送链路**

`pnpm dev` + `pnpm dev:server`，单聊会话录一段 ≥1 秒的话 → 停止 → 应看到：转写中动画 → 消息以文本形式出现在列表（胶囊在 Task 10 才有）→ 网络面板确认 `voice/upload` 成功、stream 请求体 `extra_meta.voice` 三字段齐全。再验证草稿视图（新会话首条语音消息）。

- [ ] **Step 5: 类型检查 + Commit**

```bash
pnpm typecheck
git add apps/web/src/lib/voice/prepare-voice-meta.ts apps/web/src/components/chat/views
git commit -m "feat(voice): 发送链路集成——视图层上传音频、extra_meta.voice 透传、绕过 pending 队列"
```

---

### Task 10: 语音胶囊组件与消息列表集成

**Files:**
- Create: `apps/web/src/components/chat/messages/voice-message-capsule.tsx`
- Modify: `apps/web/src/components/chat/messages/chat-message-item.tsx`

- [ ] **Step 1: 实现胶囊组件**

```tsx
import * as React from "react"
import {
  IconCopy,
  IconFileText,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react"
import { toast } from "sonner"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { cn } from "@workspace/ui/lib/utils"
import {
  useVoicePlayback,
  voicePlaybackManager,
} from "@/lib/voice/playback-manager"
import type { VoiceMessageMeta } from "@/types/chat"

const FALLBACK_BARS = Array.from({ length: 24 }, (_, i) =>
  Math.round(40 + 35 * Math.sin(i / 2.2))
)

function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/** 时长 → 胶囊宽度（px），微信风格设上下限 */
function capsuleWidth(ms: number): number {
  const seconds = Math.min(60, Math.max(1, ms / 1000))
  return Math.round(140 + (seconds / 60) * 140)
}

export function VoiceMessageCapsule({
  messageId,
  conversationId,
  meta,
  transcript,
}: {
  messageId: string
  conversationId: number | string
  meta: VoiceMessageMeta
  transcript: string
}) {
  const playback = useVoicePlayback()
  const [showTranscript, setShowTranscript] = React.useState(false)
  const playing = playback.playingMessageId === messageId
  const bars = meta.waveform.length > 0 ? meta.waveform : FALLBACK_BARS

  const handleToggle = React.useCallback(() => {
    voicePlaybackManager
      .toggle(messageId, conversationId, meta.audio_path)
      .catch(() => toast.error("语音文件不存在"))
  }, [messageId, conversationId, meta.audio_path])

  const handleCopy = React.useCallback(() => {
    navigator.clipboard
      .writeText(transcript)
      .then(() => toast.success("已复制"))
      .catch(() => toast.error("复制失败"))
  }, [transcript])

  return (
    <div className="flex flex-col items-end gap-1">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={handleToggle}
            style={{ width: capsuleWidth(meta.duration_ms) }}
            className={cn(
              "flex h-10 items-center gap-2 rounded-2xl px-3",
              "bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
            )}
            aria-label={playing ? "暂停语音" : "播放语音"}
          >
            {playing ? (
              <IconPlayerPauseFilled className="size-4 shrink-0" />
            ) : (
              <IconPlayerPlayFilled className="size-4 shrink-0" />
            )}
            <span className="flex h-5 flex-1 items-center gap-px overflow-hidden">
              {bars.map((value, i) => {
                const played = playing && i / bars.length <= playback.progress
                return (
                  <span
                    key={i}
                    style={{ height: `${Math.max(15, value)}%` }}
                    className={cn(
                      "w-[3px] shrink-0 rounded-full",
                      played
                        ? "bg-primary-foreground"
                        : "bg-primary-foreground/45"
                    )}
                  />
                )
              })}
            </span>
            <span className="shrink-0 text-xs tabular-nums">
              {formatDuration(meta.duration_ms)}
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setShowTranscript((v) => !v)}>
            <IconFileText className="size-4" />
            {showTranscript ? "收起文本" : "查看文本"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopy}>
            <IconCopy className="size-4" />
            复制文本
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {showTranscript && (
        <div className="max-w-xs rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          {transcript}
        </div>
      )}
    </div>
  )
}
```

**实现注意：** ContextMenu 子组件用法（图标/间距）以 `packages/ui/src/components/context-menu.tsx` 及现有使用方（如 `contact-item.tsx`）为准。

- [ ] **Step 2: chat-message-item 集成**

`chat-message-item.tsx` 用户消息渲染处（`<MessageContent className="w-auto">{messageBody}</MessageContent>`，约 290 行）：

1. import `getVoiceMeta`、`VoiceMessageCapsule`、会话 id 来源（该文件若无 conversationId prop，用 `useChatStore` 的 `selectedConversationId`——`grep -n "useChatStore" apps/web/src/components/chat` 找现有用法跟随）。
2. 组件体内（hooks 区）：

```typescript
const voiceMeta =
  message.role === "user"
    ? getVoiceMeta(
        (message as { metadata?: Record<string, unknown> }).metadata
      )
    : null
```

3. 渲染处改为：

```tsx
{voiceMeta && selectedConversationId != null ? (
  <VoiceMessageCapsule
    messageId={message.id}
    conversationId={selectedConversationId}
    meta={voiceMeta}
    transcript={copyText}
  />
) : (
  <MessageContent className="w-auto">{messageBody}</MessageContent>
)}
```

**注意：** `copyText` 是该组件已有的纯文本提取变量（底部 `MessageCopyAction text={copyText}` 在用），直接复用作转写文本。`React.memo` 包裹不受影响——播放状态经 `useVoicePlayback` 订阅，不走 props。

- [ ] **Step 3: 手动验证**

`pnpm dev` + 后端：发一条语音 → 列表出现胶囊（真实波形、时长）→ 点击播放、进度高亮、再点暂停 → 播 A 时点 B，A 停 B 播 → 右键查看文本/复制文本 → 刷新页面胶囊仍在且可播放 → 播放中滚动列表使胶囊滚出视口，声音不断，滚回来状态正确。

- [ ] **Step 4: 类型检查 + Commit**

```bash
pnpm typecheck
git add apps/web/src/components/chat/messages
git commit -m "feat(voice): 微信式语音胶囊——真实波形、播放进度、右键看文本"
```

---

### Task 11: 全量回归与收尾

- [ ] **Step 1: 全量检查**

```bash
pnpm typecheck
pnpm lint
pnpm --filter web test:unit
cd apps/server && uv run pytest tests/ -q
```

Expected: 全部通过。lint 若对拷入的 live-waveform.tsx 报风格问题，做最小修正。

- [ ] **Step 2: 完整手动验证清单（按 spec）**

启动 `pnpm dev` + `pnpm dev:server`，逐项验证：

1. 单聊录音 → 胶囊展示（真实波形）
2. 点击播放（进度高亮）、暂停、播 B 停 A
3. 播放中滚动消息列表使胶囊滚出视口：播放不中断、滚回后状态正确
4. 右键查看/复制文本
5. 刷新页面后胶囊仍在且可播放
6. 取消录音（✕）恢复输入框
7. 录音中切换会话：麦克风释放（系统麦克风指示灯灭）
8. 录音 <1 秒：提示「说话时间太短」
9. 转写失败路径（改 `VITE_FINCH_TRANSCRIPTION_URL` 指向无效地址）：toast 报错、不发消息、后端无孤儿文件
10. 草稿视图首条语音消息：建会话 → 上传 → 发送全链路
11. 群聊会话：无麦克风按钮
12. 宠物语音功能不回归（仍可录音转写发送）
13. 资源面板不出现 voice 文件

- [ ] **Step 3: 最终提交**

若有零散修正，提交：

```bash
git add -A && git commit -m "fix(voice): 手动验证修正"
```
