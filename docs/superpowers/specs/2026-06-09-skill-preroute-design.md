# 技能预路由（关键词软提示）设计 Spec

- 日期：2026-06-09
- 状态：待评审
- 背景：技能识别=纯 LLM 判断、无确定性护栏 → "同句话有时调有时不调"。本期在 LLM 判断**之前**加一道**确定性关键词匹配**，把命中结果作为**软提示**注入用户消息尾部，提升一致率，且不破坏 prefill 前缀缓存。

## 1. 目标 / 非目标
### 目标
- 对每条用户消息，先用确定性代码匹配出"可能相关的内置技能"，在**用户消息尾部**注入一句软提示引导模型优先考虑该技能。
- 完全确定（同输入→同提示）、零新依赖、可单测、默认开、可一键关。
- 不碰系统提示前缀 → 不影响 prefill 缓存。

### 非目标（YAGNI）
- 不做向量/embedding 匹配（留作后续）。
- 不做硬锁定（只软提示，模型可忽略）。
- v1 不覆盖自定义/市场技能（仅内置技能关键词表）；不改 SKILL.md。
- group 派单路径不动。
- **v1 仅 employee 直聊**接入；curator 暂不接入（其主职是派单、技能由员工执行，且其技能根是另一套 `resolve_orchestrator_skills_root()`、与员工分支不同源）。后续要加再单独处理 curator 分支。

## 2. 现状锚点
- 用户消息在 `apps/server/src/service/chat_service.py:835-841` 构建：`user_content = build_user_agent_content(...)` → `request_messages.append({"role":"user","content":user_content})` → `registry.request_start(messages=request_messages, ...)`。
- **已有先例**：同文件 `:833-834` 当用户斜杠显式选技能（`skill_name`）时，已会在消息前加 "请使用{skill}技能回答…"。本设计是其**自动版**，同一注入层、同样改用户消息（尾部）。
- 员工实际拥有的技能由 `list_available_skills(skills_root)`（`apps/server/src/service/agent/paths.py:54`，返回 `sorted` 目录名）给出。

## 3. 组件设计（隔离、可单测）

### 3.1 新模块 `apps/server/src/service/agent/skill_prerouter.py`
- **数据**：`SKILL_TRIGGERS: dict[str, tuple[str, ...]]` —— 内置技能名 → 触发关键词（全小写）。初版覆盖：
  - `bug-reporter`：反馈、报bug、报错、提建议、吐槽、问题反馈、提个意见、想反馈
  - `feishu-workbench`：交易日、交易日历、休市、开市
  - `pptx`、`html-ppt`：ppt、幻灯片、演示文稿、slides、deck
  - `xlsx`：excel、电子表格、xlsx、csv
  - `pdf`：pdf
  - `docx`：word文档、.docx、word 文件
  - `env-steward`：装python、装node、缺依赖、modulenotfound、pip装不上、配镜像、环境依赖
  - `doc-coauthoring`：技术方案、标书、投标、可行性报告、白皮书、长报告、需求文档
  - （刻意**不放**"文档/表格"这类过宽词，宁可少提示不错提示。）
- **`match_skills(user_text: str, available_skills: Iterable[str], limit: int = 2) -> list[str]`**：
  - `text = user_text.lower()`；遍历 `SKILL_TRIGGERS`，若某技能任一关键词是 `text` 子串 **且** 该技能名 ∈ `available_skills`，记为命中，命中分=最长命中关键词长度。
  - 按命中分降序、技能名升序稳定排序，取前 `limit`。无命中返回 `[]`。
- **`build_route_hint(matched: list[str]) -> str`**：
  - 空 → `""`。
  - 非空 → 返回如下软提示（含每个命中技能名）：
    ```
    \n\n【技能路由提示（系统自动匹配，仅供参考）】本条消息可能匹配技能：bug-reporter。
    若相关，请先读对应 /skills/<技能名>/SKILL.md 并按其说明执行；你判断不相关可忽略本提示。
    ```
- **隔离**：纯函数、无 IO、无 LLM；输入输出明确，单测覆盖。

### 3.2 注入点 `chat_service.py`（仅 employee 分支）
- 位置：构建 `user_content`（`:835-840`）之后、`request_messages.append(...)`（`:841`）之前。
- 触发条件：`target_type == "employee"` **且** `settings.agent_skill_preroute` 为真 **且** 未显式 `skill_name`（自动模式）。
- **技能根取法（评审修正）**：注入层只有 `skills_path`（字符串），没有现成 `skills_root`；需先 `resolve_skills_root(skills_path)` 再列技能：
  ```python
  from src.service.agent.paths import resolve_skills_root, list_available_skills
  # ... 在 employee 分支、append 之前：
  try:
      if get_settings().agent_skill_preroute and not skill_name:
          available = list_available_skills(resolve_skills_root(skills_path))
          hint = build_route_hint(match_skills(question, available))
          if hint:
              user_content = f"{user_content}{hint}"   # 尾部拼接
  except Exception:
      logger.warning("skill preroute failed, skip", exc_info=True)
  ```
  - 用 `question`（原始用户文本，函数参数）做匹配，而非已加工的 `skill_question`。
  - 任何异常吞掉、退化为不注入。
- curator / group 不走此注入（curator 见 §1 非目标）。

### 3.3 配置 `core/config.py`
- 新增 `agent_skill_preroute: bool = True`：在 `Settings` dataclass 加字段；在 `get_settings()` 用 **`_get_kv_bool(kv_data, "AGENT_SKILL_PREROUTE", default=True)`**（注意：`_get_kv_bool` 默认 False，**必须显式传 `default=True`**）。`get_settings` 有 `lru_cache`，改 kv 后经 `clear_settings_cache()` 生效；无需 hot-reload helper。关（`AGENT_SKILL_PREROUTE=0`）→ 完全恢复现状。

## 4. 数据流
用户消息 → `match_skills(question, 员工可用技能)` → `build_route_hint` →（命中则）拼到 `user_content` 尾 → 随消息进 agent → 模型在软提示引导下优先考虑该技能。系统提示前缀不变。

## 5. 错误处理 / 边界
- 匹配/拼接任何异常都**吞掉、退化为不注入**（绝不因路由提示影响正常对话）。
- 无命中 / 关闭开关 / 显式 skill_name → 不注入（零行为变化）。
- 命中技能不在员工可用集 → 不提示（不引导员工去用它没有的技能）。

## 6. 测试
- 单元 `tests/test_skill_prerouter.py`：
  - 命中：含"反馈"且 bug-reporter 可用 → `["bug-reporter"]`。
  - 取交集：命中关键词但技能不在 available → `[]`。
  - 多命中按长度/名稳定排序、limit 截断。
  - 无命中 → `[]`；`build_route_hint([])==""`；非空含技能名与 `/skills/`。
  - 大小写无关、子串匹配正确。
- `chat_service` 注入：可加一个轻量测试或在实现计划中以最小桩验证"开关关→不拼、显式 skill_name→不拼"。

## 7. 影响评估
- **prefill**：仅在用户消息尾部加几十 token，系统提示前缀不变 → 前缀缓存不受影响。
- **误命中**：软提示 + 窄关键词表 + 取员工可用交集，三重降噪；模型可忽略。
- **可回退**：`AGENT_SKILL_PREROUTE=0` 即关。

## 8. 后续（不在本期）
- 向量相似度版（抗改写）。
- 读 SKILL.md 可选 `triggers:` 前言字段，覆盖自定义/市场技能。
- 命中日志埋点，便于观测命中率与误命中。
