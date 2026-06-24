import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  addWorkbenchResource,
  deleteWorkbenchResource,
  listWorkbenchResources,
  uploadWorkbenchResource,
  type WorkbenchResource,
} from "@/api/workbench-resources"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

const resourcesKey = () =>
  ["workbench-resources", getActiveWorkspaceId()] as const

export function useWorkbenchResources() {
  return useQuery<WorkbenchResource[]>({
    queryKey: resourcesKey(),
    queryFn: () => listWorkbenchResources(),
  })
}

export function useAddWorkbenchResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: addWorkbenchResource,
    onSuccess: () => qc.invalidateQueries({ queryKey: resourcesKey() }),
  })
}

export function useUploadWorkbenchResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { file: File; title?: string }) =>
      uploadWorkbenchResource(args.file, args.title),
    onSuccess: () => qc.invalidateQueries({ queryKey: resourcesKey() }),
  })
}

export function useDeleteWorkbenchResource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteWorkbenchResource(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: resourcesKey() }),
  })
}
