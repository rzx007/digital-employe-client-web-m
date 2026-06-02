# 环境管家员工（env-steward）实施稿

本文档是最终实施版本，用于直接指导开发与验收。

## 1. 目标与范围

### 1.1 目标

- 提供一个普通数字员工「环境管家」，用于检测和安装基础运行环境
- 覆盖 `Python / Node.js / Git / curl` 的缺失、版本不兼容、命令不可用场景
- 复用现有 `shell_execute + HITL` 链路，不新增后端接口
- 支持用户明确同意后的国内镜像配置（阿里云 PyPI、npmmirror）
- 依赖网络的步骤先探测网络，不可用时给出明确反馈

### 1.2 非范围

- 不做 `venv / conda` 管理
- 不做 IDE 配置修复
- 不新增设置页“运行环境”Tab
- 不新增 `GET /system/environment` API

### 1.3 管理对象

| 工具 | 检测命令 | 建议版本 |
|---|---|---|
| Python | `python --version` / `python3 --version` | 3.11 / 3.12 |
| pip | `<python_cmd> -m pip --version` | 随 Python |
| Node.js | `node --version` | 20 / 22 LTS |
| npm | `npm --version` | 随 Node.js |
| Git | `git --version` | 最新稳定版 |
| curl | `curl --version` | 系统内置或最新版 |

---

## 2. 架构与交付物

### 2.1 架构形态

- 员工类型：普通员工（与现有种子员工同构）
- 员工名称：`环境管家`
- 技能 ID：`env-steward`
- 运行方式：通过现有 `shell_execute` 工具执行命令（带 HITL）

### 2.2 交付文件

| 类型 | 路径 | 说明 |
|---|---|---|
| 新增 | `apps/server/build-in-skills/env-steward/SKILL.md` | 技能定义与工作流 |
| 修改 | `apps/server/src/service/employee_service.py` | 在内置种子员工列表加入环境管家，并在 seed 前防御式同步内置技能 |
| 修改 | `apps/server/src/service/workspace_service.py` | 已初始化 workspace 也执行种子员工幂等补齐（增量发布可见） |

---

## 3. SKILL 实施规范

### 3.1 Frontmatter

```yaml
---
name: env-steward
description: 跨平台检测与安装 Python / Node.js / Git / curl，并在用户同意后配置 pip/npm 国内镜像。
---
```

### 3.2 执行工作流（必须遵守）

1. **Step 0 - 网络探测（仅在联网操作前）**
   - 仅检测版本时跳过
   - install/upgrade/镜像切换前先探测目标源
   - 示例命令：
     - macOS/Linux: `curl -I --connect-timeout 5 <target_url>`
     - Windows: `curl.exe -I --connect-timeout 5 <target_url>`
   - 失败处理：明确反馈“网络不可达，当前无法执行”，并建议重试/换网

2. **Step 1 - 平台检测**
   - macOS/Linux: `uname -s && uname -m`
   - Windows: `ver` 与 `echo %PROCESSOR_ARCHITECTURE%`

3. **Step 2 - 工具检测**
   - Python：先 `python --version`，失败再 `python3 --version`
   - pip：`<python_cmd> -m pip --version`
   - Node.js / npm：`node --version`、`npm --version`
   - 结果以表格输出：工具、是否安装、版本、路径、状态

4. **Step 3 - 澄清（必须 `submit_clarifying_questions`）**
   - 目标版本
   - 是否同意系统级安装（管理员/sudo）
   - 无权限时是否接受手动安装链接
   - 是否同意切换 pip/npm 国内镜像（用户级）

5. **Step 4 - 计划（必须 `submit_document_plan`）**
   - 列出命令、预期输出、耗时、失败回滚策略

6. **Step 5 - 执行（每条命令都走 HITL）**
   - 必填 `intent`
   - 快命令直接执行；超时命令按 §4 变通方案执行

7. **Step 6 - 可选镜像配置（用户明确同意后）**
   - pip（阿里云）：
     - `<python_cmd> -m pip config set --user global.index-url https://mirrors.aliyun.com/pypi/simple`
     - `<python_cmd> -m pip config set --user global.trusted-host mirrors.aliyun.com`
   - npm（npmmirror）：
     - `npm config set registry https://registry.npmmirror.com --location=user`
   - 回滚（优先恢复旧值）：
     - 执行前先读并缓存旧值：
       - `<python_cmd> -m pip config get global.index-url`
       - `npm config get registry`
     - 若无法恢复旧值，再回官方：
       - `<python_cmd> -m pip config unset global.index-url`
       - `<python_cmd> -m pip config unset global.trusted-host`
       - `npm config set registry https://registry.npmjs.org --location=user`

8. **Step 7 - 最终验证**
   - 再次执行版本检测命令
   - 若改过镜像，验证：
     - `<python_cmd> -m pip config get global.index-url`
     - `npm config get registry`

### 3.3 三平台安装命令

| 工具 | Windows | macOS | Debian/Ubuntu | RHEL/Fedora | Arch |
|---|---|---|---|---|---|
| Python | `winget install Python.Python.3.12`（fallback `choco install python3`） | `brew install python@3.12` | `sudo apt update && sudo apt install -y python3.12` | `sudo dnf install -y python3.12` | `sudo pacman -S python` |
| Node.js | `winget install OpenJS.NodeJS.LTS` | `brew install node@20` | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install -y nodejs` | `sudo dnf install -y nodejs` | `sudo pacman -S nodejs npm` |
| Git | `winget install Git.Git` | `brew install git` / `xcode-select --install` | `sudo apt install -y git` | `sudo dnf install -y git` | `sudo pacman -S git` |
| curl | `winget install cURL.cURL`（旧版系统） | 系统内置 | `sudo apt install -y curl` | `sudo dnf install -y curl` | `sudo pacman -S curl` |

---

## 4. 关键技术约束：30s 超时

`shell_execute` 默认 30s 超时。检测命令通常可直接执行，安装命令通常会超时。

### 4.1 方案 A（推荐）：后台启动 + 轮询

**Windows (PowerShell)**

```powershell
$log = "$env:USERPROFILE\.digital-employee\logs\install-python.log"
$p = Start-Process winget -ArgumentList "install","Python.Python.3.12" -RedirectStandardOutput $log -RedirectStandardError $log -PassThru
while (-not $p.HasExited) { Start-Sleep -Seconds 2; $p.Refresh(); Write-Output "still installing..." }
Get-Content $log -Tail 20
```

**macOS/Linux (bash)**

```bash
nohup brew install python@3.12 > ~/.digital-employee/logs/install-python.log 2>&1 &
echo $! > ~/.digital-employee/logs/install-python.pid
while kill -0 "$(cat ~/.digital-employee/logs/install-python.pid)" 2>/dev/null; do sleep 2; echo "still installing..."; done
tail -20 ~/.digital-employee/logs/install-python.log
```

### 4.2 方案 B：拆分启动

- Windows：`Start-Process winget ...`
- macOS/Linux：`nohup ... &`
- 然后提示用户稍后验证结果

---

## 5. 代码实施（当前实际方案）

### 5.1 修改 `employee_service.py`

- 在 `_BUILTIN_SEED_EMPLOYEES` 增加：
  - 名称：`环境管家`
  - 技能：`env-steward`
  - 描述：环境诊断与修复
- 在 `ensure_builtin_seed_employees(...)` 开头调用
  `LocalSkillService.seed_builtin_skills()`，确保新增内置技能目录可见。

### 5.2 修改 `workspace_service.py`

- 在 `ensure_workspace_initialized(...)` 中，若检测到已有总管（说明已初始化）：
  - 仍执行 `EmployeeService.ensure_builtin_seed_employees(db, workspace)`
  - 再返回
- 目的：增量发布新增种子员工时，老 workspace 无需重建也能补齐。

---

## 6. 实施步骤与验收

### 6.1 实施步骤

1. 新建 `apps/server/build-in-skills/env-steward/SKILL.md`
2. 修改 `apps/server/src/service/employee_service.py`
3. 修改 `apps/server/src/service/workspace_service.py`
4. 本地冒烟验证（员工出现、可检测、可安装、可镜像配置）

### 6.2 验收清单

- [ ] 重启后默认工作空间自动出现“环境管家”
- [ ] 能正确输出 Python/Node/Git/curl 检测结果
- [ ] 安装类命令通过 HITL 确认后执行
- [ ] 长耗时安装不因 30s 超时直接失败（走后台方案）
- [ ] 断网时给出明确反馈而非静默失败
- [ ] pip/npm 镜像可设置并可读回
- [ ] 镜像回滚优先恢复旧值，旧值缺失时回官方源

### 6.3 最小自动化测试草案（建议补齐）

建议在 `apps/server/tests/` 增加以下用例：

1. `test_seed_contains_env_steward`
   - 断言 `_BUILTIN_SEED_EMPLOYEES` 中存在 `("环境管家", ("env-steward",), ...)`

2. `test_workspace_initialized_backfill_seed_when_curator_exists`
   - 构造已有 curator 的 workspace
   - 调用 `WorkspaceService.ensure_workspace_initialized(...)`
   - 断言会触发 `ensure_builtin_seed_employees(...)`（可通过 spy/mock）

3. `test_env_steward_created_after_seed`
   - 调用 `LocalSkillService.seed_builtin_skills()` + `ensure_builtin_seed_employees(...)`
   - 断言 workspace 下存在 name=`环境管家` 的员工

---

## 7. 风险与处置

| 风险 | 处置 |
|---|---|
| 安装命令超时 | 强制使用后台启动 + 轮询 |
| LLM 直接执行高风险命令 | 必须走澄清与计划步骤（HITL） |
| 包管理器/包名漂移 | 提供 fallback 与手动安装链接 |
| 无网络导致安装/镜像失败 | 先探测目标源，失败即反馈并建议重试 |
| 覆盖用户已有镜像配置 | 执行前读取旧值，回滚优先恢复旧值 |

---

## 8. 参考

- [AGENTS.md](../AGENTS.md)
- [docs/tool-intent-and-shell-execute-prd.md](./tool-intent-and-shell-execute-prd.md)
- [apps/server/src/service/employee_service.py](../apps/server/src/service/employee_service.py)
- [apps/server/src/service/agent/shell_execute_tool.py](../apps/server/src/service/agent/shell_execute_tool.py)
- [apps/server/src/service/skill_shell_backend.py](../apps/server/src/service/skill_shell_backend.py)
