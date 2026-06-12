import { describe, expect, it } from "vitest"
import { peaksFromChannelData, WAVEFORM_BUCKETS } from "./compute-waveform"

describe("peaksFromChannelData", () => {
  it("产出默认桶数的 0-100 整数峰值", () => {
    const data = new Float32Array(4000).map((_, i) => Math.sin(i / 10) * 0.8)
    const peaks = peaksFromChannelData(data)
    expect(peaks).toHaveLength(WAVEFORM_BUCKETS)
    for (const p of peaks) {
      expect(Number.isInteger(p)).toBe(true)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(100)
    }
  })

  it("峰值按全局最大值归一化（最大桶为 100）", () => {
    const data = new Float32Array(400)
    data[10] = 0.5
    const peaks = peaksFromChannelData(data, 4)
    expect(Math.max(...peaks)).toBe(100)
  })

  it("空数据返回空数组", () => {
    expect(peaksFromChannelData(new Float32Array(0))).toEqual([])
  })

  it("样本数少于桶数时不抛出且不超过样本数", () => {
    const data = new Float32Array(5).fill(0.5)
    const peaks = peaksFromChannelData(data, 40)
    expect(peaks.length).toBeGreaterThan(0)
    expect(peaks.length).toBeLessThanOrEqual(40)
  })
})
