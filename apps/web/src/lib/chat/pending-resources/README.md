# pending-resources

工具流式写入尚未落盘的资源，与 API 资源列表合并展示。

## 模块

| 文件 | 职责 |
|------|------|
| `types.ts` | `PendingResource`、`UpsertPendingResourceInput` |
| `paths.ts` | 虚拟路径、bucket、三棵资源树根 |
| `path-stability.ts` | 流式 path 是否可进树、展示名 |
| `merge.ts` | 去重、合并进资源树、按 path 查找 |
| `preview-streaming.ts` | 按文件类型解析 `StreamingPreviewMode` |
| `preview.ts` | `getPendingPreviewState`（流式占位 vs live 预览） |
| `sync-from-tool.ts` | 工具侧 upsert / clear / invalidate |
| `use-conversation-pending-resources.ts` | 面板侧订阅与 merge |

## 数据链路

```
数据来源                    处理                              展示
─────────────────────────────────────────────────────────────────────────
write_file / edit_file      sync-from-tool.ts                 ArtifactPanel
流式 tool input      →      → artifact-store (pending)   →    · 左侧资源树（merge）
(file_path + content)         merge.ts + path-stability.ts       · 右侧预览（preview.ts）
                            use-conversation-pending-resources
                            + GET /resources（已落盘列表）
```

工具完成后会 `invalidate` 资源接口；API 里已有该文件时自动删掉对应 pending。

## 流式预览策略

`resolveStreamingPreviewMode`：

| 类型 | 流式阶段 |
|------|----------|
| html / document / image / sheet | `placeholder`（骨架屏，不渲染残缺内容） |
| markdown / code | `live`（侧栏实时预览 pending 文本） |

扩展新类型时改 `preview-streaming.ts` 即可。
