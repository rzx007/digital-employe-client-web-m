/**
 * 主进程视口测量与 CSS→DIP 换算。
 * DOM 测量逻辑须与 `apps/web/src/lib/browser/viewport-bounds.ts` 保持一致。
 */

export interface CssViewportBox {
  left: number
  top: number
  width: number
  height: number
}

export interface DipViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 在 main.webContents 中 executeJavaScript 执行 */
export const MEASURE_BROWSER_VIEWPORT_SCRIPT = `(() => {
  const el = document.querySelector('[data-browser-viewport]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  const panel = el.closest('[data-browser-panel]');
  const footer = panel?.querySelector('[data-browser-footer]');
  let height = Math.floor(r.height);
  if (footer) {
    const footerTop = footer.getBoundingClientRect().top;
    height = Math.max(0, Math.floor(footerTop - r.top));
  }
  return {
    left: r.left,
    top: r.top,
    width: r.width,
    height,
  };
})()`

/** getBoundingClientRect 为 CSS px；View.setBounds 需要 DIP */
export function cssViewportBoxToDipBounds(
  box: CssViewportBox,
  zoomFactor: number
): DipViewportBounds {
  return {
    x: Math.round(box.left * zoomFactor),
    y: Math.round(box.top * zoomFactor),
    width: Math.max(0, Math.floor(box.width * zoomFactor)),
    height: Math.max(0, Math.floor(box.height * zoomFactor)),
  }
}
