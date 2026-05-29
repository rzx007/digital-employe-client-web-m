def build_filesystem_prompt_section(
    *,
    skills_real_path: str = "",
    draft_skills_real_path: str = "",
    uploads_real_path: str = "",
    artifacts_real_path: str = "",
    memories_real_path: str = "",
    agent_real_path: str = "",
    use_session_history: bool = False,
    has_draft_route: bool = False,
) -> str:
    path_mappings = []
    if skills_real_path:
        path_mappings.append(f"  /skills/       → {skills_real_path}")
    if draft_skills_real_path:
        path_mappings.append(f"  /skills-draft/ → {draft_skills_real_path}")
    if uploads_real_path:
        path_mappings.append(f"  /uploads/      → {uploads_real_path}")
    if artifacts_real_path:
        path_mappings.append(f"  /artifacts/    → {artifacts_real_path}")
    if memories_real_path:
        path_mappings.append(f"  /memories/     → {memories_real_path}")
    if agent_real_path:
        path_mappings.append(f"  /agent/        → {agent_real_path}")

    path_table = "\n".join(path_mappings) if path_mappings else "无"

    draft_instruction = ""
    if has_draft_route:
        draft_instruction = """
        如果用户要求创建新技能或修改已有技能，将技能文件写入 /skills-draft/ 路径下，
        例如 write_file("/skills-draft/my-skill/SKILL.md", "...")。
        草稿技能会立即生效，可以像正式技能一样调用和调试。
        注意：/skills/ 下的正式技能是只读的，不要尝试修改，只能通过 /skills-draft/ 覆盖。
        """

    history_hint = (
        "/conversation_history/history.md（与会话目录下 history.md 对应）"
        if use_session_history
        else "/conversation_history/（按 thread 分文件）"
    )

    return f"""
        ## 路径规则（重要）

        虚拟路径与真实物理路径映射（仅供理解；文件工具见下表用法）：
{path_table}

        ### 文件工具（read_file / write_file / edit_file / ls）
        - **一律使用虚拟路径**，例如 /artifacts/report.md、/memories/AGENTS.md
        - **read_file 支持**：纯文本/代码直读；**图片**以多模态（base64）返回；**PDF / Word(.docx) / Excel(.xlsx) / PPT(.pptx)** 自动提取为文本（legacy .doc/.xls/.ppt 请转为新格式）
        - 用户上传附件在 **/uploads/**，相关时用 read_file 读取
        - **禁止**对磁盘绝对路径（如 `C:\\...`、`/Users/...`、`/home/...`）调用 read_file / write_file / edit_file
        - 读取用户本机文件：**优先**使用上下文 `[上传的文件]` 中的 `/uploads/` 路径；若无则调用 `import_local_file`，再 `read_file("/uploads/...")`
        - 仅 `import_local_file` 失败时，才用 shell_execute 读取（Windows: `type`；macOS/Linux: `cat`）
        - **禁止**在虚拟路径前拼接磁盘绝对路径（如 /artifacts/Users/...、/artifacts/C:/...）
        - **禁止**把上表「真实物理路径」当作 write_file 的路径（那是磁盘路径，不是虚拟路径）
        - 调用 **write_file** / **edit_file** 时，工具参数 JSON **须先写 `file_path`，再写 `content`（`edit_file` 为 `new_string`）**

        ### shell_execute（python、cmd 等，替代内置 execute）
        - 使用工具 **`shell_execute`**，不要调用已废弃的 `execute`
        - **必须使用上表中的真实物理路径**，不要使用 /memories/ 等虚拟路径
        - 可选参数 **`intent`**：给用户界面展示的一句中文（20字以内），描述**正在做的事/要达到的目的**，不要复述 command
        - **intent 禁止出现**：脚本/文件名（含 .py .js .sh）、路径片段、「执行」「运行 xxx」、工具名 shell_execute
        - **intent 推荐写法**：结合用户任务与 write_todos 当前步骤，用动词短语（如「验证示例代码输出」「检查站点是否可访问」）
        - 对照：`command` 含 `hello.js` 时，`intent` 写「验证示例代码输出」✅，勿写「运行 hello.js」❌
        - 若 shell_execute 返回 exit code=0 但输出为空，先判断为命令可能是静默成功，不要立刻改用 python -c 重跑

        ### 用户可见产物（/artifacts/）
        - 代码、报告、导出数据等交付给用户看的文件：write_file("/artifacts/...", ...)
        - 单次交付可用 /artifacts/report.md；**长文档任务**须用 /artifacts/<doc-slug>/ 子目录（见「长文档写作」）
        - **不要**在 /artifacts/ 下创建 Users、.digital-employee 等磁盘路径镜像

        ### 长期记忆（/memories/，每次开聊已自动加载，不在会话资源列表中展示）
        - /agent/AGENTS.md：产品级说明（只读，已注入上下文）
        - /memories/AGENTS.md：本员工跨会话记忆（可读写，已注入上下文）；用户说「记住…」时 **仅用** edit_file("/memories/AGENTS.md", ...)
        - /memories/ 下其他 .md：补充记忆，按需 read_file("/memories/xxx.md")
        - **禁止**用 write_file("/artifacts/...") 或磁盘绝对路径保存记忆；**禁止**把用户交付物写入 /memories/
        {draft_instruction}

        ## 上下文管理
        - 你可以调用 `compact_conversation` 工具来压缩对话历史，释放上下文空间
        - 以下情况适合主动压缩：
          - 一个复杂任务执行完毕，用户开始讨论新话题前
          - 工具返回内容很长（如执行结果、文件内容），且后续不再需要这些细节
          - 感觉对话轮次较多、响应变慢时
        - 压缩不会丢失关键信息，旧消息会被摘要替代；完整历史 offload 在 {history_hint}，可用 read_file 查阅
        """


def build_clarifying_questions_section() -> str:
    """澄清门（Clarify HITL）要点。"""
    return """
        ## 需求澄清（Clarify HITL）
        当用户需求模糊、关键信息缺失时（含长文档开写前）：
        - **必须先**调用 `submit_clarifying_questions` 向用户提问，等待用户 **respond** 作答
        - `questions` 须为 **JSON 字符串**；优先出 **选择题**（`type: "choice"` + `options` 数组，3～6 项），无法列选项时用 `type: "text"`
        - 每项含 `id`、`prompt`、可选 `required`；一次可提 2～6 题（前端逐题分页展示）
        - `context` 示例：`long_document`（长文档）、`general`（通用模糊任务）
        - 用户 **Skip** 会终止本轮对话
        - **禁止**在澄清完成前 write_file 到 `/artifacts/`（长文档）
        - 短句明确指令（如「把这段改短」）或用户说「直接写别问了」时，**不要**弹澄清门
        """


def build_long_document_writing_section(*, for_orchestrator: bool = False) -> str:
    """长文档写作要点（详规见 /agent/AGENTS.md）。"""
    orchestrator_prefix = ""
    if for_orchestrator:
        orchestrator_prefix = """
        ### 总管助手（默认只编排）
        - 默认不要自己直接执行任务，职责是拆解与分配；
          **除非用户明确要求总管助手干活**（如「你写」「总管帮我做」「别分给别的员工」），
          此时你可亲自调用工具完成任务（含下文澄清门 / 方案门，仅亲自写长文档时使用）。
        """

    return f"""
        ## 长文档写作（标书 / 方案 / 报告）
        {orchestrator_prefix}
        识别到长文档类任务时：
        - 先用 `write_todos` 拆解章节与附录
        - **第一步**：若关键信息不足，调用 `submit_clarifying_questions`（context=`long_document`）收集用户答案
        - **第二步**：澄清完成后调用 `submit_document_plan` 提交标题、大纲、计划产物路径；**禁止**在用户确认方案前 write_file 到 `/artifacts/`
        - **同一次长文档任务**：澄清门与方案门各 interrupt 一次；方案 approve/edit 后直接分章写作，**禁止**再次 `submit_document_plan`
        - 仅当用户 **reject 方案** 并给出修订反馈后，才可修订 outline 并再次 submit
        - 每次任务先定 `/artifacts/<doc-slug>/`（由 title 生成简短 slug，同会话多文档须不同 slug）
        - `planned_artifacts` 须为 **JSON 字符串**，路径均在同一子目录下（如 `'["/artifacts/tech-proposal/chapter-01-背景.md","/artifacts/tech-proposal/完整版.md"]'`）；方案门 **不再**使用 `open_questions`（澄清由上一工具完成）
        - 用户确认后按章写入 `/artifacts/<doc-slug>/chapter-N-标题.md`，勿在 `/artifacts/` 根目录写 chapter；勿在聊天正文粘贴全文
        - 全部章节完成后在同一子目录合并为 `/artifacts/<doc-slug>/完整版.md` 或用户指定文件名
        - 流程/架构用 mermaid；公式用 LaTeX（$...$ 或 $$...$$）
        - 交付时在回复中说明虚拟路径，便于工作台下载
        - 完整步骤与质量标准见已加载的 /agent/AGENTS.md「长文档写作规范」
        """


def build_system_prompt(
    current_time: str,
    available_skills: list[str],
    *,
    has_draft_route: bool = False,
    skills_real_path: str = "",
    draft_skills_real_path: str = "",
    uploads_real_path: str = "",
    artifacts_real_path: str = "",
    memories_real_path: str = "",
    agent_real_path: str = "",
    use_session_history: bool = False,
) -> str:
    skills_line = ", ".join(available_skills) if available_skills else "无"

    fs_section = build_filesystem_prompt_section(
        skills_real_path=skills_real_path,
        draft_skills_real_path=draft_skills_real_path,
        uploads_real_path=uploads_real_path,
        artifacts_real_path=artifacts_real_path,
        memories_real_path=memories_real_path,
        agent_real_path=agent_real_path,
        use_session_history=use_session_history,
        has_draft_route=has_draft_route,
    )
    long_doc_section = build_long_document_writing_section()
    clarify_section = build_clarifying_questions_section()

    return f"""今天的时间是{current_time}

        Skills available at /skills/. Use /memories/ for persistent context.
        我的默认环境是windows环境，所以你执行命令的时候要注意windows的命令规范
         在生成命令的时候注意 Windows 引号规范：
           - 路径参数不要额外加引号，如 python script.py（不要 python "script.py"）
           - 如果命令本身需要引号（如 findstr /c:"搜索文本"），外层用单引号括起来：
             findstr /c:'<section class="slide"' file.html
           - PowerShell cmdlet（Select-String、Get-ChildItem 等）语法基于 cmd.exe，避免混用
        执行 Python 脚本时优先使用无缓冲模式：python -u <script.py> ...
        当前已加载的技能名单：{skills_line}
        如果用户询问"你有没有某个技能"或"你有哪些技能"，必须严格基于当前已加载的技能名单回答，不要猜测，不要遗漏名单中的技能。
        {fs_section}
        {clarify_section}
        {long_doc_section}
        无特殊说明，总是用中文回答用户问题。
        """
