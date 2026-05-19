# 示例插件 (com.example.demo)

将本目录**整体复制**到扩展安装目录：

```text
~/.digital-employee/extensions/com.example.demo/
├── digital-employee.extension.json
└── ui/
    └── index.html
```

在数字员工客户端：**设置 → 插件** 中启用并打开。

## 开发态

若插件 UI 使用独立 dev server，可设置环境变量（将 `.` 替换为 `_` 并大写）：

```bash
set EXTENSION_DEV_COM_EXAMPLE_DEMO=http://127.0.0.1:5199/
pnpm --filter digital-employee dev:app
```

或在 manifest 中配置 `ui.devEntry`（仅非打包环境生效）。
