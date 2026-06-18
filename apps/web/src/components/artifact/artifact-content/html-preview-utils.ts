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
 * 构建「运行时拦截脚本」：在看板 HTML 内 patch window.fetch 与 XMLHttpRequest，把对外部
 * http(s) 接口的请求**在调用那一刻**改走本地后端 /proxy（服务端拉取无 CORS）。
 *
 * 为什么运行时拦截而非静态正则改写：看板 HTML 的 fetch 写法千变万化（`fetch(API_BASE + type)`、
 * 模板串、变量拼接、第三方库用 XHR…），静态改写抓不全。运行时 patch 看到的是**最终 URL 字符串**，
 * 与如何构造无关，可靠得多。
 *
 * 作用域：仅 app 内预览生效（导出的 HTML 无此注入，外部浏览器打开仍受第三方 CORS 限制——
 * 那种场景应使用数据内联的快照看板）。仅代理绝对 http(s)、且非本地后端自身的请求。
 */
export function buildProxyInterceptorScript(proxyBaseUrl: string): string {
  // proxyBaseUrl 由本应用提供（getRequestBaseUrl），无注入风险；仍 JSON.stringify 转义。
  const base = JSON.stringify(proxyBaseUrl.replace(/\/$/, ""))
  return `<script>(function(){
  var B=${base};
  if(!B)return;
  var proxyOrigin;try{proxyOrigin=new URL(B).origin}catch(e){proxyOrigin=""}
  function toProxy(u){
    try{
      if(typeof u!=="string")return u;
      if(!/^https?:\\/\\//i.test(u))return u;            // 相对/非 http 不动
      if(proxyOrigin&&u.indexOf(proxyOrigin)===0)return u; // 已是本地后端不套娃
      return B+"/proxy?url="+encodeURIComponent(u);
    }catch(e){return u}
  }
  var of=window.fetch;
  if(of){
    window.fetch=function(input,init){
      try{
        if(typeof input==="string"){return of(toProxy(input),init)}
        if(input&&input.url){return of(new Request(toProxy(input.url),input),init)}
      }catch(e){}
      return of(input,init);
    };
  }
  var XO=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.open;
  if(XO){
    window.XMLHttpRequest.prototype.open=function(method,url){
      try{arguments[1]=toProxy(url)}catch(e){}
      return XO.apply(this,arguments);
    };
  }
})();</script>`
}

/**
 * 将 HTML 包裹/改写为可安全在 iframe srcDoc 中渲染的文档。注入两样东西到 <head> 最前：
 * 1. 中性 base（about:blank）——防相对引用解析到 app origin 引发 SPA 回退递归。
 * 2. 代理拦截脚本（若提供 proxyBaseUrl）——把外部 fetch/XHR 运行时改走后端 /proxy 绕过 CORS。
 *
 * @param content 原始 HTML
 * @param proxyBaseUrl 本地后端基址（如 http://localhost:34567）；空则不注入拦截脚本
 */
export function wrapHtmlForPreview(
  content: string,
  proxyBaseUrl = "",
): string {
  const head =
    NEUTRAL_BASE_TAG +
    (proxyBaseUrl ? buildProxyInterceptorScript(proxyBaseUrl) : "")
  const isFullDocument = /<!DOCTYPE|<html[\s>]/i.test(content)
  if (!isFullDocument) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${head}</head><body>${content}</body></html>`
  }
  return injectHead(content, head)
}

/**
 * 在完整文档里把注入内容放到 <head> 最前（先于文档内任何 base/脚本——base 以第一个为准，
 * 拦截脚本也要早于看板自身脚本执行）：
 * 优先插到 <head> 开头；没有 <head> 则插到 <html> 后并补 <head>；再没有就整体兜底包一层。
 */
function injectHead(html: string, head: string): string {
  const headOpen = html.match(/<head[^>]*>/i)
  if (headOpen) {
    const idx = headOpen.index! + headOpen[0].length
    return html.slice(0, idx) + head + html.slice(idx)
  }
  const htmlOpen = html.match(/<html[^>]*>/i)
  if (htmlOpen) {
    const idx = htmlOpen.index! + htmlOpen[0].length
    return html.slice(0, idx) + `<head>${head}</head>` + html.slice(idx)
  }
  return `<!DOCTYPE html><html><head>${head}</head><body>${html}</body></html>`
}
