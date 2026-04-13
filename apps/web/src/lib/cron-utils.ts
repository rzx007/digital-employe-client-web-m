export function parseCronToExecuteTime(
  cronExpression: string | undefined
): string {
  if (!cronExpression) return ""
  const parts = cronExpression.split(" ").filter((p) => p !== "")

  if (parts.length >= 5) {
    const minute = parts[0]
    const hour = parts[1]
    const day = parts[2]
    const month = parts[3]
    const weekday = parts[4]

    if (
      /^\d+$/.test(minute) &&
      /^\d+$/.test(hour) &&
      day === "*" &&
      month === "*"
    ) {
      if (
        weekday === "*" ||
        weekday === "1-5" ||
        weekday === "0,6" ||
        weekday === "6,0"
      ) {
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
      }
    }

    if (day === "*" && month === "*" && weekday === "*") {
      if (minute === "*" && hour === "*") return "1分钟"

      if (minute.startsWith("*/") && hour === "*") {
        const minutes = parseInt(minute.replace("*/", ""))
        return `${minutes}分钟`
      }

      if (minute === "0" && hour === "*") return "1小时"

      if (minute === "0" && hour.startsWith("*/")) {
        const hours = parseInt(hour.replace("*/", ""))
        return `${hours}小时`
      }
    }
  }

  return ""
}

export function executeTimeToCronExpression(
  executeTime: string | undefined,
  cronExpressionType?: string
): string {
  if (!executeTime) return ""

  if (cronExpressionType === "loop") {
    if (executeTime.endsWith("分钟")) {
      const minutes = parseInt(executeTime.replace("分钟", ""))
      if (minutes > 0 && minutes <= 59) {
        if (minutes === 1) return "* * * * *"
        return `*/${minutes} * * * *`
      }
    } else if (executeTime.endsWith("小时")) {
      const hours = parseInt(executeTime.replace("小时", ""))
      if (hours > 0 && hours <= 23) {
        return `0 */${hours} * * *`
      }
    }
    return ""
  }

  const timeMatch = executeTime.match(/^(\d{1,2}):(\d{2})$/)
  if (timeMatch) {
    const hours = parseInt(timeMatch[1])
    const minutes = parseInt(timeMatch[2])
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const timePart = `${minutes} ${hours} * *`
      switch (cronExpressionType) {
        case "weekdays":
          return `${timePart} 1-5`
        case "weekends":
          return `${timePart} 0,6`
        default:
          return `${timePart} *`
      }
    }
  }

  return ""
}
