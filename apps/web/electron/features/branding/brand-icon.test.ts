import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  resolveBrandIconPaths,
  getAppIconPathForPlatform,
} from "./brand-icon"

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "brand-icon-"))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("resolveBrandIconPaths：品牌根目录 icon.ico / icon.png 优先于打包默认", () => {
  withTempDir((root) => {
    const brandDir = join(root, "brand")
    const appRoot = join(root, "app")
    mkdirSync(join(appRoot, "build"), { recursive: true })
    writeFileSync(join(appRoot, "build/icon.ico"), "bundled-ico")
    writeFileSync(join(appRoot, "build/icon.png"), "bundled-png")

    mkdirSync(brandDir, { recursive: true })
    writeFileSync(join(brandDir, "brand.json"), "{}")
    writeFileSync(join(brandDir, "icon.ico"), "brand-ico")
    writeFileSync(join(brandDir, "icon.png"), "brand-png")

    const prev = process.env.DE_BRANDING_DIR
    process.env.DE_BRANDING_DIR = brandDir
    try {
      const paths = resolveBrandIconPaths(appRoot)
      assert.equal(paths.ico, join(brandDir, "icon.ico"))
      assert.equal(paths.png, join(brandDir, "icon.png"))
    } finally {
      if (prev === undefined) delete process.env.DE_BRANDING_DIR
      else process.env.DE_BRANDING_DIR = prev
    }
  })
})

test("resolveBrandIconPaths：build/ 子目录与 logo.png 回退", () => {
  withTempDir((root) => {
    const brandDir = join(root, "brand")
    const appRoot = join(root, "app")
    mkdirSync(join(appRoot, "build"), { recursive: true })
    writeFileSync(join(appRoot, "build/icon.ico"), "bundled-ico")
    writeFileSync(join(appRoot, "build/icon.png"), "bundled-png")

    mkdirSync(join(brandDir, "build"), { recursive: true })
    writeFileSync(join(brandDir, "brand.json"), "{}")
    writeFileSync(join(brandDir, "build/icon.ico"), "sub-ico")
    writeFileSync(join(brandDir, "logo.png"), "logo-fallback")

    const prev = process.env.DE_BRANDING_DIR
    process.env.DE_BRANDING_DIR = brandDir
    try {
      const paths = resolveBrandIconPaths(appRoot)
      assert.equal(paths.ico, join(brandDir, "build/icon.ico"))
      assert.equal(paths.png, join(brandDir, "logo.png"))
    } finally {
      if (prev === undefined) delete process.env.DE_BRANDING_DIR
      else process.env.DE_BRANDING_DIR = prev
    }
  })
})

test("getAppIconPathForPlatform：Windows 用 ico", () => {
  withTempDir((root) => {
    const brandDir = join(root, "brand")
    const appRoot = join(root, "app")
    mkdirSync(join(appRoot, "build"), { recursive: true })
    writeFileSync(join(appRoot, "build/icon.ico"), "bundled-ico")
    writeFileSync(join(appRoot, "build/icon.png"), "bundled-png")
    mkdirSync(brandDir, { recursive: true })
    writeFileSync(join(brandDir, "brand.json"), "{}")
    writeFileSync(join(brandDir, "icon.ico"), "brand-ico")
    writeFileSync(join(brandDir, "icon.png"), "brand-png")

    const prevEnv = process.env.DE_BRANDING_DIR
    const prevPlatform = process.platform
    process.env.DE_BRANDING_DIR = brandDir
    Object.defineProperty(process, "platform", { value: "win32" })
    try {
      assert.equal(
        getAppIconPathForPlatform(appRoot),
        join(brandDir, "icon.ico"),
      )
    } finally {
      Object.defineProperty(process, "platform", { value: prevPlatform })
      if (prevEnv === undefined) delete process.env.DE_BRANDING_DIR
      else process.env.DE_BRANDING_DIR = prevEnv
    }
  })
})
