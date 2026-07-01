import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  loadBrandFromDir,
  substituteYear,
  resolveBrandingDir,
  resolveExeAdjacentBrandingDir,
} from "./brand-config"

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "brand-"))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("loadBrandFromDir：逐项回退缺失字段到 default", () => {
  withTempDir((dir) => {
    writeFileSync(
      join(dir, "brand.json"),
      JSON.stringify({ productName: "国网数字员工" })
    )
    const b = loadBrandFromDir(dir)
    assert.equal(b.productName, "国网数字员工")
    assert.equal(b.companyName, "Bobandata") // 回退 default
  })
})

test("loadBrandFromDir：brand.json 损坏时整体回退 default", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "brand.json"), "{ not json")
    const b = loadBrandFromDir(dir)
    assert.equal(b.productName, "数字员工")
  })
})

test("loadBrandFromDir：logo 文件存在则读成 data URL", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "brand.json"), JSON.stringify({ logos: { app: "a.png" } }))
    writeFileSync(join(dir, "a.png"), Buffer.from([1, 2, 3]))
    const b = loadBrandFromDir(dir)
    assert.ok(b.logos.app.startsWith("data:image/png;base64,"))
  })
})

test("loadBrandFromDir：login/splash 缺省回退到 app logo", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "brand.json"), JSON.stringify({ logos: { app: "a.png" } }))
    writeFileSync(join(dir, "a.png"), Buffer.from([9]))
    const b = loadBrandFromDir(dir)
    assert.equal(b.logos.login, b.logos.app)
    assert.equal(b.logos.splash, b.logos.app)
  })
})

test("substituteYear 替换 {year}", () => {
  assert.equal(substituteYear("© {year} X", 2026), "© 2026 X")
})

test("resolveExeAdjacentBrandingDir：exe 同级 branding/ 含 brand.json 时返回该目录", () => {
  withTempDir((installDir) => {
    const brandingDir = join(installDir, "branding")
    mkdirSync(brandingDir, { recursive: true })
    writeFileSync(
      join(brandingDir, "brand.json"),
      JSON.stringify({ productName: "外挂品牌" })
    )
    const fakeExe = join(installDir, "BobanStaff.exe")
    writeFileSync(fakeExe, "")
    assert.equal(resolveExeAdjacentBrandingDir(fakeExe), brandingDir)
  })
})

test("resolveExeAdjacentBrandingDir：无 brand.json 时返回 undefined", () => {
  withTempDir((installDir) => {
    const fakeExe = join(installDir, "BobanStaff.exe")
    writeFileSync(fakeExe, "")
    assert.equal(resolveExeAdjacentBrandingDir(fakeExe), undefined)
  })
})

test("resolveBrandingDir：DE_BRANDING_DIR 含 brand.json 时优先采用", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "brand.json"), JSON.stringify({ productName: "Env 品牌" }))
    const prev = process.env.DE_BRANDING_DIR
    process.env.DE_BRANDING_DIR = dir
    try {
      assert.equal(resolveBrandingDir(), dir)
    } finally {
      if (prev === undefined) delete process.env.DE_BRANDING_DIR
      else process.env.DE_BRANDING_DIR = prev
    }
  })
})
