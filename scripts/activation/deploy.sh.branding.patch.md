# deploy.sh —— 品牌资源包目录拷贝（白标 / 多版本）

> 2026-06-29。背景：客户端支持「品牌资源包」——logo(png/svg) + 文字(brand.json) 运行时可热替换，
> 工程人员换文件即出不同品牌版本（如国网版），无需重新打包。详见
> [`apps/web/branding/README.md`](../../apps/web/branding/README.md)。

## 客户端侧（已进仓库）

- `branding/` 整个目录经 `extraResources` 装进安装目录 `resources/branding/`
  （`default/` 兜底 + 各品牌示例）。
- app 启动时按顺序解析品牌目录：
  `DE_BRANDING_DIR` > `<exeDir>/branding/` > `resources/branding/active/` > `resources/branding/default/`。
- 因此**部署侧只要把选定品牌拷进 `resources/branding/active/`**，app 即按该品牌显示。

安装目录（deb）一般是 `/opt/BobanStaff/resources/branding/`。

## deploy.sh 需新增的步骤

部署包（Installer 目录）下放一个 `branding/` 文件夹，里面就是某品牌的
`brand.json` + logo（结构同 `apps/web/branding/<brand>/`）。`deploy.sh` 增加
一个 `stage_branding()`，在装完客户端 deb 之后执行。

> 下面这版**已在 220 真机实测通过**（2026-06-29，0.1.30 deb）：函数定义插在
> `main()` 之前，调用插在 `stage_digital_employee` 的分隔线之后、`stage_activation` 之前。
> 用 `run_step` 跑拷贝（与其它 stage 一致：spinner + 计时 + 日志），单独 `record` 一次
> （**不**用 `&& record OK || record WARN` 反模式——deploy.sh 的 `record()` 末行返回值
> 会让该反模式误报 WARN，见 deploy.sh.boban-rename.patch.md）。

```bash
stage_branding() {
  info "品牌资源包"
  local src="${INSTALLER_DIR}/branding"
  local res="${APP_RESOURCES:-/opt/BobanStaff/resources}"
  local dst="${res}/branding/active"

  if [[ ! -f "$src/brand.json" ]]; then
    ok "未提供品牌包（${src}/brand.json 不存在），使用客户端内置默认"
    record branding OK "使用内置默认品牌"
    return 0
  fi
  if [[ ! -d "$res/branding" ]]; then
    warn "客户端未内置 branding 目录（${res}/branding 缺失），跳过"
    record branding WARN "客户端无 branding 目录" "升级客户端到含品牌资源包的版本(0.1.30+)"
    return 0
  fi

  mkdir -p "$dst"
  local rc
  if command -v rsync >/dev/null 2>&1; then
    run_step branding "应用品牌资源包 → active/" -- rsync -a --delete "$src/" "$dst/"
    rc=$?
  else
    rm -rf "${dst:?}/"* 2>/dev/null || true
    run_step branding "应用品牌资源包 → active/" -- cp -a "$src/." "$dst/"
    rc=$?
  fi

  if [[ $rc -ne 0 ]]; then
    record branding WARN "应用品牌失败(rc=$rc，见日志)"
    return 0
  fi
  local name
  name="$(python3 -c "import json;print(json.load(open('$dst/brand.json')).get('productName',''))" 2>/dev/null)"
  ok "品牌已应用：${name:-未知}"
  record branding OK "已应用品牌：${name:-未知}"
}
```

调用点（`main()` 内，已实测的位置）：
```bash
  stage_digital_employee
  echo; hr '─'
  stage_branding          # ← 新增
  echo; hr '─'            # ← 新增
  stage_activation
```
`record` / `info` / `ok` / `warn` / `run_step` 沿用 deploy.sh 既有函数。
`$INSTALLER_DIR` 即脚本所在目录；安装资源根实测为 `/opt/BobanStaff/resources`。

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
