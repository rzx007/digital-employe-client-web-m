export const WAVEFORM_BUCKETS = 40

/** 纯函数：单声道采样 → 归一化振幅峰值（0-100 整数）。 */
export function peaksFromChannelData(
  data: Float32Array,
  buckets = WAVEFORM_BUCKETS
): number[] {
  if (data.length === 0 || buckets <= 0) return []
  const bucketSize = Math.max(1, Math.floor(data.length / buckets))
  const peaks: number[] = []
  for (let i = 0; i < buckets; i++) {
    const start = i * bucketSize
    if (start >= data.length) break
    const end = Math.min(start + bucketSize, data.length)
    let max = 0
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j] ?? 0)
      if (v > max) max = v
    }
    peaks.push(max)
  }
  const globalMax = Math.max(...peaks)
  if (globalMax <= 0) return peaks.map(() => 0)
  return peaks.map((p) => Math.round((p / globalMax) * 100))
}

/** 解码音频 blob 并计算波形峰值；任何失败返回空数组（渲染端会退化为装饰条）。 */
export async function computeWaveform(blob: Blob): Promise<number[]> {
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const ctx = new AudioContext()
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      return peaksFromChannelData(audioBuffer.getChannelData(0))
    } finally {
      void ctx.close()
    }
  } catch {
    return []
  }
}
