# 用户自定义头像上传 — 设计文档

日期：2026-06-13
状态：已批准（方案 A）

## 需求

用户能在账号设置页上传图片作为自己的头像，替换当前「按 userId % 10 选预设图」的伪头像。

## 决策（已确认）

- **存储位置**：本地数字员工后端（Python FastAPI），不碰 ai-sys-node、不动 user 表。
- **关联键**：userId（文件名 = `{userId}.{ext}`）。
- **上传入口**：账号设置页 `account-settings.tsx` 的 size-16 圆形头像区。
- **约束**：png/jpg/jpeg/webp，≤5MB。
- **跨设备**：不跨设备（换机/重装头像丢、回退预设图），已接受。
- **回显机制**：方案 A —— 后端静态 URL + 前端 `<img>` onError 回退预设图。

## 架构

```
账号设置页头像（点击）
 → 文件选择器（accept=image/png,jpg,jpeg,webp）
 → 前端校验类型/大小
 → POST /avatars/{userId}  (multipart, 字段名 file)
 → 后端校验 + 存 ~/.digital-employee/avatars/{userId}.{ext}（同 userId 覆盖旧图）
 → 返回 { code, avatar_url }
 → 前端刷新头像（带 cache-bust 时间戳强制重取）

回显（任意位置）：
 getUserAvatarSrc(userId) → GET /avatars/{userId}
 <img src=...> onError → 回退预设图 USER_AVATARS[userId%10]
```

## 后端（apps/server）

新增 `src/api/avatar_api.py`，两个端点：

- `POST /avatars/{user_id}`：接收 multipart `file`（`UploadFile`）。校验 content-type ∈ {png,jpeg,webp}、大小 ≤5MB。落盘 `AVATAR_DIR/{user_id}.{ext}`，先删同 user_id 的其它扩展名旧文件（避免 png→jpg 残留）。返回 `{code:1, avatar_url:"/avatars/{user_id}"}`。
- `GET /avatars/{user_id}`：查 `AVATAR_DIR` 下 `{user_id}.*`，存在则 `FileResponse` 返回，不存在 `404`。

存储目录：复用现有用户数据根（`~/.digital-employee/`，与 checkpoints/local-skills 同级）下新增 `avatars/`。目录在写入前 `mkdir(parents=True, exist_ok=True)`。

路由注册：`src/api/__init__.py` 挂上 avatar router（无 require_capability 限制，或按现有 oauth/login 同款 capability——上传需登录态，但本地后端不校验 token，沿用现有无鉴权风格）。

## 前端（apps/web）

1. **`src/api/avatar.ts`（新）**：
   - `uploadAvatar(userId, file): Promise<{avatar_url}>` —— FormData POST，走 request.ts 的 base（dev `/actus`、打包同源）。
   - `getAvatarUrl(userId): string` —— 拼出 `GET /avatars/{userId}` 的完整 URL（用 getServerBaseUrl）。

2. **`src/lib/avatar.ts`**：`getUserAvatarSrc` 保持返回预设图（作为兜底），新增思路是「调用方用后端 URL 作 src + onError 回退」。提供一个小组件或在 account-settings 内联处理。

3. **`src/components/settings/account-settings.tsx`**：
   - 头像区改为可点击 + 隐藏 `<input type=file>`。
   - `<img src={后端头像URL?cb=ts}>`，onError 时 `src` 切到 `USER_AVATARS[userId%10]`。
   - 选图 → 校验 → uploadAvatar → 成功后更新 cache-bust ts 触发重取 + toast 提示。

4. **侧栏等其它用 `getUserAvatarSrc` 的位置**：本期可保持预设图，或同样改为后端 URL+回退。先只改账号设置页（YAGNI），其它位置作为可选后续。

## 错误处理

- 前端：类型不符/超 5MB → 不发请求，toast 提示。
- 后端：校验失败返回 4xx + msg；落盘失败 500。
- 回显：GET 404 → `<img>` onError 自然回退预设图，无报错。

## 测试/验证

- 后端：`py_compile`；起后端后 curl POST 一张测试图 → GET 取回 → 200。
- 前端：`tsc --noEmit`；浏览器 dev 实测点头像上传、刷新后仍在、换设备模拟（删文件）回退预设图。

## 非目标（YAGNI）

- 不裁剪/不缩略图（直接存原图，≤5MB 可接受）。
- 不跨设备同步。
- 不改 ai-sys-node / user 表。
- 不做员工（数字员工）头像自定义——本期只做登录用户本人头像。
