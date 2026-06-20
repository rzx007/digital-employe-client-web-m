"""shell 硬底线：灾难级命令永不执行（最后底线，对所有 agent 生效）。

定位（诚实）：这是**进程内启发式底线（floor），不是完整沙箱边界**。它挡住「直接打
灾难命令」（rm -rf / 等），但挡不住「写脚本再跑」之类绕过——真边界需要 OS 沙箱。
与 destructive_hitl（总管 delete_* 工具的人审批）是两层不同机制：这里是**永不执行**、
不走审批，且对**所有** agent（总管亲自干 + 所有员工，含 HITL-off）统一生效。

范围**刻意保守**：只放近零误报的灾难、不可逆操作，绝不挡正常开发命令。
"""
from __future__ import annotations

import re
import unicodedata

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")

# 命令包装前缀：sudo/env 等不改变"真正要跑的命令"，归一化时剥掉以便底线看到本体。
_WRAPPER_PREFIXES = frozenset({
    "sudo", "doas", "nice", "ionice", "nohup", "time", "command",
    "builtin", "exec", "setsid", "stdbuf",
})

# 根/家目录（rm -rf 的灾难目标）；非这些（如 ./build、/tmp/x）一律放行。
_ROOT_TARGETS = frozenset({
    "/", "/*", "/.", "~", "~/", "~/*", "$HOME", "$HOME/", "$HOME/*",
    "${HOME}", "${HOME}/", "${HOME}/*",
})

# 块设备前缀（写入即灾难）。
_BLOCK_DEV_RE = r"/dev/(?:sd|nvme|hd|vd|mmcblk|loop|disk|xvd)"

_FORK_BOMB_RE = re.compile(r":\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:")

# 段内（已按命令分隔符切分，故段起点即命令位置）匹配的灾难模式。
_SEGMENT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # mkfs 须针对块设备才算灾难（mkfs.fat disk.img 造镜像是正常活，不拦）。
    (re.compile(r"^mkfs(?:\.\w+)?\b.*" + _BLOCK_DEV_RE, re.I), "mkfs 格式化块设备"),
    (re.compile(r"^dd\b.*\bof=" + _BLOCK_DEV_RE, re.I), "dd 写入块设备"),
    (re.compile(r"^tee\b.*" + _BLOCK_DEV_RE, re.I), "tee 写入块设备"),
    (re.compile(r"^(?:wipefs|shred)\b.*\s" + _BLOCK_DEV_RE, re.I), "擦除块设备"),
    (re.compile(r"^(?:shutdown|reboot|poweroff|halt)\b", re.I), "关机/重启"),
    (re.compile(r"^init\s+[06]\b", re.I), "init 0/6 关机/重启"),
    (re.compile(r"^chmod\s+-\S*[rR]\S*\s+[0-7]{3,4}\s+/(?:\s|$)"), "chmod -R 改根目录权限"),
    # 重定向写块设备（可出现在段内任意位置）
    (re.compile(r">\s*" + _BLOCK_DEV_RE, re.I), "重定向写入块设备"),
]

# 切分命令分隔符（不含 fork bomb 里的 | & ;，故 fork bomb 单独整串先查）。
_SEPARATOR_RE = re.compile(r"&&|\|\||[;\n|&]")


def normalize_command(cmd: str) -> str:
    """归一化命令文本（用于检测，非用于执行）：去 ANSI、Unicode NFC、去转义反斜杠、
    去空引号对、压空白。目的是看穿 `r\\m`、`r''m`、ANSI 染色 之类的混淆。"""
    if not cmd:
        return ""
    s = unicodedata.normalize("NFC", cmd)
    s = _ANSI_RE.sub("", s)
    s = re.sub(r"\\(.)", r"\1", s)        # 去转义：r\m -> rm
    s = re.sub(r"""(['"])\1""", "", s)     # 去空引号对：r''m -> rm
    s = re.sub(r"/{2,}", "/", s)           # 折叠多斜杠：// -> /（POSIX 等价）
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _strip_wrappers(tokens: list[str]) -> list[str]:
    """剥掉 sudo/env/nice 等包装前缀，露出真正的命令。env 还要跳过其 VAR=val 设置。"""
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t == "env":
            i += 1
            while i < len(tokens) and "=" in tokens[i] and not tokens[i].startswith("-"):
                i += 1
            continue
        if t in _WRAPPER_PREFIXES:
            i += 1
            continue
        break
    return tokens[i:]


# 家目录及 ~user：~ / ~root / ~/ / ~/* / ~root/* 等（但 ~/cache 等子目录不算）。
_HOME_TARGET_RE = re.compile(r"~\w*(?:/\*?)?")


def _is_root_target(token: str) -> bool:
    t = token.replace('"', "").replace("'", "")   # 去所有引号：'"/"*' -> /*
    if t in _ROOT_TARGETS:
        return True
    return bool(_HOME_TARGET_RE.fullmatch(t))


def _is_catastrophic_rm(tokens: list[str]) -> bool:
    """rm 同时带递归+强制、且目标是根/家目录 → 灾难。tokens 须已剥包装前缀。
    否则（含 ./build、/tmp/x、~/cache）放行。"""
    if not tokens or tokens[0] != "rm":
        return False
    flag_blob = "".join(t[1:] for t in tokens if t.startswith("-") and not t.startswith("--"))
    long_flags = {t for t in tokens if t.startswith("--")}
    has_r = "r" in flag_blob or "R" in flag_blob or "--recursive" in long_flags
    has_f = "f" in flag_blob or "--force" in long_flags
    if not (has_r and has_f):
        return False
    targets = [t for t in tokens[1:] if not t.startswith("-")]
    return any(_is_root_target(t) for t in targets)


def check_hardline(cmd: str) -> str | None:
    """命中灾难级硬底线 → 返回简短理由（拒绝执行）；否则 None。容错：异常→None（不误杀）。"""
    try:
        norm = normalize_command(cmd)
        if not norm:
            return None
        if _FORK_BOMB_RE.search(norm):
            return "fork bomb（进程炸弹）"
        for seg in _SEPARATOR_RE.split(norm):
            # 先剥 sudo/env/nice 等包装前缀，露出真正的命令——所有模式都看本体，
            # 杜绝「sudo mkfs」之类靠前缀绕过整套底线。
            tokens = _strip_wrappers(seg.split())
            if not tokens:
                continue
            body = " ".join(tokens)
            if _is_catastrophic_rm(tokens):
                return "rm -rf 根/家目录"
            for rx, label in _SEGMENT_PATTERNS:
                if rx.search(body):
                    return label
        return None
    except Exception:
        return None
