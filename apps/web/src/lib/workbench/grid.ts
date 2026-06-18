import type { GridSpan, GridPos, GridSpanPreset } from "@/types/workbench"

/** 网格列数（飞书风格 12 列）。 */
export const GRID_COLS = 12

/** 行高（像素），react-grid-layout 的 rowHeight。 */
export const GRID_ROW_HEIGHT = 120

/** 四档标准尺寸：列数 w × 行数 h。 */
export const SPAN_PRESETS: Record<GridSpanPreset, GridSpan> = {
  small: { w: 3, h: 2 },
  medium: { w: 6, h: 3 },
  large: { w: 6, h: 6 },
  full: { w: 12, h: 6 },
}

interface OccupiedRect {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: OccupiedRect, b: OccupiedRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  )
}

/**
 * 在 12 列网格里为一个 span 找第一个不与已占块重叠的左上角位置。
 * 逐行（y 从 0 递增）、逐列（x 从 0 到 GRID_COLS-w）扫描，返回首个空位。
 */
export function findFreeSlot(
  occupied: OccupiedRect[],
  span: GridSpan
): GridPos {
  const maxX = GRID_COLS - span.w
  for (let y = 0; y < 1000; y++) {
    for (let x = 0; x <= maxX; x++) {
      const candidate = { x, y, w: span.w, h: span.h }
      if (!occupied.some((o) => overlaps(o, candidate))) {
        return { x, y }
      }
    }
  }
  return { x: 0, y: 0 }
}
