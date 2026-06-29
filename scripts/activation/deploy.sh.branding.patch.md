# deploy.sh —— 品牌资源包目录拷贝（白标 / 多版本）

> 2026-06-29。背景：客户端支持「品牌资源包」——logo(png/svg) + 文字(brand.json) 运行时可热替换，
> 工程人员换文件即出不同品牌版本（如国网版），无需重新打包。详见
> [`apps/web/branding/README.md`](../../apps/web/branding/README.md)。

## 客户端侧（已进仓库）

- `branding/` 整个目录经 `extraResources` 装进安装目录 `resources/branding/`
  （`default/` 兜底 + 各品牌示例）。
- app 启动时按顺序解析品牌目录：
  `DE_BRANDING_DIR` > `resources/branding/active/` > `resources/branding/default/`。
- 因此**部署侧只要把选定品牌拷进 `resources/branding/active/`**，app 即按该品牌显示。

安装目录（deb）一般是 `/opt/BobanStaff/resources/branding/`。

## deploy.sh 需新增的步骤

部署包（Installer 目录）下放一个 `branding/` 文件夹，里面就是某品牌的
`brand.json` + logo（结构同 `apps/web/branding/<brand>/`）。`deploy.sh` 增加
一个 `stage_branding()`，在装完客户端 deb 之后执行：

```bash
# 安装根：deb 装在 /opt/BobanStaff，资源在 /opt/BobanStaff/resources
APP_RESOURCES="${APP_RESOURCES:-/opt/BobanStaff/resources}"

stage_branding() {
  info "品牌资源包"
  local src="${INSTALLER_DIR:-$(dirname "$0")}/branding"
  local dst="${APP_RESOURCES}/branding/active"

  # 部署包没带 branding/ → 跳过，用打包内 default
  if [[ ! -f "$src/brand.json" ]]; then
    ok "未提供品牌包，使用内置默认"
    record branding OK "使用内置默认品牌"
    return 0
  fi

  mkdir -p "$dst"
  # rsync 优先（增量 + 删除多余文件）；无 rsync 退回 cp
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src"/ "$dst"/
  else
    rm -rf "$dst"/* 2>/dev/null || true
    cp -a "$src"/. "$dst"/
  fi

  local name
  name="$(python3 -c "import json;print(json.load(open('$dst/brand.json')).get('productName',''))" 2>/dev/null)"
  ok "已应用品牌：${name:-未知}"
  record branding OK "已应用品牌：${name:-未知}"
}
```

调用点：在 `stage_digital_employee`（装客户端 deb）成功之后调用 `stage_branding`。
`record` / `info` / `ok` 沿用 deploy.sh 既有的总结/日志函数。

## 工程人员做国网版的流程

1. 准备 `branding/` 目录：`brand.json` 文字改成国网，`logo.png` 换国网 logo
   （字段见 `apps/web/branding/README.md`）。
2. 把该 `branding/` 放进部署包（与 deb 同级）。
3. 跑 `deploy.sh`：自动拷到 `resources/branding/active/`，重启 app 即国网版。
4. 想还原默认：删掉 `resources/branding/active/` 即可（回退打包内 default）。

## 验证

- `DE_BRANDING_DIR=/path/to/branding /opt/BobanStaff/bobanstaff`（或对应可执行名）
  可在不动安装文件的前提下临时验证某品牌。
- 装完后检查 `/opt/BobanStaff/resources/branding/active/brand.json` 内容与 logo 是否为目标品牌。
