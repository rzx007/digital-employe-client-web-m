const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

/** 根据到期时间生成提醒文案；超出 warningDays 返回 null。 */
export function buildActivationExpiryToast(
  expiresAt: string,
  warningDays = 7,
): string | null {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) {
    return "授权已过期，请重新激活"
  }
  if (ms > warningDays * MS_PER_DAY) {
    return null
  }

  const days = Math.ceil(ms / MS_PER_DAY)
  if (days <= 1) {
    const hours = Math.ceil(ms / MS_PER_HOUR)
    if (hours <= 1) {
      const minutes = Math.max(1, Math.ceil(ms / MS_PER_MINUTE))
      return `授权将在约 ${minutes} 分钟后到期，请尽快联系管理员续签`
    }
    return `授权将在约 ${hours} 小时内到期，请尽快联系管理员续签`
  }

  return `授权将在 ${days} 天后到期，请提前联系管理员续签`
}
