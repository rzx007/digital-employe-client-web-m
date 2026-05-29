import { QueryClient } from "@tanstack/react-query"

let queryClient: QueryClient | null = null

export function createAppQueryClient(): QueryClient {
  return new QueryClient()
}

export function setQueryClient(client: QueryClient): void {
  queryClient = client
}

export function getQueryClient(): QueryClient {
  if (!queryClient) {
    throw new Error("QueryClient not initialized")
  }
  return queryClient
}
