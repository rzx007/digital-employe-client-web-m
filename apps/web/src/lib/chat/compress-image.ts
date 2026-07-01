/**
 * 浏览器端图片压缩：缩放到最长边上限 + 重编码为 JPEG（降质）。
 * 用于 BUG 反馈截图——不需要高精度，压小后随表单直接发后台，进一步减小体积。
 *
 * 失败（解码不了 / 无 canvas）时抛错，调用方可回退到原图 dataURL。
 */
export interface CompressImageOptions {
  /** 最长边像素上限，超过则等比缩小。默认 1600。 */
  maxDimension?: number
  /** JPEG 质量 0~1。默认 0.7。 */
  quality?: number
  /** 输出 MIME。默认 image/jpeg（对截图足够，体积最小）。 */
  mimeType?: string
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("图片解码失败"))
    img.src = src
  })
}

export async function compressImageToDataUrl(
  file: File,
  opts: CompressImageOptions = {}
): Promise<string> {
  const {
    maxDimension = 1600,
    quality = 0.7,
    mimeType = "image/jpeg",
  } = opts

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const longest = Math.max(img.width, img.height) || 1
    const scale = Math.min(1, maxDimension / longest)
    const width = Math.max(1, Math.round(img.width * scale))
    const height = Math.max(1, Math.round(img.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("canvas 不可用")
    // 透明背景(PNG)转 JPEG 会变黑，先铺白底
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)

    return canvas.toDataURL(mimeType, quality)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
