# Activation 代码引用清单

本文整理 `apps/server`、`apps/license-issuer`、`packages/activation-core`
三部分的代码引用关系，便于排查「签发/验签/激活门控」链路。

## 1) 模块边界与依赖方向

- `packages/activation-core`：纯密码学与设备码格式化工具（底层）
- `apps/server`：客户端运行时激活（设备指纹、状态、持久化、API、中间件）
- `apps/license-issuer`：管理员签发工具（CLI / exe）

依赖方向（单向）：

`apps/server` -> `packages/activation-core`  
`apps/license-issuer` -> `packages/activation-core`

`apps/server` 与 `apps/license-issuer` 之间无代码级互相 import。

### 文字图：三模块依赖

```
                    ┌─────────────────────────────────────┐
                    │   packages/activation-core          │
                    │   license / device / expiry         │
                    │   sign_license · verify_license     │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │ import             │ import             │
              ▼                    │                    ▼
┌─────────────────────────┐        │        ┌─────────────────────────┐
│ apps/server             │        │        │ apps/license-issuer     │
│ 运行时验签 + 门控       │        │        │ 管理员签发 CLI / exe    │
│ device 指纹 · storage   │        │        │ issue · verify · keys   │
└─────────────────────────┘        │        └─────────────────────────┘
         │                           │                    │
         │ 无互相 import             │                    │
         └───────────────────────────┴────────────────────┘
                    通过「同一套密钥 + 授权码格式」对齐
```

---

## 2) activation-core 清单（被 server / issuer 共同引用）

路径：`packages/activation-core/src/activation_core/`

- `license.py`
  - 错误类型：`LicenseError`、`LicenseSignatureError`、
    `LicenseDeviceMismatchError`、`LicenseExpiredError`
  - 核心函数：`generate_keypair()`、`sign_license()`、
    `parse_payload()`、`verify_license()`
- `device.py`
  - `normalize_device_code()`、`format_device_code()`
- `expiry.py`
  - `parse_expires()`（`+30d` / 日期 / ISO 时间解析）
- `__init__.py`
  - 统一 re-export 上述 API，供上层直接 `from activation_core import ...`

### 文字图：activation-core 内部

```
activation_core/
├── license.py ────── generate_keypair / sign_license / verify_license
│                    LicenseError · LicenseExpiredError · ...
├── device.py ─────── normalize_device_code / format_device_code
├── expiry.py ─────── parse_expires (+30d / 日期 / ISO)
└── __init__.py ───── 统一 re-export（issuer 常用顶层 import）
```

---

## 3) server 清单（运行时激活）

### 3.1 core 层

路径：`apps/server/src/core/activation/`

- `device.py`
  - 计算本机设备码（运行时指纹）
  - 引用 `activation_core.device` 的格式/归一化函数
- `keys.py`
  - 读取公钥：`ACTIVATION_PUBLIC_KEY_PEM` 或
    `apps/server/src/core/activation/public_key.pem`
- `storage.py`
  - `activation.json` 的唯一 IO 点（读/写/删）
- `policy.py`
  - 是否强制激活：`is_activation_enforced()`
- `license.py`
  - 对 `activation_core.license` 的薄 re-export
- `__init__.py`
  - 聚合 exports（policy/keys/license/device）

### 3.2 service / gateway / middleware / API

- `apps/server/src/service/activation_service.py`
  - 核心编排（状态查询、激活、过期判定、设备绑定、持久化）
  - 直接依赖 `src.core.activation.*`
- `apps/server/src/core/activation_gateway.py`
  - 单点 enforcement：`ensure_activated()`
  - 供中间件与依赖注入调用
- `apps/server/src/middleware/activation_middleware.py`
  - 非白名单路由激活拦截（403）
- `apps/server/src/api/activation_api.py`
  - HTTP：`/activation/device`、`/activation/status`、`/activation/activate`
- `apps/server/src/api/system_api.py`
  - `/system/runtime` 中拼接激活状态
- `apps/server/src/server.py`
  - 按 `is_activation_enforced()` 决定是否挂载激活中间件
- `apps/server/src/core/runtime_capabilities.py`
  - 暴露 `activation_enforced` 能力位给前端
- `apps/server/src/core/deps.py`
  - 可通过依赖注入调用 `ActivationGateway.ensure_activated()`

### 文字图：server 分层与调用链

```
HTTP 入口
├── activation_api.py ── GET  /activation/device|status
│                        POST /activation/activate
├── system_api.py ────── GET  /system/runtime (含 activation 块)
└── (其它业务 API) ───── 经 activation_middleware 拦截

                    │
                    ▼
         ActivationService (service/activation_service.py)
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
 policy.py      keys.py        storage.py
 (是否强制)     (公钥 PEM)     (activation.json)
     │              │              │
     └──────┬───────┴──────┬───────┘
            ▼              ▼
       device.py      license.py ──► activation_core
    (本机指纹)         (re-export)

中间件 / 网关
activation_middleware ──► ActivationGateway.ensure_activated()
                                    │
                                    └──► ActivationService.get_status()
```

### 文字图：server 挂载点

```
server.py
  └── is_activation_enforced() ?
        ├── true  → 挂载 ActivationMiddleware
        └── false → 不挂载

runtime_capabilities.py
  └── capabilities.activation_enforced → 前端/Electron 读取
```

---

## 4) license-issuer 清单（管理员签发）

路径：`apps/license-issuer/src/license_issuer/`

- `service.py`
  - `KeyService`
    - `generate_keypair()`（生成私钥/公钥）
    - `read_public_key()`（由私钥导出公钥）
  - `IssueService`
    - `issue()`：调用 `activation_core.parse_expires + sign_license`
    - `verify()`：调用 `activation_core.verify_license`
- `config.py`
  - 私钥/公钥路径解析（同目录优先、env 覆盖、兼容回退）
- `cli.py`
  - Typer 命令入口：`keys generate` / `keys export-public` /
    `issue` / `verify`
- `models.py`
  - `IssueResult`、`KeypairPaths`
- `__main__.py`
  - `de-license` 启动入口（调用 `cli.app()`）

### 文字图：license-issuer 调用链

```
de-license (Typer)
    │
    ├── cli.py
    │     ├── keys generate  ──► KeyService.generate_keypair()
    │     ├── keys export-public ──► KeyService.read_public_key()
    │     ├── issue ─────────► IssueService.issue()
    │     └── verify ────────► IssueService.verify()
    │
    ├── config.py ── resolve_private_key / resolve_public_key
    │                 (同目录 private_key.pem 优先)
    │
    └── service.py
          ├── KeyService  ──► activation_core.generate_keypair
          └── IssueService ──► activation_core.parse_expires
                               activation_core.sign_license
                               activation_core.verify_license
```

---

## 5) 关键引用关系（跨模块）

### 5.1 server -> activation-core

- `apps/server/src/core/activation/license.py`
  - re-export `activation_core.license`
- `apps/server/src/core/activation/device.py`
  - 引用 `activation_core.device` 的格式函数

### 5.2 license-issuer -> activation-core

- `apps/license-issuer/src/license_issuer/service.py`
  - 引用 `activation_core` 顶层导出的：
    `format_device_code`、`generate_keypair`、`parse_expires`、
    `sign_license`、`verify_license`

### 5.3 server 内部调用链（运行时）

`activation_api.py` -> `ActivationService` -> `core/activation/*`  
`activation_middleware.py` -> `ActivationGateway` -> `ActivationService`

### 文字图：端到端（签发 → 激活 → 拦截）

```
管理员侧                         客户端侧
────────                         ────────

de-license issue                 用户复制设备码
  │                                │
  │ private_key.pem                │ GET /activation/device
  ▼                                ▼
activation_core.sign_license    ActivationService.get_device_code()
  │                                │
  │ 授权码                         │ POST /activation/activate
  └──────────► 用户粘贴 ─────────► ActivationService.activate()
                                       │
                                       ├─ verify_license (公钥)
                                       └─ write activation.json

后续业务请求
  │
  ▼
ActivationMiddleware
  │
  ├─ 白名单 /activation/* /system/runtime → 放行
  └─ 其它路径 → ActivationGateway → get_status()
                    │
                    ├─ activated=true  → 200
                    └─ activated=false → 403
```

### 文字图：密钥对齐关系

```
组织密钥对（一对）
├── private_key.pem ──► license-issuer（签发，不进客户端）
└── public_key.pem  ──► apps/server/.../public_key.pem（验签，可入库）

签发私钥 + 客户端公钥 必须匹配，否则 verify 失败
```

---

## 6) 常用排查入口

- 签发正确但客户端激活失败：
  - 先看 `apps/server/src/core/activation/keys.py`（公钥来源）
  - 再看 `apps/server/src/service/activation_service.py`（设备码/验签）
- 删除 `activation.json` 后行为：
  - 看 `apps/server/src/core/activation/storage.py`
  - 看 `apps/server/src/core/activation/policy.py`
  - 看 `apps/server/src/middleware/activation_middleware.py`
- issuer 路径与私钥读取：
  - 看 `apps/license-issuer/src/license_issuer/config.py`
  - 看 `apps/license-issuer/src/license_issuer/cli.py`
