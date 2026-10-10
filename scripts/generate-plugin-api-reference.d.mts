export function assertMembers(label: string, actual: string[], expected: string[]): void

export function generatePluginApiReference(
  root: string,
  options?: { check?: boolean }
): Promise<{
  hostServices: number
  clientServices: number
  namespaces: number
  remoteMethods: number
  files: number
}>
