export const modelKeys = {
  all: ["model"] as const,
  runtimeConfig: () => [...modelKeys.all, "runtime-config"] as const,
}
