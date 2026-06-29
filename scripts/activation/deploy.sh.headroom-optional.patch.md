# deploy.sh / docker-compose.yml —— headroom 压缩网关「选装」

> 2026-06-26。把 headroom 压缩网关从「随 compose 默认启动」改为 **deploy.sh 可控的选装件**。
> 方案核心：**端口接管**——app 端点永远 `:12345` 不变，由 deploy.sh 决定 `:12345` 后面
> 是 hanhai 直连还是 headroom 网关，**完全不碰 app 配置 / sqlite DB**（绕开数据目录
> `.digital-employee` / `.boban-staff-next` 未迁移的坑）。

## 背景

- headroom（`ghcr.io/chopratejas/headroom:latest`，无损压缩网关，数据型任务实测 ~20%）
  原本在 `docker-compose.yml` 里无 profile，`compose up -d` 会**默认启动**。
- 但 app 出厂 `config-kv.init.json` 的 hanhai `base_url` 是 `http://localhost:12345/v1`
  ——**直连模型**。所以 headroom 虽起着却**不在数据路径上**，纯空转。
- 需求：headroom 改为 deploy.sh 控制的选装件，离线一体机只从打包进去的 tar 载入（不联网 pull）。

## 端点接管原理

app 永远连 `:12345`。deploy.sh 用两个 compose 端口变量切换谁监听 `:12345`：

| 模式 | hanhai 发布端口 | headroom | app 连 :12345 实际到达 |
|---|---|---|---|
| **默认 off** | `${HANHAI_HOST_PORT:-12345}` → 12345 | 不起（profile 未激活） | hanhai 直连 |
| **WITH_HEADROOM=1** | `HANHAI_HOST_PORT=12399` | `HEADROOM_HOST_PORT=12345`，转发 hanhai 内网 8080 | headroom → hanhai |

健康检查 `:12345/v1/models` 两种模式都通（headroom 会代理）。

## docker-compose.yml 改动（runtime/docker-compose.yml）

```yaml
hanhai-llm:
  ports:
    - "${HANHAI_HOST_PORT:-12345}:8080"     # 原 "12345:8080"
headroom-gateway:
  profiles: ["headroom"]                     # 新增：默认不随 compose up 起
  ports:
    - "${HEADROOM_HOST_PORT:-8787}:8787"     # 原 "8787:8787"
```

## deploy.sh 改动（stage_model 段 + 新增函数）

```bash
# headroom 镜像（选装）：只从打包进去的离线 tar 载入，不联网 pull。
ensure_headroom_image() {
  local t="${IMAGE_TAR_DIR}/headroom-arm64.tar"
  if [[ -f "$t" ]]; then
    run_step headroom_image "载入 headroom 镜像 (...)" -- docker load -i "$t" \
      || record headroom_image WARN "headroom 镜像载入失败"
  else
    warn "缺 images/headroom-arm64.tar，headroom 网关将无法启动"
  fi
}

# stage_model 里 compose up：
local _hr_env=() _hr_prof=()
if [[ "${WITH_HEADROOM:-0}" == "1" ]]; then
  ensure_headroom_image
  _hr_env=(HANHAI_HOST_PORT=12399 HEADROOM_HOST_PORT=12345)
  _hr_prof=(--profile headroom)
fi
run_step compose "启动模型服务容器" -- env "${_hr_env[@]}" docker compose -f "$COMPOSE_FILE" "${_hr_prof[@]}" up -d ...
```

用法：`sudo WITH_HEADROOM=1 bash deploy.sh` 启用；默认（不带）不装、hanhai 直连。

## 打包（pack-installer.sh，已进仓库）

`headroom-arm64.tar`（~580M）改为**进核心包**、从模型包排除——选装件不绑巨大的模型包：

```bash
# 核心包：
[[ -f images/headroom-arm64.tar ]] && zip -q "$core" images/headroom-arm64.tar ...
# 模型包：排除 headroom
find images -type f -name '*.tar' ! -name 'headroom-*.tar' ...
```

## 验证（220 真机）

- `bash -n` 通过；`set -u` 下空数组 `"${_hr_env[@]}"` 不报 unbound。
- `compose config`：off → hanhai 发布 12345；on → hanhai 12399 + headroom 12345。
- 核心包重打（`SKIP_MODEL=1`）：477M，含补丁版 deploy.sh + headroom-arm64.tar + 补丁版 compose。

## 备份（220）

- `deploy.sh.bak.preheadroomopt`
- `runtime/docker-compose.yml.bak.preheadroomopt`
- `pack-installer.sh.bak.preheadroomcore`（在 /home/boban/）
