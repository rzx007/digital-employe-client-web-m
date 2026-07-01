import * as React from "react"

/** 须与列表网格类名 `min-[1600px]:grid-cols-4` 同步 */
export const SKILL_GRID_WIDE_BREAKPOINT_PX = 1600

export const SKILLS_GRID_CLASS =
  "grid grid-cols-3 gap-4 min-[1600px]:grid-cols-4"

export const SKILLS_REMOTE_GRID_CLASS =
  "grid auto-rows-fr grid-cols-3 gap-4 min-[1600px]:grid-cols-4"

function getSkillGridColumnCount(): number {
  if (typeof window === "undefined") return 3
  return window.innerWidth >= SKILL_GRID_WIDE_BREAKPOINT_PX ? 4 : 3
}

export function useSkillGridColumnCount(): number {
  const [cols, setCols] = React.useState(getSkillGridColumnCount)
  React.useEffect(() => {
    const query = `(min-width: ${SKILL_GRID_WIDE_BREAKPOINT_PX}px)`
    const mql = window.matchMedia(query)
    const sync = () => setCols(mql.matches ? 4 : 3)
    sync()
    mql.addEventListener("change", sync)
    return () => mql.removeEventListener("change", sync)
  }, [])
  return cols
}
