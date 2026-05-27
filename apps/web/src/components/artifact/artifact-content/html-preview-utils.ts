/** Artifact HTML 预览 iframe sandbox：允许脚本与常见交互（产物预览，用户自担风险） */
export const HTML_PREVIEW_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-modals"

/** 将 HTML 片段包裹为可在 iframe srcDoc 中渲染的完整文档 */
export function wrapHtmlForPreview(content: string): string {  if (/<!DOCTYPE|<html[\s>]/i.test(content)) {
    return content
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"></head><body>${content}</body></html>`
}
