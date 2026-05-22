import { useContext } from "react"
import { CuratorFileContext } from "./curator-file-context"

export function useCuratorFile() {
  return useContext(CuratorFileContext)
}
