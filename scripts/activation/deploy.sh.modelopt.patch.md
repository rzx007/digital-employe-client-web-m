# deploy.sh 模型可选改动记录

> 220 真机 `/home/boban/BobanStaff-Installer/deploy.sh` 本次改动（2026-06-17）。
> deploy.sh 是安装包产物，不在 git；本文件记录改了哪几处，供溯源。

## 备份
- `deploy.sh.bak.premodelopt-20260617`（改前，782 行）
- 改后 800 行，`bash -n` 通过。

## 改动点（3 处）

1. **inventory()**：模型 / 镜像来源**从 die 改为 warn + 设全局 `HAS_MODEL` 标志**。
   - 无 `Hanhai-Q4.gguf`（runtime 或运行期）→ `HAS_MODEL=0` + warn。
   - 无可用镜像来源（已加载 / 离线 tar / 联网）→ `HAS_MODEL=0` + warn。
   - `HAS_MODEL=0` 时 warn「只装数字员工，跳过本地模型；装好后在应用内配模型地址」+ `record model SKIP`。
   - compose 缺失仍 die（它在核心包，正常不缺）。

2. **main()**：模型相关阶段条件执行。
   ```
   inventory
   if [[ "${HAS_MODEL:-1}" == 1 ]]; then
     provision_runtime; stage_model
   fi
   stage_digital_employee
   ```
   无模型时跳过 provision_runtime + stage_model；数字员工/激活/cli/桌面/输入法照跑。

3. **finalize()**：`HAS_MODEL=0` 时收尾加提示「本机未安装本地模型，请在数字员工应用内配置模型服务地址」。

## 验证（220 真机）
- 语法 `bash -n` SYNTAX_OK。
- 隔离临时目录演练：无 gguf 无镜像 → `HAS_MODEL=0`；有 gguf+tar → `HAS_MODEL=1`。两场景均符合预期。
- 机器真实模型态未受影响（用临时目录测分支，未动真实 runtime）。

## 关联
- 设计：`docs/superpowers/specs/2026-06-17-installer-split-model-optional-design.md`
- 拆包脚本：`scripts/release/pack-installer.sh`
- 发布 SOP：`docs/installer-release-sop.md`
