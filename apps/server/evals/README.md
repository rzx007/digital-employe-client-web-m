# 数字员工评估集（解锁提示词内容大改的安全网）

收敛"双份真理"、给总管提示词"抬海拔"、下沉工具机制、去冗余等**提示词内容改写**
最容易"按下葫芦浮起瓢"——删一条规则可能让某类行为悄悄回退。动这批改动**前**，
先有这套回归门。分两层：

| 层 | 文件 | 防什么 | 成本 | 何时跑 |
|----|------|--------|------|--------|
| **L1 提示词不变量** | `tests/test_prompt_invariants.py` | 改写时**误删关键指令**（工具名/参数名/结构锚点丢失） | 确定性·秒级 | 每次 `pytest`，进 CI |
| **L2 行为评估集** | `evals/`（本目录） | 改写后**模型行为漂移**（指令在但行为变） | 需真模型 | 改提示词前后各跑一遍对比 |

L1 是最实用的那道门：它断言 `submit_clarifying_questions`、`task_id/employee_id/plan_id`、
`confirm_orchestration_plan`、cron 语义、品牌名"博般"等**忠实重构会保留、过度删改会丢**
的锚点。改完提示词只要 `pytest tests/test_prompt_invariants.py` 变红，就说明删过头了。

---

## L1：怎么用

```bash
cd apps/server
uv run pytest tests/test_prompt_invariants.py -q     # 当前应全绿（基线）
# —— 做你的提示词改写（双份真理收敛 / 抬海拔 / 去冗余）——
uv run pytest tests/test_prompt_invariants.py -q     # 红了就说明误删了某行为指令
```

红了之后两种处理：① 确实误删 → 补回；② 有意改写措辞但行为保留 → 更新对应断言
（断言尽量锚在工具名/参数名上，正常重构不该触发）。

---

## L2：怎么用（需配模型端点）

L2 跑真 agent、用 `build_chat_model` 起裁判，需要可用的 LLM 端点
（`DEEPAGENT_MODEL` / `BASE_URL`，与业务同一出口，如本地 llama.cpp）。

```bash
cd apps/server
uv run python -m evals.run --list                    # 只列用例，不跑（无需端点）
uv run python -m evals.run --out report_before.json  # 改提示词【前】跑一遍存档
# —— 做你的提示词改写 ——
uv run python -m evals.run --out report_after.json   # 改【后】再跑
# 对比两份报告：rule_passed 不能掉、各 rubric 均分不能掉，才上线
```

单例调试：`uv run python -m evals.run --case cron-once-semantics`

### 评分口径
- **规则检查点**（`expect`）是**硬门**：工具是否被调/输出含否/是否触发 HITL 中断，
  任一不满足即该例 fail。确定性。
- **rubric**（裁判 1-5 分）是**软分**：单裁判 + 单条 rubric、只评终态。用于趋势对比，
  不做绝对阈值。

### 用例 schema
见 `cases.yaml` 顶部注释。新增用例后，`tests/test_evals_dataset.py` 会校验 schema、
id 唯一、引用的工具名真实存在——所以**写坏会在 CI 红**。

---

## 模块职责

| 文件 | 作用 | 是否依赖模型/DB |
|------|------|----------------|
| `cases.yaml` | ~20 行为用例（输入 + 规则检查点 + rubric） | 否（纯数据） |
| `checks.py` | 规则检查点求值（纯函数） | 否 |
| `judge.py` | rubric 裁判（构造消息 + 解析分数 + 调模型） | 仅打分需模型 |
| `run.py` | 加载用例→跑→打分→出报告；`extract_agent_result` 解析终态 | 跑需要，解析纯函数 |
| `harness.py` | **live 适配器**：建临时 DB、按 setup 预置员工、ainvoke 真 agent 图 | **需模型 + DB** |

> ⚠️ `harness.py` 是唯一需在配好端点的环境里**联调验证**的部分（agent 调用约定、
> HITL 中断返回形态可能随 deepagents/langgraph 版本微调）。其余模块均已离线单测
> （`tests/test_evals_dataset.py`、`tests/test_prompt_invariants.py`）。

## 后续可扩展
- 用例集随发现的失败模式生长（文档建议 ~20 起步，够用即可）。
- 委派契约加"非目标"后（§E），`multi-employee-split` 用例补对应规则。
- 前端/方案"验证层"落地后（文档2 §F），可加"产出物自检"类用例。
