import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  getExternalDirMode,
  setExternalDirMode,
  type ExternalDirMode,
} from "@/api/conversation"

function externalDirModeKey(conversationId: string | number | null) {
  return ["external-dir-mode", conversationId != null ? String(conversationId) : null]
}

export function useExternalDirMode(
  conversationId: string | number | null | undefined
) {
  const id = conversationId != null ? conversationId : null
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: externalDirModeKey(id),
    queryFn: async () => {
      return getExternalDirMode(id!)
    },
    enabled: id != null,
    staleTime: 30_000,
  })

  const mutation = useMutation({
    mutationFn: async (mode: ExternalDirMode) => {
      if (id == null) throw new Error("conversationId is required")
      return setExternalDirMode(id, mode)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: externalDirModeKey(id) })
    },
  })

  return {
    mode: query.data,
    isLoading: query.isLoading,
    setMode: (mode: ExternalDirMode) => mutation.mutate(mode),
  }
}
