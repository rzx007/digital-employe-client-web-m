export const modelKeys = {
  all: ["model"] as const,
  runtimeConfig: () => [...modelKeys.all, "runtime-config"] as const,
  registry: () => [...modelKeys.all, "registry"] as const,
  catalog: () => [...modelKeys.all, "catalog"] as const,
  availableCatalog: () => [...modelKeys.all, "available-catalog"] as const,
}
