const encoder = new TextEncoder()

export function createMockSSEStream(
  sseText: string,
  options?: { delay?: number; chunkDelay?: number }
): ReadableStream<Uint8Array> {
  const { delay = 30, chunkDelay = 60 } = options ?? {}
  const events = sseText
    .trim()
    .split(/\n\n+/)
    .filter((event) => event.trim())

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const event of events) {
        await new Promise((resolve) => setTimeout(resolve, chunkDelay))
        const payload = event.trim() + "\n\n"
        controller.enqueue(encoder.encode(payload))
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      controller.close()
    },
    cancel() {},
  })
}
