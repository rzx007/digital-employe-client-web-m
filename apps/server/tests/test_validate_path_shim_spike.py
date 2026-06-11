"""Spike：钉死 deepagents 绝对路径校验与 backend 能力，指导删 shim 的替代实现。

执行：uv run pytest tests/test_validate_path_shim_spike.py -v -s
读 -s 的打印结论，不强制断言（探针）。
"""


def test_probe_validate_path_symbols():
    from deepagents.middleware import filesystem as fsm
    from deepagents.backends import utils as bu

    print("\n[probe] fsm module file =", fsm.__file__)
    print("[probe] fsm has '_validate_path'? =", hasattr(fsm, "_validate_path"))
    print("[probe] fsm has 'validate_path'? =", hasattr(fsm, "validate_path"))
    print("[probe] bu has 'validate_path'? =", hasattr(bu, "validate_path"))
    print("[probe] bu has '_validate_path'? =", hasattr(bu, "_validate_path"))

    # 哪个符号、是否拒绝绝对路径
    for name in ("_validate_path", "validate_path"):
        fn = getattr(fsm, name, None)
        if fn is None:
            continue
        raised = False
        try:
            out = fn(r"D:\space\foo.txt")
        except ValueError as e:
            raised = True
            out = f"ValueError: {e}"
        print(f"[probe] fsm.{name}(D:\\...) -> raised={raised} out={out!r}")


def test_probe_localshell_backend_capabilities(tmp_path):
    from deepagents.backends import LocalShellBackend

    b = LocalShellBackend(root_dir=str(tmp_path), virtual_mode=False)
    for attr in ("read", "write", "edit", "ls_info", "als_info", "download_files", "aread"):
        print(f"[probe] LocalShellBackend.{attr} =", hasattr(b, attr))
