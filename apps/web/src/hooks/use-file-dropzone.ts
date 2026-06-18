import * as React from "react"

interface UseFileDropzoneOptions {
  /** 松手后回调拖入的第一个文件 */
  onDrop: (file: File) => void
  /** 禁用时忽略拖放（如上传中） */
  disabled?: boolean
}

interface UseFileDropzoneResult {
  isDragging: boolean
  dropProps: {
    onDragEnter: (e: React.DragEvent<HTMLElement>) => void
    onDragOver: (e: React.DragEvent<HTMLElement>) => void
    onDragLeave: (e: React.DragEvent<HTMLElement>) => void
    onDrop: (e: React.DragEvent<HTMLElement>) => void
  }
}

/**
 * 通用文件拖放交互。只负责把拖进来的文件交出来——校验/上传由调用方决定，
 * 以便头像、员工头像等不同场景各自带校验逻辑复用同一交互。
 *
 * 用进入/离开计数（dragEnterCount）抵消子元素冒泡造成的高亮闪烁：
 * 拖过子元素时父元素会连续收到 dragOver/dragLeave，仅当计数归零才算真正离开。
 */
export function useFileDropzone({
  onDrop,
  disabled,
}: UseFileDropzoneOptions): UseFileDropzoneResult {
  const [isDragging, setIsDragging] = React.useState(false)
  const dragDepth = React.useRef(0)

  const reset = React.useCallback(() => {
    dragDepth.current = 0
    setIsDragging(false)
  }, [])

  const onDragEnter = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault()
      if (disabled) return
      // 进入/离开成对，子元素冒泡也各算一次，故用计数而非布尔
      dragDepth.current += 1
      setIsDragging(true)
    },
    [disabled],
  )

  const onDragOver = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      // dragOver 悬停期间高频触发，只用来阻止默认行为（否则 Electron 会直接打开图片），
      // 绝不在这里计数，否则计数暴涨、leave 永远归不了零，高亮卡住。
      e.preventDefault()
    },
    [],
  )

  const onDragLeave = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault()
      if (disabled) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setIsDragging(false)
    },
    [disabled],
  )

  const handleDrop = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault()
      reset()
      if (disabled) return
      const file = e.dataTransfer?.files?.[0]
      if (file) onDrop(file)
    },
    [disabled, onDrop, reset],
  )

  return {
    isDragging,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop: handleDrop },
  }
}
