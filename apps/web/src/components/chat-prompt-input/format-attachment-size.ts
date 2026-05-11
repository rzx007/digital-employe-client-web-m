const ONE_MB_BYTES = 1024 * 1024

export function formatAttachmentDisplaySize(bytes: number): string {
  if (bytes < ONE_MB_BYTES) {
    const kb = bytes / 1024
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`
  }
  const mb = bytes / ONE_MB_BYTES
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}
