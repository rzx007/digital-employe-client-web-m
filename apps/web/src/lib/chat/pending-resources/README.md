# pending-resources

工具流式写入尚未落盘的资源，与 API 资源列表合并展示。

## 模块

| 文件 | 职责 |
|------|------|
| `types.ts` | `PendingResource` |
| `paths.ts` | 虚拟路径、bucket、三棵资源树根 |
| `merge.ts` | pending 合并进资源树 |
| `preview-streaming.ts` | 按文件类型解析 `StreamingPreviewMode` |
| `preview.ts` | `getPendingPreviewState`（流式占位 vs live 预览） |
| `sync-from-tool.ts` | 工具侧 upsert / invalidate |
| `use-conversation-pending-resources.ts` | 面板侧订阅与 merge |

## 流式预览策略

`resolveStreamingPreviewMode`：

| 类型 | 流式阶段 |
|------|----------|
| html / document / image / sheet | `placeholder`（骨架屏，不渲染残缺内容） |
| markdown / code | `live`（侧栏实时预览 pending 文本） |

扩展新类型时改 `preview-streaming.ts` 即可。
