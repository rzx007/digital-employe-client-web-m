# 国内可达的技能下载：ghproxy 加速 + 多域名轮询

日期：2026-06-12
文件：`apps/server/src/service/skillsmp_service.py`

## 问题

国内（无梯子）环境下，从 GitHub 安装 skillsmp 技能慢到不可用。已用真实数据定位根因：

| 路径 | 国内无梯子 | 备注 |
|------|-----------|------|
| skillsmp `github-contents` 代理 | 可达但**限流**，第二次请求即 403 | 现有代码逐文件递归 → 自己撞限流 → 崩 → 退到直连兜底 |
| 直连 `api.github.com` / codeload | **走不动**（超时） | 现有兜底链在国内是死路 |
| ghproxy（`gh-proxy.com`） | **可达且快** | 实测能代理 api(trees) + raw 两类请求 |

**关键事实**：skillsmp 后端**没有"一次返回 zip"的接口**。社区工具（skillsmp-mcp-lite、agent-skills-cli）下载技能用的都是 "GitHub trees API 拿全树 + 逐文件并发取 + 本地自打包 zip"，skillsmp `/api/v1` 只用于 search。之前"让代理吐 zip"的方向作废。

## 实测数据（2026-06-12，本机）

各技能极小：`gitcrawl` 1.7KB（含 1 子目录）、`crabbox` 31KB、`openclaw-ghsa-maintainer` 2.9KB。瓶颈是**请求次数 + 串行 + 国内不可达**，不是带宽。

ghproxy 域名能力矩阵：

| 域名 | trees(api) | raw | 两用 |
|------|-----------|-----|------|
| gh-proxy.com | 200 ✅ | 200 ✅ | **是** |
| ghproxy.net | 403 | 200 ✅ | 仅 raw |
| ghfast.top | 403 | 200 ✅ | 仅 raw |
| gh.llkk.cc / moeyy / ghproxy.cc / mirror.ghproxy.com | 失效 | 失效 | 否 |

结论：**多数公共 ghproxy 只代理 raw、不代理 api，且大量失效** → 必须多域名轮询、且按用途区分；首选 `gh-proxy.com`。

## 方案

新增首选下载路径 `_fetch_via_ghproxy`，替代 skillsmp 代理成为 `fetch_skill_file_map` 的第一选择。skillsmp 代理降级为次选，GitHub 直连保留为最终兜底（有梯子时有用）。

```
fetch_skill_file_map(github_url)
  1) _fetch_via_ghproxy(parsed)            ← 新增，首选（国内可达）
       a. 清单：ghproxy + api.github.com/repos/{o}/{r}/git/trees/{ref}?recursive=1
          一次请求拿全树 → 过滤 subpath 下的 blob
       b. 内容：每个文件 ghproxy + raw.githubusercontent.com/{o}/{r}/{ref}/{path}
          10 并发取，单文件失败跳过并 warn
  2) _fetch_via_skillsmp_github_contents   ← 次选（限流，仅当一次拿到 zip/内联时有用）
  3) _fetch_via_github_api / _fetch_via_repo_zip  ← 兜底（直连 GitHub，有梯子才行）
```

## 组件

### 配置 `_ghproxy_hosts()`
- 内置默认 `["https://gh-proxy.com"]`（实测唯一两用）。
- env `SKILL_GHPROXY_HOSTS`（逗号分隔）覆盖；KV `skill_ghproxy_hosts` 覆盖。
- 与现有 `_direct_github_fallback_enabled()` 同款读取模式。

### `_ghproxy_get(client, target_url, hosts) -> httpx.Response | None`
- 依次拼 `f"{host}/{target_url}"` GET；200 返回 response；非 200/异常则下一个 host。
- 全部失败返回 None（调用方决定抛错或跳过）。

### `_fetch_via_ghproxy(parsed) -> dict[str, str]`
1. 拼 trees url，`_ghproxy_get` 拿全树 JSON（`tree` 数组）。失败 → 抛 `SkillsMpError` 退次选。
2. 过滤 `type=="blob"` 且 path 在 `parsed.subpath` 下的文件，去掉 `.` 开头文件，得相对路径列表。复用 `MAX_SKILL_FILES` 上限。
3. `httpx` 10 并发取每个文件的 raw（`_ghproxy_get`）；utf-8 解码失败/取不到则跳过 warn。累计 `MAX_SKILL_BYTES` 上限。
4. `_normalize_skill_file_map(file_map)` 收尾（保证有 SKILL.md）。

并发实现：沿用社区工具的"分批 + asyncio/线程"模式。本服务是同步 httpx，用 `concurrent.futures.ThreadPoolExecutor(max_workers=10)` 跑批，简单且与现有同步风格一致。

## 错误处理
- host 轮询：每个失败转下一个；全失败 → `SkillsMpError` → 落次选/兜底。
- 单文件取不到：跳过 + `logger.warning`（沿用 `_collect_github_entries_recursive` 现有行为）。
- 体积/数量超限：复用现有 `MAX_SKILL_FILES` / `MAX_SKILL_BYTES`，超限抛错提示手动导入。

## 测试
单测（monkeypatch `httpx`）：
1. **host 轮询**：首个 host 返回 403，次个 200 → 用次个结果。
2. **subpath 过滤**：trees 含全仓文件，只取目标技能目录下的。
3. **并发组 map**：多文件并发取齐，组成正确 file_map。
4. **全 host 失败**：trees 全失败 → 抛 `SkillsMpError`（退兜底）。

端到端实测由用户在国内环境完成（开发机 IP 被 Cloudflare 封，测不了真实代理路径）。

## 明确不做（YAGNI）
- 不做整仓 zip（openclaw 仓 60MB，国内也慢）。
- 不删 GitHub 直连兜底（有梯子时有用）。
- 不碰 search 逻辑。
- 不动 skillsmp 代理的 zip 解析分支（降级为次选，无害保留）。
