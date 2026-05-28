```
pending-resources/
  types.ts                          # PendingResource、Upsert 入参
  paths.ts                          # 三棵树根、normalize、bucket 判定
  merge.ts                          # 树合并、find、resolve
  preview.ts                        # 预览用 pending/API 切换标志
  sync-from-tool.ts                 # useSyncPendingResourceFromTool
  use-conversation-pending-resources.ts  # 面板侧：订阅、merge、落库去重
  index.ts                          # 统一导出
```
