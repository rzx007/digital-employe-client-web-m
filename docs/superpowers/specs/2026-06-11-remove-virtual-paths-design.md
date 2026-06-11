# 去虚拟路径：全面改用真实磁盘路径 + 技能可改

> 设计稿 · 2026-06-11 · 方案 B（连分桶命名空间一起删，原子切换，不向后兼容）

## 1. 背景与目标

### 1.1 现状

后端 agent 文件体系当前是**双轨制**（见 `apps/server/docs/path-access-recap.md`）：

- **虚拟前缀**（`/artifacts/`、`/uploads/`、`/skills/`、`/skills-draft/`、`/memories/`、`/agent/`、`/conversation_history/`）由 `CompositeBackend` 按前缀路由到各自后端，`virtual_mode=True`。
- **本机绝对路径**通过 `validate_path_shim` 放行，物理模式（`AGENT_VIRTUAL_MODE=0`，默认）下文件工具已能直读直写真实盘符路径。

这套虚拟前缀**身兼二职**，是本次改造的核心矛盾：

1. **给 agent 看的路径抽象** —— prompt 教模型用 `/artifacts/xxx` 而非真实盘符路径；`create_deep_agent(skills=[...], memory=[...])` 传虚拟前缀；shell 命令里的虚拟前缀由 `SkillAwareShellBackend._rewrite_command_virtual_paths` 改写为物理路径。
2. **交付物的"逻辑分桶命名空间"** —— 前端工作台、资源 API（`ResourceService`）、静态服务路由（`/chat/conversations/{id}/resources/static/{path}`）、`browserctl open-artifact` 都用 `/artifacts`、`/uploads`、`/skills-draft` 当作**分桶 key**，用来分类 / 列表 / 链接 / 预览 / 下载 / 删除交付物。

### 1.2 目标（用户诉求）

1. **agent 全部改用真实磁盘路径**，不再使用任何虚拟前缀。
2. **技能目录可被 agent 修改** —— 删除 `/skills/` 写禁用。
3. **彻底删除虚拟前缀寻址**（含分桶命名空间），不保留向后兼容。

### 1.3 非目标（YAGNI）

- 不改物理目录结构：`<root>/<conversation_id>/{artifacts,uploads,skills-draft,conversation_history}/`、群协作 `room-<room_id>/...` 保持不变。这些是真实目录，不是"虚拟"的。
- 不改会话隔离机制（`CONVERSATION_ID` 注入仍保留，用于子进程定位会话根）。
- 不引入容器/沙箱执行后端（参考项目 hermes-agent 用 Docker 隔离，本次不做）。
- 不做新旧寻址并存的过渡层（桌面端前后端一起打包发布，原子切换）。

### 1.4 参考

NousResearch/hermes-agent（用户指定参考）：纯真实磁盘路径，无虚拟抽象；配置根 `~/.hermes/`，技能存 `~/.hermes/skills/` 且可被 agent 自我改写；安全靠命令审批 + 可选容器隔离，而非路径虚拟化。本设计与其路径哲学一致。

---

## 2. 核心机制：用什么替代虚拟前缀

### 2.1 物理目录不动，删的是"前缀字符串寻址"

会话产物物理结构保持原样：

```
<artifacts_root>/<conversation_id>/
    ├─ artifacts/          ← 交付物
    ├─ uploads/            ← 用户上传
    ├─ skills-draft/       ← 草稿技能（有会话时）
    └─ conversation_history/
群协作：<artifacts_root>/room-<room_id>/...
员工技能根：<skills_root>/（员工级，跨会话）
员工记忆：<memories_dir>/
```

### 2.2 三处替换

| 维度 | 原（虚拟前缀） | 新（真实路径） |
|------|----------------|----------------|
| **agent 寻址** | prompt 教用 `/artifacts/xxx`；`skills=["/skills/"]`、`memory=["/agent/AGENTS.md"]`；shell rewrite | 注入 env `ARTIFACTS_DIR`/`UPLOADS_DIR`/`SKILLS_DIR`/`MEMORIES_DIR`/`SKILLS_DRAFT_DIR`；prompt 给真实绝对路径；`skills=`/`memory=` 传真实绝对路径；删 `CompositeBackend` 路由，默认 `SkillAwareShellBackend`（filesystem 能力）统管真实路径；**删 shell rewrite** |
| **工作台分桶** | 靠 `/artifacts/` 等前缀字符串分类 | 后端按**真实子目录归属**推导 `bucket`（文件在 `…/<id>/artifacts/` 下 → `artifacts` 桶）；资源条目 / 文件变更事件携带 `{realPath, bucket, name}` |
| **静态服务 / 下载 / 预览** | `/resources/static/artifacts/xxx`（虚拟前缀拼 URL） | `/resources/static?path=<真实绝对路径>`，沙箱校验"路径必须在会话根目录内"（复用现有 `_resolve_safe_path` 的 `relative_to` 边界检查） |

### 2.3 已接受的取舍（请在 spec review 时确认）

**资源 API 的标识符从"桶相对路径"改成"真实绝对路径"。** 当前 `ResourceEntry.path` 是 `/artifacts/foo`（前端↔后端协议，本质是会话内相对路径），方案 B 要求它改成真实绝对路径（如 `D:\...\conversations\430\artifacts\report.html`）+ 独立 `bucket` 字段。

- **代价**：绝对服务端路径会暴露给前端，并经下载/预览参数回传；路径穿越面变大（但 `relative_to(会话根)` 沙箱校验已能挡 `../` 逃逸）。
- **替代（若 review 时想收敛）**：API 层仍可用"桶相对路径"作 wire 格式（由真实路径推导），只让 **agent** 用纯绝对路径。这等价于"方案 B 的 agent 侧 + 方案 A 的 API 侧"。当前按纯 B（API 也用绝对路径）落稿，留此注记供决策。

---

## 3. 分相位设计

桌面端前后端一起打包 → 单份 spec、原子切换。实现按相位推进，相位间有**共享契约**（P0）先定。

### P0 — 共享契约（先定，全相位引用）

定义贯穿前后端的数据形状与约定，避免各相位各写各的。

**(a) 资源条目 `ResourceEntry`（`apps/server/src/schemas/resource.py`）**

```
ResourceEntry {
  name: str            # 文件名（basename）
  realPath: str        # 真实绝对路径（新；取代旧 path 虚拟前缀）
  bucket: "artifacts" | "uploads" | "skills_draft"   # 新：分桶 key
  entry_type: "file" | "directory"
  artifact_type: str | None
  size: int
  modified_at: float | None
  children: list[ResourceEntry] | None
}
```
`ResourceList`、`ResourceContent`、`ResourceUploadResult` 同步把 `path`(虚拟) → `realPath` + `bucket`。

**(b) 静态服务 / 内容 / 下载 / 删除接口签名**

统一改为接收**真实绝对路径**查询参数 `path=<abs>`，服务端校验：
1. `Path(path).resolve()` 必须 `relative_to(会话根 resolve())`（沙箱）；
2. 删除/上传等写操作额外校验在允许的子目录（`uploads/` 等）下。

**(c) agent 子进程环境变量（约定名）**

`SkillAwareShellBackend.__init__` 注入（在现有 `CONVERSATION_ID` 旁）：

| env | 值 |
|-----|-----|
| `ARTIFACTS_DIR` | `str(artifacts_dir)` |
| `UPLOADS_DIR` | `str(uploads_dir)`（有会话时） |
| `SKILLS_DIR` | `str(skills_root)` |
| `SKILLS_DRAFT_DIR` | `str(draft_dir)`（有会话时） |
| `MEMORIES_DIR` | `str(memories_dir)` |

**(d) 文件变更事件形状**

agent 写文件的 file-change 事件（前端 `file-change-utils.ts` 消费）由后端补 `{realPath, bucket}`，前端不再用前缀正则推断"是否用户可见 / 哪个桶"。

**(e) 删除清单（本相位仅声明，后续相位执行）**

- 删 `apps/server/src/service/agent/path_access/virtual_paths.py` 的 `VIRTUAL_PREFIXES`、`is_virtual_path`、`map_virtual_token`（整文件可删，确认无残余引用后）。
- 删 `_rewrite_command_virtual_paths` / `_map_virtual_token`（`skill_shell_backend.py`）。
- 删 `_ALLOWED_PREFIXES`（`resource_service.py`）。
- **删 `validate_path_shim.py`（整文件）** —— 已定（Q4）。P1 先验证删除后绝对路径文件工具仍可用；若 deepagents 原生拒绝绝对路径，修复方向是在 `SkillAwareShellBackend` 内处理，**不**把 shim 加回来。

### P1 — 服务端 agent 核心

**文件**：`apps/server/src/service/agent/employee.py`、`apps/server/src/service/agent/orchestrator/agent.py`、`skill_shell_backend.py`、`prompts.py`、`path_access/prompt_rules.py`、`orchestrator/prompts.py`、`shell_execute_tool.py`、`AGENTS.md`。

1. **删 `CompositeBackend` 路由**（`employee.py:134-179`、`orchestrator/agent.py:187-203`）：不再注册 `/artifacts/` 等路由。`backend = SkillAwareShellBackend(...)` 直接作为 agent backend（它继承 `LocalShellBackend`，需确认其 filesystem 读写能力覆盖原各 route 后端的 read/write/edit/ls；缺口在此相位补齐，例如 `/artifacts/` 原是 `BasicFileFilesystemBackend` 的 GBK 回退能力，已由 `SkillAwareShellBackend.read/edit` 委托 `basic_file_read/edit` 覆盖）。
2. **`skills=` / `memory=` 改真实绝对路径**（`employee.py:230-233`、`orchestrator/agent.py:286-289`）：
   - `memory=[str(base_dir/"AGENTS.md"), str(memories_dir/"AGENTS.md")]`
   - `skills=[str(skills_root)]`（+ `str(draft_dir)` 有草稿时）
   - 已由子 agent 确认 deepagents 不强制前缀：`SkillsMiddleware`/`MemoryMiddleware` 把 sources 作 opaque token 透传 `backend.download_files()`，绝对路径可解析。**P1 需实测**：`download_files` 对绝对路径在 `SkillAwareShellBackend` 上的行为。
3. **删写禁用，技能可改**（`employee.py:257-268`、`orchestrator/agent.py:333-343`）：移除 `FilesystemPermission(paths=["/skills/**","/agent/**"], mode="deny")`。`/memories/AGENTS.md` 写禁用按需保留（改绝对路径写法）或一并放开（与"技能/记忆可自改"目标一致，建议放开，详见开放问题 Q1）。
4. **注入 env**（`skill_shell_backend.py:155-160` 旁）：按 P0(c) 注入五个目录 env。
5. **删 shell rewrite**：`_prepare_shell_command` 不再调 `_rewrite_command_virtual_paths`；`_materialize_multiline_python_c` 保留（与虚拟路径无关）。
6. **prompt 重写**（`prompt_rules.py`、`prompts.py`、`orchestrator/prompts.py`、`shell_execute_tool.py:39`、`AGENTS.md`）：删虚拟前缀文案，改教 agent：
   - 交付物写到 `ARTIFACTS_DIR`（给真实路径或 env 引用）；
   - 技能在 `SKILLS_DIR`，可读可改；
   - 上传在 `UPLOADS_DIR`；记忆在 `MEMORIES_DIR`；
   - 三端绝对路径示例保留。
7. **`AGENT_VIRTUAL_MODE` 处理**：物理模式成为唯一模式。删除虚拟模式分支（`prompt_rules.build_file_tool_rules(virtual_mode=True)` 等）还是保留开关作回退，见开放问题 Q2。

### P2 — 资源服务 + API + 静态服务

**文件**：`apps/server/src/service/resource_service.py`、`apps/server/src/api/chat_api.py`、`apps/server/src/schemas/resource.py`。

1. **`resource.py` schema** 按 P0(a) 改字段。
2. **`resource_service.py`**：
   - `_scan_dir_flat` / `_scan_file` / `_scan_skills_draft`：`virtual_prefix` 参数改为 `bucket` + 真实目录，`ResourceEntry.realPath = str(file_path)`、`bucket=<桶>`。
   - `read_content` / `resolve_download_path` / `delete_resource` / `delete_upload_file`：入参由 `virtual_path` 改 `real_path`；前缀白名单 `_ALLOWED_PREFIXES` 删除，改为"在会话根/对应桶子目录内"的沙箱校验。
   - `upload_file`：返回 `realPath` + `bucket="uploads"`。
3. **`chat_api.py`**：
   - 静态服务路由 `/chat/conversations/{id}/resources/static/{path:path}` → 改为 query 参数 `?path=<abs>`（或保留 path-style 但语义为绝对路径）。按 P0(b) 校验。
   - list / content / upload / download / delete 各端点 path 参数语义改为真实绝对路径；API doc 文案更新。

### P3 — 前端工作台

**文件**（依据依赖调查，按影响优先级）：`apps/web/src/lib/chat/pending-resources/paths.ts`、`merge.ts`、`apps/web/src/lib/chat/linkify-artifact-paths.ts`、`file-change-utils.ts`、`apps/web/src/stores/browser-store.ts`、`apps/web/src/api/conversation.ts`、`apps/web/src/components/artifact/artifact-panel.tsx`、`message-blocks/artifact-path-chip.tsx`、`file-open-routing.ts`、`tool-summarizer.ts`、`message-classifier.ts`。

1. **分桶**：`getResourceBucket` / `RESOURCE_TREE_ROOTS` / `merge.ts` 改为消费后端 `bucket` 字段，不再 `startsWith("/artifacts/")`。树根用 bucket label，children 用 `realPath` 的 basename。
2. **linkify**：消息里的产物链接不再靠 `/(artifacts|uploads|skills-draft)\/...` 正则。改为消费后端 file-change 事件的 `{realPath, bucket}`（P0(d)）；agent 正文若仍出现裸真实路径，按"已知是会话根下的文件"识别（需后端事件兜底，正文正则尽量弱化）。
3. **HTML 预览**：`browser-store.ts:openHtmlPreview(conversationId, realPath)` → URL 改 `${base}/chat/conversations/${id}/resources/static?path=${encodeURIComponent(realPath)}`。更新 `browser-store.test.ts` 期望。
4. **file-change 可见性**：`isUserVisibleFileChange` / `isArtifactLikePath` 改为按 `bucket` 判定。
5. **conversation.ts**：`fetchResourceContent`/`download`/`delete` 传 `realPath`。
6. **技能名解析**（`tool-summarizer.ts`、`message-classifier.ts`）：从真实路径里取技能目录名（相对 `SKILLS_DIR`/`SKILLS_DRAFT_DIR` 的首段），或后端在事件里直接给 `skillName`。

### P4 — browserctl + 技能文档

**文件**：`packages/browserctl/src/index.js`、`packages/browserctl/test/index.test.js`、`apps/server/build-in-skills/browser-runtime/{SKILL.md,reference.md,examples.md}`（及 `orchestrator_skills`/`.agents` 同名副本）。

1. **`toArtifactVirtualPath` → `resolveArtifactPath`**：
   - 真实绝对路径：直接用（沙箱校验交给后端）。
   - 纯文件名 / 相对路径：拼 `process.env.ARTIFACTS_DIR`（取代默认 `/artifacts/`）。
2. **`open-artifact`**：`rel` 拼接改为 `?path=<encodeURIComponent(绝对路径)>`，对齐 P2 静态服务签名。`CONVERSATION_ID` 仍用于后端定位会话根。错误码 `PATH_NOT_IN_ARTIFACTS` 语义改为"不在会话根内"。
3. **browser-runtime 技能文档**：示例从 `open-artifact /artifacts/report.html` 改为 `open-artifact "$ARTIFACTS_DIR/report.html"`（或纯文件名，因 cwd 即产物目录）。更新 `examples.md` 的 `--text-file /artifacts/body.txt`。

---

## 4. 数据流（改造后）

**交付物生成 → 工作台展示**
```
agent 写 write_file("D:/…/<id>/artifacts/report.md")  （prompt 给的真实路径 / 相对 cwd）
  → 后端文件变更事件补 {realPath, bucket:"artifacts", name:"report.md"}（P0d）
  → 前端按 bucket 入产物面板树；点击 → fetchResourceContent(realPath) / openHtmlPreview(realPath)
  → 静态服务 ?path=<abs> → resolve + 沙箱校验(relative_to 会话根) → FileResponse
```

**技能自改**
```
agent edit_file("D:/…/skills/<name>/SKILL.md")  （SKILLS_DIR 下，写禁用已删）
  → SkillAwareShellBackend.edit → basic_file_edit（编码回退、写回 UTF-8）→ 落盘
```

**browserctl 打开产物 HTML**
```
agent: browserctl open-artifact "$ARTIFACTS_DIR/report.html"
  → resolveArtifactPath → 绝对路径
  → POST navigate {url: backend/chat/conversations/$CONVERSATION_ID/resources/static?path=<abs>}
  → 后端沙箱校验 + FileResponse
```

---

## 5. 错误处理与边界

- **沙箱逃逸**：所有 real_path 入口统一 `Path(p).resolve().relative_to(会话根.resolve())`，失败返回 404 / 拒绝。写操作额外限定子目录。
- **跨平台**：Windows 盘符 `D:\`、Unix `/home`、`/Users` 均经 `host_paths.is_host_absolute_path` 判定；env 注入用 `str(Path.resolve())` 保证规范化。
- **群协作共享目录**：`room-<room_id>/` 的会话根解析（`_resolve_conversation_dir` / `resolve_shared_artifacts_dir`）逻辑不变，沙箱根相应取房间目录。
- **技能可改的副作用**：删写禁用后 agent 可改内置技能。风险=误改/损坏内置技能。缓解见开放问题 Q1（是否仅放开 `skills-draft` 或全放开 + 备份）。
- **deepagents `download_files` 绝对路径**：P1 必须实测；若 `SkillAwareShellBackend` 未原生支持绝对路径 `download_files`，需在该后端补实现（读真实文件返回）。

---

## 6. 测试策略

- **P0/P2 后端**：改造 `tests/test_virtual_route_integration.py`、`test_shell_virtual_rewrite.py`（rewrite 删除后改为"真实路径直通"断言）、`test_host_paths.py`；新增资源服务真实路径 + 沙箱校验 + bucket 推导单测；上传/下载/删除真实路径回归。
- **P1 agent**：实测 `skills=`/`memory=` 绝对路径加载；技能 edit 不再被 deny；shell 不再 rewrite。
- **P3 前端**：`browser-store.test.ts` 新 URL；分桶/linkify/file-change 单测改为消费 `bucket`。
- **P4 browserctl**：`packages/browserctl/test/index.test.js` 的 `toArtifactVirtualPath` 用例改 `resolveArtifactPath`。
- **手动 E2E**（更新 recap 第 8 节清单）：技能 edit、产物生成→工作台可见→预览→下载、上传→读取、browserctl open-artifact、群协作共享产物。

---

## 7. 开放问题（请在 review 时定夺）

- **Q1 技能写范围**：删写禁用后，是(a)全放开（内置技能也可被 agent 改，最贴近 hermes 自改哲学，但有误改风险）还是(b)仅放开草稿 `skills-draft` + 用户技能、内置技能仍禁？用户原话"我所有的技能要能够修改"倾向(a)。**暂定 (a) 全放开**，并保留 `/memories/AGENTS.md` 同步放开。
- **Q2 `AGENT_VIRTUAL_MODE` 开关**：物理模式成为唯一模式后，是否删除虚拟模式全部分支与开关（更干净）还是保留 env 开关作回退（更保守）？**暂定删除**（符合"彻底"目标；如需回退用 git）。
- **Q3 资源 API wire 格式**：见 §2.3，API 用纯绝对路径还是桶相对路径。**暂定纯绝对路径（纯 B）**。
- **Q4 `validate_path_shim` 去留**：~~待 P1 实测~~ **已定：整文件删**。P1 先验证删除后绝对路径文件工具仍可用；若 deepagents 原生拒绝绝对路径，在 `SkillAwareShellBackend` 内修，不把 shim 加回来。

---

## 8. 受影响文件总览

**服务端**：`agent/employee.py`、`agent/orchestrator/agent.py`、`skill_shell_backend.py`、`agent/prompts.py`、`agent/orchestrator/prompts.py`、`path_access/prompt_rules.py`、`path_access/virtual_paths.py`（删）、`path_access/validate_path_shim.py`（评估删）、`shell_execute_tool.py`、`resource_service.py`、`api/chat_api.py`、`schemas/resource.py`、`agent/AGENTS.md`、`skill_invocation_inference.py`、`agent_message_builder.py`。

**前端**：`lib/chat/pending-resources/{paths,merge}.ts`、`lib/chat/linkify-artifact-paths.ts`、`lib/chat/file-change-utils.ts`、`stores/browser-store.ts`(+test)、`api/conversation.ts`、`components/artifact/artifact-panel.tsx`、`components/chat/message-blocks/{artifact-path-chip,file-open-routing}.tsx`、`lib/chat/{tool-summarizer,message-classifier}.ts`。

**browserctl / 技能**：`packages/browserctl/src/index.js`(+test)、`build-in-skills/browser-runtime/{SKILL,reference,examples}.md`（及副本）。

**文档**：`apps/server/docs/path-access-recap.md` 更新。

**测试**：见 §6。
