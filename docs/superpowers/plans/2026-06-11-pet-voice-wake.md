# 宠物离线语音唤醒 + 可配转写 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 宠物常驻检测本地唤醒词「你好博般」→ 播预录反馈「我在，有什么可以为你效劳」→ 免手录音→转写→发总管；转写后端运行时可配以适配离线一体机。

**Architecture:** sherpa-onnx KWS+VAD 以 WASM 跑在宠物渲染进程，独占一条共享麦克风流（录音复用同流）；模型字节经新 `wakemodel://` 协议（复刻 `petdex://`）跨界投递、写入 wasm MEMFS；转写地址改为运行时配置（electron-store + IPC）。

**Tech Stack:** Electron + React 19 + TypeScript；sherpa-onnx wasm（KWS / silero-VAD）；AudioWorklet；electron-store；vitest。

**Spec:** `docs/superpowers/specs/2026-06-11-pet-voice-wake-design.md`

---

## 文件结构（创建/修改总览）

**Phase 1 — B 转写运行时可配**
- 修改 `apps/web/electron/shared/ipc-channels.ts`（加 `getTranscriptionConfig` 通道 + 类型）
- 修改 `apps/web/electron/features/settings/settings-store.ts`（5 个新字段 + 2 处默认 + getter/setter）
- 修改 `apps/web/electron/features/settings/ipc.ts`（注册 handler）
- 修改 `apps/web/electron/features/settings/preload-bridge.ts`（暴露 bridge 方法）
- 修改 `apps/web/src/lib/pet/transcribe-audio.ts`（运行时配置 + 回退）
- 测试 `apps/web/src/lib/pet/transcribe-audio.test.ts`

**Phase 2 — A-PoC：资产与字节投递（file:// 打通）**
- 新增 `apps/web/public/wake/`（wasm 胶水 + worklet + 默认 feedback.mp3，PoC 期占位）
- 新增 `apps/web/electron/features/pet/wake-model.ts`（解析模型目录 + present 校验）
- 新增 `apps/web/electron/core/wakemodel-protocol.ts`（`wakemodel://` handler，复刻 petdex）
- 修改 `apps/web/electron/features/pet/pet-window.ts`（在 pet session 注册协议）
- 新增 `apps/web/src/lib/pet/wake/sherpa-kws.ts`（wasm 加载 + MEMFS 载模型，PoC 命中即 log）

**Phase 3 — A 核心**
- 修改 `apps/web/src/components/pet/use-pet-voice-curator.ts`（`startRecording({stream})` 注入流改造）
- 新增 `apps/web/src/lib/pet/wake/resolve-wake-model.ts` + IPC `wake:resolve-model`
- 新增 `apps/web/src/lib/pet/wake/pcm-worklet.ts`（AudioWorklet 处理器）
- 新增 `apps/web/src/lib/pet/wake/use-wake-word.ts`（状态机：capture 门控 / 反馈 / VAD 端点）
- 修改 `apps/web/src/components/pet/PetWindow.tsx`（接入）

**Phase 4 — 反馈片段 + 设置 UI + 打包**
- 反馈片段播放并入 `use-wake-word.ts`
- 设置页（宠物/语音分区）加唤醒开关、模型目录、转写地址/密钥/语言
- `apps/web/electron-builder.json5` 确认 `public/wake` 随 dist（默认随 Vite，无需改 extraResources）

**Phase 5 — 测试与调参**（手动 + 阈值）

---

## Phase 0：测试运行器（两套，勿混用）

> 现状（已确认）：`apps/web/package.json` 已装 `vitest`。两个脚本职责不同：
> - **`test:unit` = vitest**（渲染/`src/**` 用，jsdom）：`pnpm --filter web test:unit <pattern>`
> - **`test` = Node 测试器**（`node --import tsx --test electron/**/*.test.ts`，electron 主进程用）：`pnpm --filter web test`
>
> 规则：**`src/**` 下的测试用 vitest 语法（`from "vitest"`）经 `test:unit` 跑；`electron/**` 下的测试用 `node:test` 语法（`import { test } from "node:test"; import assert from "node:assert"`）经 `test` 跑。** 切勿在 `electron/**` 放 vitest 语法文件（会被 Node 测试器误抓而报错）。

### Task 0: 确认两套运行器

**Files:** 只读 `apps/web/package.json`；若缺 `vitest.config.ts` 则新增

- [ ] **Step 1:** 确认脚本：`cd apps/web && cat package.json | grep -E "\"test\"|test:unit|vitest"`，应见 `test` 与 `test:unit`。
- [ ] **Step 2:** 若无 `apps/web/vitest.config.ts`：新增（`test: { environment: "happy-dom", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] }`）。仓库已装 `happy-dom` 与 `@testing-library/react`，**不要**再装 jsdom（避免双 DOM 环境）。
- [ ] **Step 3:** 冒烟：建 `apps/web/src/__smoke__/sanity.test.ts`（`import {it,expect} from "vitest"; it("ok",()=>expect(1+1).toBe(2))`）。
  Run: `pnpm --filter web test:unit sanity`，Expected: 1 passed
- [ ] **Step 4:** Commit
  ```bash
  git add apps/web/package.json apps/web/vitest.config.ts apps/web/src/__smoke__/sanity.test.ts
  git commit -m "chore(web): 确认 vitest(test:unit)/node(test) 两套运行器"
  ```

---

## Phase 1：B — 转写后端运行时可配

> 先落，独立可验，点击说话立即受益。

### Task 1: 设置存储增 5 字段

**Files:** Modify `apps/web/electron/features/settings/settings-store.ts`

- [ ] **Step 1:** `SettingsData` 接口加：
  ```ts
  voiceWakeEnabled: boolean
  wakeModelDir: string
  transcriptionUrl: string
  transcriptionKey: string
  transcriptionLanguage: string
  ```
- [ ] **Step 2:** 在 `initSettingsStore` 的 `defaults` **和** `getSetting` 内的 fallback `defaults`（**两处**）都加：
  ```ts
  voiceWakeEnabled: true,
  wakeModelDir: "",
  transcriptionUrl: "",
  transcriptionKey: "",
  transcriptionLanguage: "",
  ```
- [ ] **Step 3:** 文件末加聚合 getter/setter：
  ```ts
  export function getTranscriptionConfig(): {
    url: string; key: string; language: string
  } {
    return {
      url: store?.get("transcriptionUrl") ?? "",
      key: store?.get("transcriptionKey") ?? "",
      language: store?.get("transcriptionLanguage") ?? "",
    }
  }
  export function getWakeSettings(): {
    voiceWakeEnabled: boolean; wakeModelDir: string
    transcriptionUrl: string; transcriptionKey: string; transcriptionLanguage: string
  } {
    return {
      voiceWakeEnabled: store?.get("voiceWakeEnabled") ?? true,
      wakeModelDir: store?.get("wakeModelDir") ?? "",
      transcriptionUrl: store?.get("transcriptionUrl") ?? "",
      transcriptionKey: store?.get("transcriptionKey") ?? "",
      transcriptionLanguage: store?.get("transcriptionLanguage") ?? "",
    }
  }
  export function setWakeSettings(
    partial: Partial<{
      voiceWakeEnabled: boolean; wakeModelDir: string
      transcriptionUrl: string; transcriptionKey: string; transcriptionLanguage: string
    }>,
  ): void {
    for (const [k, v] of Object.entries(partial)) {
      if (v !== undefined) store?.set(k as keyof SettingsData, v as never)
    }
  }
  ```
- [ ] **Step 4:** typecheck
  Run: `pnpm --filter web typecheck`，Expected: 通过
- [ ] **Step 5:** Commit
  ```bash
  git add apps/web/electron/features/settings/settings-store.ts
  git commit -m "feat(settings): 增唤醒/转写运行时配置字段"
  ```

### Task 2: IPC 通道与类型

**Files:** Modify `apps/web/electron/shared/ipc-channels.ts`

- [ ] **Step 1:** `IpcChannels` 加：
  ```ts
  getTranscriptionConfig: "get-transcription-config",
  wakeGetSettings: "wake:get-settings",
  wakeSetSettings: "wake:set-settings",
  wakeResolveModel: "wake:resolve-model",
  ```
- [ ] **Step 2:** 加接口与 `IpcInvokeMap` 条目：
  ```ts
  export interface TranscriptionConfig { url: string; key: string; language: string }
  export interface WakeSettings {
    voiceWakeEnabled: boolean; wakeModelDir: string
    transcriptionUrl: string; transcriptionKey: string; transcriptionLanguage: string
  }
  export interface WakeModelStatus { present: boolean; urlBase: string }
  ```
  ```ts
  [IpcChannels.getTranscriptionConfig]: { args: []; result: TranscriptionConfig }
  [IpcChannels.wakeGetSettings]: { args: []; result: WakeSettings }
  [IpcChannels.wakeSetSettings]: { args: [partial: Partial<WakeSettings>]; result: void }
  [IpcChannels.wakeResolveModel]: { args: []; result: WakeModelStatus }
  ```
- [ ] **Step 2b:** typecheck → Commit
  ```bash
  git add apps/web/electron/shared/ipc-channels.ts
  git commit -m "feat(ipc): 唤醒/转写配置通道与类型"
  ```

### Task 3: 注册 handler + 暴露 bridge

**Files:** Modify `apps/web/electron/features/settings/ipc.ts`、`apps/web/electron/features/settings/preload-bridge.ts`

- [ ] **Step 1:** `ipc.ts` 是 `IpcContribution`——其 `register(ctx)` **返回 `{ channel, handler }` 对象数组**（无 `handle()` 辅助）。往该数组**追加**：
  ```ts
  // import { getTranscriptionConfig, getWakeSettings, setWakeSettings } from "./settings-store"
  { channel: IpcChannels.getTranscriptionConfig, handler: () => getTranscriptionConfig() },
  { channel: IpcChannels.wakeGetSettings, handler: () => getWakeSettings() },
  { channel: IpcChannels.wakeSetSettings, handler: (_e, partial) => setWakeSettings(partial) },
  ```
  > `wake:resolve-model` 的 handler 在 Task 5 加（依赖 wake-model.ts）。
- [ ] **Step 2:** `preload-bridge.ts` 按现有 `invoke` 风格暴露（**含 `resolveWakeModel`，名称就此钉定**；其 handler 后于 Task 5 注册，调用前不会触发）：
  ```ts
  getTranscriptionConfig: () => invoke(IpcChannels.getTranscriptionConfig),
  getWakeSettings: () => invoke(IpcChannels.wakeGetSettings),
  setWakeSettings: (p) => invoke(IpcChannels.wakeSetSettings, p),
  resolveWakeModel: () => invoke(IpcChannels.wakeResolveModel),
  ```
- [ ] **Step 3:** typecheck → Commit
  ```bash
  git add apps/web/electron/features/settings/ipc.ts apps/web/electron/features/settings/preload-bridge.ts
  git commit -m "feat(settings): 暴露转写/唤醒配置 IPC"
  ```

### Task 4: transcribe-audio 运行时配置（TDD）

**Files:** Modify `apps/web/src/lib/pet/transcribe-audio.ts`；Test `apps/web/src/lib/pet/transcribe-audio.test.ts`

- [ ] **Step 1: 写失败测试**（运行时配置优先于 env/默认；缺配置回退）
  ```ts
  import { describe, it, expect, vi, beforeEach } from "vitest"
  import { resolveTranscriptionEndpoint } from "./transcribe-audio"

  describe("resolveTranscriptionEndpoint", () => {
    beforeEach(() => { vi.unstubAllGlobals() })
    it("运行时配置优先", async () => {
      vi.stubGlobal("window", {
        electronApi: { getTranscriptionConfig: async () => ({ url: "http://local/stt", key: "k", language: "en" }) },
      })
      expect(await resolveTranscriptionEndpoint()).toEqual({ url: "http://local/stt", key: "k", language: "en" })
    })
    it("无运行时配置时回退默认 url + zh", async () => {
      vi.stubGlobal("window", { electronApi: { getTranscriptionConfig: async () => ({ url: "", key: "", language: "" }) } })
      const r = await resolveTranscriptionEndpoint()
      expect(r.url).toContain("/v1/audio/transcriptions")
      expect(r.language).toBe("zh")
    })
    it("无 electronApi 不抛错", async () => {
      vi.stubGlobal("window", {})
      const r = await resolveTranscriptionEndpoint()
      expect(r.url).toBeTruthy()
    })
  })
  ```
- [ ] **Step 2: 跑测试确认失败**
  Run: `pnpm --filter web test:unit transcribe-audio`，Expected: FAIL（`resolveTranscriptionEndpoint` 未导出）
- [ ] **Step 3: 实现**（抽出可测函数，`transcribePetAudio` 调它）
  ```ts
  export async function resolveTranscriptionEndpoint(): Promise<{
    url: string; key: string; language: string
  }> {
    let rt = { url: "", key: "", language: "" }
    try {
      const api = (globalThis as any).window?.electronApi
      if (api?.getTranscriptionConfig) rt = await api.getTranscriptionConfig()
    } catch { /* 忽略，走回退 */ }
    const envUrl = (import.meta.env.VITE_FINCH_TRANSCRIPTION_URL as string | undefined)?.trim()
    const envKey = (import.meta.env.VITE_FINCH_TRANSCRIPTION_KEY as string | undefined)?.trim()
    const envLang = (import.meta.env.VITE_FINCH_TRANSCRIPTION_LANGUAGE as string | undefined)?.trim()
    return {
      url: rt.url?.trim() || envUrl || DEFAULT_TRANSCRIPTION_URL,
      key: rt.key?.trim() || envKey || "",
      language: rt.language?.trim() || envLang || "zh",
    }
  }
  ```
  并改 `transcribePetAudio`：开头 `const { url, key, language } = await resolveTranscriptionEndpoint()`，用 `url/key/language` 替换原 env 读取。
- [ ] **Step 4: 跑测试确认通过**
  Run: `pnpm --filter web test:unit transcribe-audio`，Expected: 3 passed
- [ ] **Step 5: Commit**
  ```bash
  git add apps/web/src/lib/pet/transcribe-audio.ts apps/web/src/lib/pet/transcribe-audio.test.ts
  git commit -m "feat(pet-voice): 转写后端运行时可配（设置>env>默认）"
  ```

---

## Phase 2：A-PoC — file:// 资产与 `wakemodel://` 字节投递

> 把"最大未知"前置打通：dev + 生产 `file://` 双环境验证 wasm/worklet 加载与模型字节注入 MEMFS。此阶段先"命中即 log"，不接录音。

### Task 5: `wakemodel://` 协议 + 模型解析（复刻 petdex）

**Files:** 新增 `apps/web/electron/features/pet/wake-model.ts`、`apps/web/electron/core/wakemodel-protocol.ts`；Modify `pet-window.ts`、settings `ipc.ts`；Test `apps/web/electron/features/pet/wake-model.test.ts`

- [ ] **Step 1: 写失败测试**（`electron/**` → **node:test 语法**，不是 vitest）
  ```ts
  import { test } from "node:test"
  import assert from "node:assert"
  import fs from "node:fs"; import os from "node:os"; import path from "node:path"
  import { isWakeModelPresent } from "./wake-model"

  const REQUIRED = ["encoder.onnx","decoder.onnx","joiner.onnx","tokens.txt","keywords.txt","silero_vad.onnx"]
  function mkModel(complete: boolean) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "wake-"))
    const files = complete ? REQUIRED : REQUIRED.slice(0, 3)
    for (const f of files) fs.writeFileSync(path.join(d, f), "x")
    return d
  }
  test("齐全→true", () => assert.equal(isWakeModelPresent(mkModel(true)), true))
  test("缺文件→false", () => assert.equal(isWakeModelPresent(mkModel(false)), false))
  test("空路径→false", () => assert.equal(isWakeModelPresent(""), false))
  ```
- [ ] **Step 2: 跑测试确认失败**
  Run: `pnpm --filter web test`，Expected: FAIL（`isWakeModelPresent` 未导出）
- [ ] **Step 3: 实现 `wake-model.ts`**
  ```ts
  import path from "node:path"; import fs from "node:fs"; import os from "node:os"
  import { getWakeSettings } from "../settings/settings-store"

  export const WAKE_REQUIRED_FILES = [
    "encoder.onnx","decoder.onnx","joiner.onnx","tokens.txt","keywords.txt","silero_vad.onnx",
  ]
  export function resolveWakeModelDir(): string {
    const env = process.env.WAKEWORD_MODEL_DIR?.trim()
    if (env) return env
    const setting = getWakeSettings().wakeModelDir?.trim()
    if (setting) return setting
    return path.join(os.homedir(), ".digital-employee", "models", "wake")
  }
  export function isWakeModelPresent(dir: string): boolean {
    if (!dir) return false
    try { return WAKE_REQUIRED_FILES.every((f) => fs.existsSync(path.join(dir, f))) }
    catch { return false }
  }
  // feedback.wav 可选（不计入 present）
  export function wakeModelFilePath(name: string): string | null {
    const dir = resolveWakeModelDir()
    const safe = path.normalize(name).replace(/^(\.\.([/\\]|$))+/, "")
    const full = path.join(dir, safe)
    if (!full.startsWith(path.resolve(dir))) return null // 防穿越
    return fs.existsSync(full) ? full : null
  }
  ```
- [ ] **Step 4:** 实现 `wakemodel-protocol.ts`（复刻 `petdex-protocol.ts` 结构）
  ```ts
  import path from "node:path"; import fs from "node:fs"
  import type { Protocol } from "electron"
  import { wakeModelFilePath } from "../features/pet/wake-model"
  const MIME: Record<string,string> = {
    ".onnx":"application/octet-stream",".txt":"text/plain",
    ".wav":"audio/wav",".mp3":"audio/mpeg",".bin":"application/octet-stream",
  }
  // 约定 URL：wakemodel://m/<file>（复刻 petdex 的 pathname 解析；host 固定占位 m）
  export function handleWakeModelRequest(request: Request): Response {
    try {
      const url = new URL(request.url)
      const requestedPath = decodeURIComponent(url.pathname).replace(/^\//, "")
      const full = wakeModelFilePath(requestedPath)
      if (!full) return new Response("Not Found", { status: 404 })
      const data = fs.readFileSync(full)
      return new Response(data, { headers: {
        "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      } })
    } catch { return new Response("Not Found", { status: 404 }) }
  }
  export function registerWakeModelOnProtocol(p: Protocol): void {
    p.handle("wakemodel", handleWakeModelRequest)
  }
  ```
- [ ] **Step 5a（特权 scheme，缺了会 fetch 失败）:** `apps/web/electron/main/index.ts` 的 `protocol.registerSchemesAsPrivileged([...])` 数组（petdex 所在，约 line 52）追加：
  ```ts
  { scheme: "wakemodel", privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true, standard: true } },
  ```
- [ ] **Step 5b（注册 handler，两处，与 petdex 对齐）:**
  - 全局：`bootstrap.ts`（petdex 用 `registerPetdexOnProtocol(protocol)` 处，约 line 46）加 `registerWakeModelOnProtocol(protocol)`。
  - pet 分区 session：`pet-window.ts`（约 line 31，petdex 用 **inline** `petSession.protocol.handle("petdex", handlePetdexRequest)`）紧随其后 inline `petSession.protocol.handle("wakemodel", handleWakeModelRequest)`（与相邻 petdex 行风格一致，import `handleWakeModelRequest`）。
- [ ] **Step 6:** settings `ipc.ts`：往 `IpcContribution` 数组追加 `wake:resolve-model` handler（bridge 已在 Task 3 暴露）：
  ```ts
  // import { resolveWakeModelDir, isWakeModelPresent } from "../pet/wake-model"
  { channel: IpcChannels.wakeResolveModel, handler: () => ({
    present: isWakeModelPresent(resolveWakeModelDir()),
    urlBase: "wakemodel://m/",
  }) },
  ```
- [ ] **Step 7:** 跑测试通过 + typecheck
  Run: `pnpm --filter web test && pnpm --filter web typecheck`，Expected: 3 passed + 通过
- [ ] **Step 8: Commit**
  ```bash
  git add apps/web/electron
  git commit -m "feat(wake): wakemodel:// 协议 + 模型解析/present 校验"
  ```

### Task 6: PoC — wasm KWS 加载 + MEMFS 载模型（集成，命中即 log）

> ⚠️ sherpa-onnx wasm 的精确 API（`createKeywordSpotter`/`acceptWaveform`/`isReady`/`decode`/`getResult`、`createVad`）以官方 wasm-kws 示例为准，在本任务**PoC 中钉定**；下方为骨架。

**Files:** 新增 `apps/web/public/wake/`（放官方 `sherpa-onnx-wasm-*-kws.js/.wasm`、自建 `pcm-worklet.js`、占位 `feedback.mp3`）、`apps/web/src/lib/pet/wake/sherpa-kws.ts`

- [ ] **Step 1:** 取官方 sherpa-onnx **wasm KWS** 构建产物放 `public/wake/`；生成 `keywords.txt`（`你好博般` 经 `sherpa-onnx-cli text2token`）放测试模型目录。
- [ ] **Step 2:** `sherpa-kws.ts`：实现 `createSherpa(urlBase)`——`locateFile` 指向 `public/wake/`；用 `fetch(urlBase + 文件名)`（`urlBase="wakemodel://m/"`，即 `wakemodel://m/encoder.onnx` 等）拿 ArrayBuffer，`Module.FS.writeFile` 写入 MEMFS，再 `createKeywordSpotter` + `createVad`；返回 `{ accept, pollKeyword, vadIsEndpoint, vadReset, free }`。
- [ ] **Step 3:** 临时在宠物页加一个 dev 入口：建 KWS、用麦克风 PCM 喂，命中即 `console.log("WAKE HIT")`。
- [ ] **Step 4:** **双环境验证**：
  - dev：`pnpm --filter web dev:app`，对麦说"你好博般"→ 控制台 `WAKE HIT`。
  - 生产 `file://`：`pnpm --filter web build:app` 后运行安装包，部署模型到默认目录，验证 wasm/worklet 加载、`wakemodel://` 取字节、命中 log 均 OK。
- [ ] **Step 5:** 记录验证结论到本计划"PoC 结论"段（API 实际签名、`file://` 注意点）。
- [ ] **Step 6: Commit**
  ```bash
  git add apps/web/public/wake apps/web/src/lib/pet/wake/sherpa-kws.ts
  git commit -m "feat(wake): PoC 打通 wasm KWS + MEMFS 载模型(file://双环境)"
  ```

---

## Phase 3：A 核心

### Task 7: usePetVoiceCurator 注入流改造（TDD）

**Files:** Modify `apps/web/src/components/pet/use-pet-voice-curator.ts`；Test `apps/web/src/components/pet/use-pet-voice-curator.test.ts`

- [ ] **Step 1: 写失败测试**（用 `@testing-library/react` `renderHook`；mock `getUserMedia`/`MediaRecorder`）
  - 断言：`startRecording({ stream })` 传入外部流时，结束/清理**不** `stop()` 该流的轨；无参时仍自开流并在清理时 `stop()`。
- [ ] **Step 2: 跑测试确认失败**
  Run: `pnpm --filter web test:unit use-pet-voice-curator`，Expected: FAIL
- [ ] **Step 3: 实现**
  - `startRecording(opts?: { stream?: MediaStream })`：有 `opts.stream` 则 `streamRef.current = opts.stream; externalStreamRef.current = true`，跳过 `getUserMedia`；否则现状。
  - `cleanupStream()`：`if (externalStreamRef.current) { streamRef.current = null; externalStreamRef.current = false; return }`，否则现状（`stop()` 轨）。
  - **卸载 effect（当前 lines 229-239 也 `stop()` 轨）同样要判 `externalStreamRef`**：外部流不在此处 `stop()`（所有权归 `useWakeWord`）。
  - 返回值增暴露 `startRecording`、`finishRecordingAndSend`。`toggleVoiceClick` 不变。
- [ ] **Step 4: 跑测试确认通过**（`pnpm --filter web test:unit use-pet-voice-curator`）→ **Step 5: Commit**
  ```bash
  git commit -am "feat(pet-voice): startRecording 支持注入共享流（唤醒复用）"
  ```

### Task 8: resolve-wake-model（渲染侧）

**Files:** 新增 `apps/web/src/lib/pet/wake/resolve-wake-model.ts`；Test 同名 `.test.ts`

- [ ] **Step 1: 写失败测试**（vitest，`pnpm --filter web test:unit resolve-wake-model`）：mock `window.electronApi.resolveWakeModel`（Task 3 已钉定此名）→ 返回 `{present,urlBase}`；无 api → `{present:false}`。
- [ ] **Step 2-4:** 实现 `resolveWakeModel(): Promise<{present:boolean; urlBase:string}>`（调 `window.electronApi.resolveWakeModel()`，异常回退 `{present:false,urlBase:"wakemodel://m/"}`）；测试通过。
- [ ] **Step 5: Commit** `feat(wake): 渲染侧模型解析`

### Task 9: useWakeWord 状态机（TDD，mock sherpa/audio）

**Files:** 新增 `apps/web/src/lib/pet/wake/use-wake-word.ts`、`pcm-worklet.ts`；Test `use-wake-word.test.ts`

- [ ] **Step 1: 写失败测试**（依赖注入：把 `createSherpa`、`getUserMedia`、`AudioContext`、`playFeedback` 作为可注入依赖以便 mock）：
  - 命中关键词 → 先 `playFeedback()`、其 resolve 后才 `onWake()`/`startRecording`（顺序断言）。
  - `capture=on` 期间 `pollKeyword` 命中不再触发 `onWake`。
  - VAD `isEndpoint` → 调 `onEndpoint`。
  - `enabled=false` → 停流、`free()`。
- [ ] **Step 2: 跑测试确认失败**（`pnpm --filter web test:unit use-wake-word`，Expected: FAIL）
- [ ] **Step 3: 实现状态机**：`idle → (hit) → feedback → recording(capture=on, VAD on) → (endpoint) → finishing → idle(capture=off)`；防抖；`getStream()`；最长录音兜底定时器。`pcm-worklet.ts` 实现 16k 降采样 `postMessage`。
- [ ] **Step 4: 跑测试通过**（`pnpm --filter web test:unit use-wake-word`）→ **Step 5: Commit** `feat(wake): useWakeWord 状态机（反馈/录音/VAD 门控）`

### Task 10: 接入 PetWindow

**Files:** Modify `apps/web/src/components/pet/PetWindow.tsx`

- [ ] **Step 1:** 启动时 `resolveWakeModel()` + `getWakeSettings()` 求 `modelPresent`/`voiceWakeEnabled`；`useWakeWord({ enabled: voiceWakeEnabled && modelPresent && !voice.voiceBusy, onWake, onEndpoint })`（接线见 spec §6.1）。
- [ ] **Step 2:** 手动验证：说"你好博般"→ 挥手 → 说一句 → 自动转写发总管。
- [ ] **Step 3: Commit** `feat(wake): 接入宠物窗，端到端免手链路`

---

## Phase 4：反馈片段 + 设置 UI + 打包

### Task 11: 反馈片段播放

**Files:** Modify `use-wake-word.ts`；新增/替换 `apps/web/public/wake/feedback.mp3`（正式录音）；`sherpa-kws.ts`/`resolve` 提供 feedback 源解析

- [ ] **Step 1: 写失败测试**：`onWake` 时若 feedback 可播 → 播完才录；feedback 加载失败/超时 → 直接录（已在 Task 9 覆盖播放顺序，这里补"覆盖优先级：模型目录 `wakemodel://m/feedback.wav` > 默认 `/wake/feedback.mp3`"）。
- [ ] **Step 2-4:** 实现 feedback 源解析（先试 `wakemodel://m/feedback.wav` HEAD/加载，失败回退 bundled），3s 超时兜底；测试通过。
- [ ] **Step 5: Commit** `feat(wake): 唤醒预录反馈片段（可覆盖+回退+超时）`

### Task 12: 设置 UI

**Files:** Modify 设置页（定位 `pet-settings.tsx` 或设置主页面）；用 `getWakeSettings/setWakeSettings` bridge

- [ ] **Step 1:** 加"语音唤醒"分区：开关 `voiceWakeEnabled`、模型目录 `wakeModelDir`、转写地址/密钥/语言三项；读写走 bridge。
- [ ] **Step 2:** 手动验证：关开关 → 唤醒停；改转写地址 → `transcribePetAudio` 生效（运行时）。
- [ ] **Step 3: Commit** `feat(settings-ui): 语音唤醒/转写配置项`

### Task 13: 打包核对

**Files:** 只读/必要时改 `apps/web/electron-builder.json5`

- [ ] **Step 1:** 确认 `public/wake/*` 经 Vite 进 `dist`（默认行为）；`file://` 生产包能加载 wasm/worklet/feedback。无需 `extraResources`/`asarUnpack`（模型走协议、wasm 在 dist）。
- [ ] **Step 2:** 若 `audioWorklet.addModule` 在 `file://` 解析异常，按 PoC 结论修正资产 URL 策略（`new URL('./wake/pcm-worklet.js', import.meta.url)` 等）。
- [ ] **Step 3: Commit**（如有改动）`chore(build): 核对 wake 资产随 dist 发布`

---

## Phase 5：测试与调参

### Task 14: 阈值与手动场景

- [ ] **Step 1:** 调 `keywords.txt` 的 `#` 阈值/`:` 提升分，平衡误唤醒 vs 漏唤醒（安静/嘈杂各测）。
- [ ] **Step 2:** 跑全部单测：`pnpm --filter web test:unit`（vitest，src）+ `pnpm --filter web test`（node，electron），Expected: 均全绿。
- [ ] **Step 3:** 手动四场景（spec §11）：有模型端到端、无模型回退点击、拒麦降级、离线机指向本机 STT。
- [ ] **Step 4: Commit** `test(wake): 阈值调参 + 场景记录`

---

## PoC 结论（Task 6 后回填）

- sherpa-onnx wasm KWS/VAD 实际 API 签名：_待填_
- `file://` 下 wasm `locateFile` / `audioWorklet.addModule` 注意点：_待填_
- `wakemodel://` → MEMFS 字节注入可行性：_待填_

---

## 风险与回退

- wasm API 与骨架不符 → 以 PoC 钉定为准，仅 `sherpa-kws.ts` 受影响（已隔离）。
- `file://` 资产加载失败 → 回退 `import.meta.url` 相对解析；最坏改 `extraResources` + 自定义协议供 wasm（同 wakemodel 机制）。
- 误唤醒过高 → 提高阈值；必要时加二次确认（点击/再次唤醒）后再发送（超范围，记 backlog）。
