# 激活脚本（仓库维护）

需求与架构总览：[docs/offline-activation.md](../../docs/offline-activation.md)。

管理员签发请使用独立工具：[`apps/license-issuer/README.md`](../../apps/license-issuer/README.md)（`de-license` CLI / 二进制）。

| 脚本 | 用途 |
|------|------|
| [`embed-public-key.py`](embed-public-key.py) | 将导出的 `public_key.pem` 拷贝到 `apps/server/src/core/activation/` |

旧版 `issue_license.py` / `generate_keys.py` 已移除，由 `de-license` 替代。
