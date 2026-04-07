import type { AnomalyRecord } from "@/types/schedule-monitor"

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

export function generateAnomalies(_employeeId: string): AnomalyRecord[] {
    return [
        {
            id: "anomaly-1",
            taskRunId: "run-2",
            taskName: "邮件分类整理",
            type: "timeout",
            message: "执行超时，已等待 30s 未收到响应",
            occurredAt: new Date(new Date().setHours(10, 0, 12, 0)).toISOString(),
            resolved: false,
        },
        {
            id: "anomaly-2",
            taskRunId: "run-3",
            taskName: "数据同步检查",
            type: "error",
            message: "Connection refused: 后端服务不可达",
            occurredAt: new Date(new Date().setHours(8, 30, 0, 0)).toISOString(),
            resolved: false,
        },
        {
            id: "anomaly-3",
            taskRunId: "run-5",
            taskName: "客户跟进提醒",
            type: "duplicate",
            message: "检测到重复执行，与 08:59:58 的任务重复",
            occurredAt: new Date(new Date().setHours(9, 0, 1, 0)).toISOString(),
            resolved: true,
        },
    ]
}

export function formatTaskDuration(ms: number | null): string {
    if (ms == null) return "-"
    return formatDuration(ms)
}

