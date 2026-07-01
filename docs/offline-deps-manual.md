# 离线依赖注入（文档类 Skill）操作手册

## 这是什么

文档类内置 skill（`docx` / `pdf` / `pptx` / `xlsx`）的脚本通过 `shell_execute` 运行
`python scripts/...`，需要 `python-docx`、`openpyxl`、`python-pptx`、`pypdf` 等
Python 库。联网机器可以临时 `pip install`，**离线机器装不了**，这些 skill 就用不了。

本功能让运维在离线机器上**预先把这些库放到一个目录**，程序启动时自动把它注入
`PYTHONPATH`，使 skill 的 python 子进程能 import 到——无需联网。

**解释器（Python 本身）不在本功能范围内**：离线机器需自带系统 Python 并在 `PATH` 上
（可用内置的 `env-steward` 数字员工安装）。本功能只负责"库"。

实现位置：`apps/web/electron/features/backend/backend-process.ts` 的
`getOfflineDepsEnv()`，与 `browserctl` 的环境注入同一套机制。

---

## 工作原理（一句话）

设了环境变量 `OFFLINE_DEPS_DIR` 且其下存在 `python/` 子目录时，程序启动 backend
进程时把 `<OFFLINE_DEPS_DIR>/python` **前置**追加到 `PYTHONPATH`；backend 进程
（`inherit_env=True`）再把它透传给每次 `shell_execute` 的子进程。

> backend.exe 自身是 PyInstaller frozen 程序，隔离模式下不读 `PYTHONPATH`，
> 所以注入只作用于 skill 子进程，不影响后端自身。

未设置该变量、或 `python/` 不存在时，功能**完全关闭、零副作用**。

---

## 部署步骤

### 1. 在一台「联网 + 系统环境与离线机一致」的机器上准备库

关键：编译型包（`Pillow`、`lxml`、`numpy` 等）带平台/Python 版本相关的二进制，
**准备机的 OS、CPU 架构、Python 大版本必须和离线机一致**（例如都为 Windows x64 +
Python 3.12），否则离线机上 import 会失败。

```bash
# 装到 <目标目录>/python（这里以 D:\offline-deps 为例）
pip install --target=D:\offline-deps\python ^
  python-docx openpyxl python-pptx pypdf pdfplumber reportlab Pillow "markitdown[all]"
```

> 按实际需要增减包。最小可用集（读取/生成 Office 文档）通常是
> `python-docx openpyxl python-pptx pypdf`。

产物目录形如：

```
D:\offline-deps\
  python\
    docx\            (python-docx)
    openpyxl\
    pptx\            (python-pptx)
    pypdf\
    ...
```

### 2. 把整个目录拷到离线机器

例如拷到离线机的 `D:\offline-deps\`（路径任意，下一步用环境变量指过去即可）。

### 3. 在离线机器上设置环境变量 `OFFLINE_DEPS_DIR`

指向**包含 `python/` 的那一层**（不是指到 `python/` 本身）。

- **GUI**：此电脑 → 属性 → 高级系统设置 → 环境变量 → 新建用户变量
  - 变量名：`OFFLINE_DEPS_DIR`
  - 变量值：`D:\offline-deps`
- **命令行（用户级，持久）**：

  ```cmd
  setx OFFLINE_DEPS_DIR "D:\offline-deps"
  ```

> ⚠️ `setx` 只对**之后新开**的进程生效。设置后必须**完全退出并重启本程序**
> （含已在后台的进程），新启动的 backend 才会读到。

### 4. 确认离线机器有系统 Python 且在 PATH 上

```cmd
python --version
```

没有就先用 `env-steward` 数字员工安装，或运维手动装。

### 5. 重启程序，验证

- 启动后让某个数字员工执行一个文档类任务（例如"读取这个 docx 的内容"）。
- 或看 backend 日志，应有一行：`injecting offline deps into PYTHONPATH ...`。

---

## 验证命令（在离线机器上手动核对库是否就位）

```cmd
set PYTHONPATH=D:\offline-deps\python
python -c "import docx, openpyxl, pptx, pypdf; print('offline deps OK')"
```

打印 `offline deps OK` 即说明库已可被系统 Python 加载，程序内的 skill 也就能用。

---

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 日志没有 `injecting offline deps...` | `OFFLINE_DEPS_DIR` 没设、或设完没重启程序、或其下没有 `python/` 子目录。 |
| skill 仍报 `ModuleNotFoundError: No module named 'xxx'` | 该包没装进 `python/`；补 `pip install --target=...\python xxx`。 |
| import 报 `DLL load failed` / `invalid ELF` 之类 | 编译型包平台/Python 版本不匹配。用与离线机一致的环境重新 `--target` 准备。 |
| `python` 不是内部或外部命令 | 离线机没装系统 Python 或不在 PATH。先装解释器（env-steward）。 |
| 已有自定义 `PYTHONPATH` 会被覆盖吗 | 不会，是**前置**追加，原值保留在后。 |

---

## 流程速记

- 运维流程：联网机 pip install --target=D:\offline-deps\python ... → 拷到离线机 → setx - OFFLINE_DEPS_DIR "D:\offline-deps" → 重启程序。
- 解释器仍靠离线机自带（env-steward 装）；本功能只管库。
- 默认关闭，不设变量时对现有在线行为零影响。

## 范围与后续

- **本期只做 `python/` → `PYTHONPATH`。**
- `node_modules/` → `NODE_PATH`、`bin/` → `PATH`（用于 `soffice`/`pandoc`/`tesseract`
  等）暂未实现。将来需要时，在 `getOfflineDepsEnv()` 里按同样模式扩展即可：
  检测 `<OFFLINE_DEPS_DIR>/node_modules`、`<OFFLINE_DEPS_DIR>/bin` 是否存在，
  分别前置注入对应环境变量。
