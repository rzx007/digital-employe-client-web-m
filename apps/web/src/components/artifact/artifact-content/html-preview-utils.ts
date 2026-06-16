/**
 * Artifact HTML 预览 iframe sandbox：允许脚本与表单交互，但**不授予** allow-same-origin /
 * allow-popups。
 *
 * 关键：srcDoc iframe 若带 allow-same-origin，HTML 内的相对引用（如 dashboard_part1.html、
 * 相对 fetch/资源）会解析到 app dev origin（localhost:3399）；该 origin 下未知路径被 Vite
 * SPA 回退成整个 app 的 index.html，于是 app 在 iframe 内重新挂载 → 无限递归 →
 * ERR_INSUFFICIENT_RESOURCES，并把后端打崩。去掉 allow-same-origin 后 iframe 取得不透明源，
 * 相对 URL 不再指向 app origin，从结构上杜绝递归。去掉 allow-popups 则堵死
 * window.open(相对URL) 经主窗口 setWindowOpenHandler 落到内置浏览器再触发 SPA 回退的旁路。
 * allow-scripts 仍在，看板内 JS / 跨域 fetch 内网接口照常工作。
 */
export const HTML_PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-modals"

/**
 * 中性 base 标签。`href="about:blank"` 是真正控制相对 URL **解析**的杠杆：
 * srcDoc 文档默认沿用父文档 base（= app origin），仅去掉 sandbox 的 allow-same-origin
 * 只改 origin、不改 base，无法阻止相对 `<iframe src="part1.html">` 仍解析到 localhost:3399。
 * 显式注入 about:blank base 后，所有相对引用解析到失效源，从根上断掉 SPA 回退递归。
 */
const NEUTRAL_BASE_TAG = '<base href="about:blank" target="_blank">'

/**
 * 将 HTML 包裹/改写为可安全在 iframe srcDoc 中渲染的文档：
 * - 片段 → 包成完整文档并注入中性 base。
 * - 完整文档（总管生成的看板多为此类）→ 也必须注入/前置中性 base，否则其中的相对引用
 *   （如 dashboard_part1.html）会解析到 app origin → Vite SPA 回退 → 整个 app 在 iframe 内
 *   重挂 → 无限递归 → ERR_INSUFFICIENT_RESOURCES + 后端崩。
 */
export function wrapHtmlForPreview(content: string): string {
  const isFullDocument = /<!DOCTYPE|<html[\s>]/i.test(content)
  if (!isFullDocument) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${NEUTRAL_BASE_TAG}</head><body>${content}</body></html>`
  }
  return injectNeutralBase(content)
}

/**
 * 在完整文档里确保第一个生效的 base 是中性 about:blank：
 * 优先插到 <head> 开头（先于文档内任何已有 base/相对资源声明，base 以第一个为准）；
 * 没有 <head> 则退而插到 <html> 后；再没有就整体兜底包一层。
 */
function injectNeutralBase(html: string): string {
  const headOpen = html.match(/<head[^>]*>/i)
  if (headOpen) {
    const idx = headOpen.index! + headOpen[0].length
    return html.slice(0, idx) + NEUTRAL_BASE_TAG + html.slice(idx)
  }
  const htmlOpen = html.match(/<html[^>]*>/i)
  if (htmlOpen) {
    const idx = htmlOpen.index! + htmlOpen[0].length
    return (
      html.slice(0, idx) +
      `<head>${NEUTRAL_BASE_TAG}</head>` +
      html.slice(idx)
    )
  }
  return `<!DOCTYPE html><html><head>${NEUTRAL_BASE_TAG}</head><body>${html}</body></html>`
}
