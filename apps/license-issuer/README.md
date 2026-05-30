# license-issuer（de-license）

管理员离线激活授权签发工具，独立于客户端 FastAPI 栈。

业务与架构总览见 [docs/offline-activation.md](../../docs/offline-activation.md)。

## 私钥放在哪（重要）

客户端只认仓库里的 **`apps/server/src/core/activation/public_key.pem`**。  
所有签发员必须使用**与这对公钥匹配的同一组织私钥**，不要各自 `keys generate`。

**推荐分发方式**：与 `de-license.exe` **同目录**放置 `private_key.pem`：

```text
release/
  de-license.exe
  private_key.pem    ← 组织私钥（勿提交 Git、勿打进 exe）
```

`issue` / `export-public` 会**优先**读取该目录下的 `private_key.pem`；若不存在，再回退 `~/.digital-employee-admin/private_key.pem`。

组织私钥由密钥保管人通过内网盘 / 密码库 / U 盘等方式下发，**不要**提交到本仓库。

## 开发

```powershell
# 在仓库根目录
uv sync
cd apps/license-issuer
uv run de-license --help
```

开发时也可把 `private_key.pem` 放在 `apps/license-issuer/` 目录（与 `uv run de-license` 的默认查找目录一致）。

## 常用命令

```powershell
# 仅组织首次建钥或轮换时执行（由密钥保管人操作）
uv run de-license keys generate --out-dir .\release

# 轮换时：导出公钥并更新客户端仓库后重打离线包
uv run de-license keys export-public -o ..\server\src\core\activation\public_key.pem

# 签发（默认同目录 private_key.pem）
cd release
.\de-license.exe issue --device "用户设备码" --expires +365d

# 自测（默认同目录 public_key.pem，或 --public-key 指向客户端公钥）
.\de-license.exe verify --license "..." --device "用户设备码" `
  --public-key ..\server\src\core\activation\public_key.pem
```

## 打包二进制

```powershell
pnpm build:license-issuer
# 产物：apps/license-issuer/release/de-license.exe
```

打包后，将组织下发的 `private_key.pem` 拷贝到 `release/` 再分发给管理员。

私钥**不要**打进 exe；可选 `--private-key` 或环境变量 `DE_LICENSE_PRIVATE_KEY`。
