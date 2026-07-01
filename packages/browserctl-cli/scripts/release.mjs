#!/usr/bin/env node
/**
 * browserctl-cli 发布：自动 bump 版本并 npm publish。
 *
 * 用法（monorepo 根目录）：
 *   pnpm publish:browserctl-cli              # auto bump + test + publish
 *   pnpm --filter browserctl-cli release:patch|minor|major
 *
 * auto（默认）：npm 无此包 → 用 package.json 当前版本；
 *              npm 已有且 >= 本地版本 → 在 npm 最新版上 patch +1。
 *
 * 需先 npm login（registry.npmjs.org）。Dry-run：pnpm --filter browserctl-cli pack
 * 发布后 commit packages/browserctl-cli/package.json 版本号变更。
 */
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.resolve(__dirname, "..")
const pkgPath = path.join(pkgDir, "package.json")

const bumpArg = (process.argv[2] || "auto").toLowerCase()
const dryRun = process.argv.includes("--dry-run")
if (!["patch", "minor", "major", "auto"].includes(bumpArg)) {
  console.error("用法: release.mjs [patch|minor|major|auto] [--dry-run]")
  process.exit(1)
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim())
  if (!m) throw new Error(`无效 semver: ${v}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function formatSemver(parts) {
  return `${parts[0]}.${parts[1]}.${parts[2]}`
}

function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

function bumpSemver(version, level) {
  const p = parseSemver(version)
  if (level === "major") return formatSemver([p[0] + 1, 0, 0])
  if (level === "minor") return formatSemver([p[0], p[1] + 1, 0])
  return formatSemver([p[0], p[1], p[2] + 1])
}

function readPkg() {
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"))
}

function writePkg(pkg) {
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

function npmLatestVersion(name) {
  try {
    return execSync(`npm view ${name} version`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

function resolveNextVersion(current, mode) {
  if (mode !== "auto") {
    return bumpSemver(current, mode)
  }
  const latest = npmLatestVersion(readPkg().name)
  if (!latest) {
    console.log(`npm 尚无 ${readPkg().name}，使用当前版本 ${current}`)
    return current
  }
  if (compareSemver(latest, current) >= 0) {
    const next = bumpSemver(latest, "patch")
    console.log(`npm 最新 ${latest}，自动 bump → ${next}`)
    return next
  }
  console.log(`本地 ${current} 领先 npm ${latest}，发布 ${current}`)
  return current
}

const pkg = readPkg()
const next = resolveNextVersion(pkg.version, bumpArg)

if (next !== pkg.version) {
  pkg.version = next
  writePkg(pkg)
  console.log(`已写入 package.json version=${next}`)
} else {
  console.log(`保持 version=${next}`)
}

console.log("运行测试…")
execSync("pnpm test", { cwd: pkgDir, stdio: "inherit" })

if (dryRun) {
  console.log(`\n[dry-run] 将发布 ${pkg.name}@${next}（未执行 npm publish）`)
  process.exit(0)
}

console.log("发布到 npm…")
execSync("npm publish --access public", { cwd: pkgDir, stdio: "inherit" })

console.log(`\n✓ 已发布 ${pkg.name}@${next}`)
console.log("  请 commit package.json 版本变更（及可选 git tag）。")
