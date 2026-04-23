import { useQuery } from "@tanstack/react-query"

import { fetchRuntimeModelConfig } from "@/api/model"
import { modelKeys } from "@/lib/query-keys/model"

export function useRuntimeModelConfigQuery() {
  return useQuery({
    queryKey: modelKeys.runtimeConfig(),
    queryFn: fetchRuntimeModelConfig,
  })
}
