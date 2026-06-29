# 联网搜索工具（web_search）设计

- 日期：2026-06-29
- 状态：待评审
- 关联痛点：①浏览器查询（browserctl 驱动 GUI）不稳定；②worker 靠"找技能"查资料，命中差
- 灵感来源：opencode 的 websearch（接 Exa 公开 MCP，无 key 免费）—— `D:\space\code\github\opencode-dev`

## 1. 目标与非目标

### 目标
- 给 **worker（员工）agent** 一个**永远在场、稳定、免费、无 API key** 的联网搜索能力。
- 默认开箱即用；在能连外网时质量对标 opencode（Exa），连不上时自动降级到国内可达后端。
- 后端**可插拔、可配置**：将来内网/国网版部署可指向企业自建检索服务，不必改代码。
- 返回值不只是链接，而是**摘要 + 前 N 条正文**，让 agent 一步拿到可用信息。

### 非目标（本期不做）
- **不改 browserctl / browser-runtime**：保留，承担"打开某个具体网页做交互"的活，与搜索分工互补。
- **不碰"技能查找/排序"（痛点②的检索算法侧）**：本设计用"让搜索成为一等工具、不需要被发现"来从根上绕开痛点②，而不是去改技能市场的排序。
- 不做付费后端（Tavily/Brave/SerpAPI 等需 key 的）。`tavily-python` 虽在依赖里但代码未使用，是遗留，不纳入本方案。

## 2. 架构总览

形态：**一等 LangChain `@tool`**，而非 SKILL.md 技能。

理由：worker agent 在 `apps/server/src/service/agent/employee.py` 的 `get_agent()` 里，工具分两类——
- `extra_tools`：永远可用的一等工具（shell_execute、get_current_time、session_search…），**无需发现**。
- `skills=skill_sources`：要被加载/发现的 SKILL.md（browser-runtime 在此）。

把搜索放进 `extra_tools`，员工永远拥有它、不必"找技能"——这正是对痛点②的根因解。

```
worker agent (employee.py get_agent)
  └─ extra_tools += create_web_search_tool(...)        # 新增，永远在场
        └─ web_search(query, num_results, fetch_content) -> str
              └─ WebSearchService.search()
                    ├─ 选后端（健康缓存 → 按配置顺序探测）
                    ├─ Backend.search(query, n)         # 可插拔
                    │     ├─ ExaBackend        （默认主力，能连外网时）
                    │     ├─ DomesticBackend   （默认兜底：必应国内版 + 搜狗）
                    │     └─ SearxngBackend    （可选，企业自建 JSON 端点）
                    ├─ ContentFetcher.enrich(results)   # 后端没带正文时，抓前 N 条正文
                    └─ 组装 + 截断到字符预算 -> 文本
```

## 3. 组件设计

每个单元职责单一、接口清晰、可独立测试。

### 3.1 数据结构
```python
@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str          # 摘要
    content: str | None    # 正文（Exa 自带；国内后端经 ContentFetcher 补）
    published: str | None
```

### 3.2 SearchBackend（接口）
```python
class SearchBackend(Protocol):
    name: str
    async def search(self, query: str, num_results: int) -> list[SearchResult]: ...
    async def healthcheck(self) -> bool: ...   # 轻量连通性探测，用于自检与健康缓存
```

### 3.3 ExaBackend（默认主力）
- 端点：`POST https://mcp.exa.ai/mcp`，**无 key**。
- 请求：JSON-RPC `tools/call`，`name="web_search_exa"`，参数 `{query, numResults, type:"auto", livecrawl:"fallback", contextMaxCharacters}`。
- 响应：**SSE 流**（`event: message` + `data: {jsonrpc...}`），需解析：先按 `data: ` 取行 → JSON 解析 → 取 `result.content[0].text`。该文本已是 `Title/URL/Highlights` 结构化块，Exa 已自带正文摘要，无需再走 ContentFetcher。
- 超时：连接 10s / 读 25s（对齐 opencode 的 25s）。
- 实测（2026-06-29，本开发机）：HTTP 200、~2s、返回含国内站点（163/news.cn/头条）的结构化正文。**注意：开发机可达 ≠ 终端用户可达，需在真实部署环境用 §3.7 自检确认。**

### 3.4 DomesticBackend（默认兜底）
- 主：必应国内版 `GET https://cn.bing.com/search?q=...`；兜底：搜狗 `https://www.sogou.com/web?query=...`。
- 解析：抽取结果条目的 标题/链接/摘要。
- **依赖取舍**：必应结果 HTML 结构较规整，**优先用标准库 `html.parser` 实现，不新增依赖**（PyInstaller 打包体积/兼容更稳）。若实测解析过脆，再评估引入 `beautifulsoup4`（轻量、纯 Python，无需 lxml）。决策点记录在此，实现期二选一。
- 不带正文，交给 ContentFetcher 补。
- 百度反爬最凶（cookie/验证码），**不列入默认链**，仅作为后续可选项。

### 3.5 ContentFetcher（正文补全）
- 输入若干 URL，对**前 N 条**（默认 3）`GET` 页面，抽正文。
- 抽取：先做轻量"去标签 + 去脚本样式 + 折叠空白"的标准库实现；正文质量不足时再评估 `beautifulsoup4`。**不引入 trafilatura/readability-lxml**（偏重，打包负担大）。
- 单页超时 8s、失败跳过不阻断整体；单页正文截断到 ~3k 字符。
- 仅在后端未自带正文时触发（Exa 跳过）。

### 3.6 WebSearchService（编排 + 降级 + 健康缓存）
- 读配置得到后端顺序（默认 `["exa", "domestic"]`）。
- **健康缓存**：进程内记录各后端最近一次可用性 + TTL（默认 5 分钟）。某后端近期判定不可达时**跳过**，避免每次搜索都白等 Exa 超时——这对"连不上外网"的环境尤其关键。
- 逐个后端尝试：异常或空结果 → 下一个；成功即停。
- 成功后按需 ContentFetcher 补正文。
- **返回参照 opencode：透传后端文本，最小加工**（详见 §5）。Exa 文本原样透传；国内/searxng 后端格式化成同款文本块。
- 总输出按字符预算截断（默认 10k，配置可调，对齐 opencode 的 `contextMaxCharacters` 默认值），并施加 256KB 字节硬上限（对齐 opencode `MAX_RESPONSE_BYTES`）。
- 全部后端失败：**返回清晰的文字说明**（不抛异常），提示 agent 可改用 browserctl 打开具体页面。

### 3.7 连通性自检（落地实测用）
- 提供 `python -m src.service.agent.web_search_selftest`（或等价小脚本），在**真实部署环境**逐后端跑 `healthcheck` + 一次样例查询，打印每个后端是否可用、耗时。
- 解决"Exa 终端是否可达 = 得实测"的问题：部署后跑一次即可决定默认后端顺序，不靠猜。

## 4. 配置项

经 `get_settings()` / 环境变量注入（与现有 settings 模式一致），全部有默认值：

| 配置 | 默认 | 说明 |
|---|---|---|
| `WEB_SEARCH_BACKENDS` | `exa,domestic` | 后端顺序（逗号分隔），决定降级链 |
| `WEB_SEARCH_EXA_ENDPOINT` | `https://mcp.exa.ai/mcp` | Exa MCP 端点（可改私有镜像） |
| `WEB_SEARCH_SEARXNG_ENDPOINT` | 空 | 配置后启用 SearxngBackend，指向企业自建实例 |
| `WEB_SEARCH_NUM_RESULTS` | `8` | 默认返回条数 |
| `WEB_SEARCH_FETCH_TOP_N` | `3` | 正文补全条数 |
| `WEB_SEARCH_MAX_CHARS` | `10000` | 总输出字符预算 |
| `WEB_SEARCH_HEALTH_TTL` | `300` | 健康缓存 TTL（秒） |

> 内网/国网版部署示例：`WEB_SEARCH_BACKENDS=searxng` + `WEB_SEARCH_SEARXNG_ENDPOINT=http://内部检索:8080` —— 不改代码即切到企业后端。

## 5. 工具签名与返回

```python
@tool
def web_search(query: str, num_results: int = 8, fetch_content: bool = True) -> str:
    """联网搜索并返回结果摘要（含前几条正文）。需要查最新/外部信息时用本工具，
    比开浏览器更快更稳。要对某个具体网页做点击/填表等交互，才用 browser-runtime 技能。"""
```
**返回逻辑参照 opencode**：几乎不二次加工，**透传后端文本**，只做预算截断。opencode 的 `toModelOutput` 直接把 provider 文本原样塞给模型（`[{type:"text", text}]`）。

- **ExaBackend**：Exa 自带的 `result.content[0].text` 已是规整文本块（`Title/URL/Published/Author/Highlights`，`---` 分隔），**原样透传**，只施加字符预算（`WEB_SEARCH_MAX_CHARS`，默认 10k，对齐 Exa `contextMaxCharacters`）+ 256KB 字节硬上限（对齐 opencode `MAX_RESPONSE_BYTES`）。
- **DomesticBackend / SearxngBackend**（返回结构化 `SearchResult`）：在 `WebSearchService` 里**格式化成与 Exa 一致的同款文本块**，让模型无论走哪个后端都看到统一形态：
```
Title: <title>
URL: <url>
Published: <published or N/A>
Highlights:
<snippet>
<content 截断>

---

Title: ...
```
- 顶部加一行轻量前缀 `搜索：<query>（后端：<name>）`，其余透传。全文按字符预算截断。

## 6. 集成点（最小改动）

- 新增：`apps/server/src/service/agent/web_search_tool.py`
  - `create_web_search_tool()` 返回 `@tool`；内含 `WebSearchService` 与各 Backend（同文件或拆 `web_search/` 子包，按体量定）。
- 改：`apps/server/src/service/agent/employee.py`
  - import 后，在 `extra_tools = [...]` 之后 `extra_tools.append(create_web_search_tool())`。
- 复用：`src/utils/http_client.py` 的 `create_http_client()` / `create_mcp_http_client()`。
- 配置：`src/core/config.py` 增上述键（带默认）。
- 提示词（可选）：在 worker system prompt 里点一句"查资料优先用 web_search，交互式网页才用 browser-runtime"，强化分工。
- 总管（orchestrator）暂不挂（其职责是规划/派单，不做检索）；若后续需要再加，接口已就绪。

## 7. 错误处理

- 单后端：连接/读超时、非 200、解析失败、空结果 → 记日志，落到下一后端。
- 健康缓存：连续失败的后端在 TTL 内跳过，避免重复白等。
- ContentFetcher：单页失败跳过，不影响列表结果。
- 全链失败：返回 `未能联网搜索（已尝试 exa/domestic）。可改用 browser-runtime 打开具体网址，或检查网络。` —— 文字返回，不抛异常打断 agent。
- 输出始终截断到字符预算，避免撑爆上下文/缓存。

## 8. 测试

单元（pytest，离线、用 fixture）：
- Exa SSE/JSON-RPC 解析：多帧 SSE、`[DONE]`、非 JSON 帧、缺字段。
- 必应/搜狗 HTML 解析：存样例 HTML 为 fixture，断言抽出 title/url/snippet。
- 降级链：第一后端抛异常/空 → 用第二后端；全失败 → 文字兜底。
- 健康缓存：不可达后端在 TTL 内被跳过。
- 截断：超预算被裁到上限。
- ContentFetcher：单页失败跳过、正文截断。

集成（网络，打 marker 默认跳过）：
- 实跑 Exa 一次、必应国内版一次，断言非空。

> worktree 内运行：依赖需自装；后端测试 filter 名 `boban-staff`；电管侧用 node:test，本工具是 Python，用 pytest。

## 9. 开放决策（实现期定，已有倾向）

1. **国内后端 HTML 解析**：标准库优先 vs 引入 `beautifulsoup4`。倾向：先标准库，脆了再上 bs4。
2. **Exa 默认是否启用**：默认放进降级链首位（能连就赚到，连不上靠健康缓存快速跳过）vs 默认只 domestic、Exa 需显式开启。倾向：默认 `exa,domestic`，靠健康缓存消解"连不上白等"。
3. **正文补全开关**：默认 `fetch_content=True`。重查询多时可由 agent 关掉以求快。
