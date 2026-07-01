export function run(argv: string[], baseUrl?: string): Promise<void>

export function execute(
  argv: string[],
  baseUrl?: string,
  opts?: { batchMode?: boolean },
): Promise<{ ok: boolean; error?: string; data?: unknown; code?: string } | undefined>

export function parseFlags(argv: string[]): {
  args: string[]
  flags: Record<string, string | boolean | number | undefined>
}

export function parseFindRequest(
  rest: string[],
  flags: Record<string, string | boolean | number | undefined>,
): {
  strategy: string
  query: string
  action: string
  valueRest: string[]
  nth?: number
}
