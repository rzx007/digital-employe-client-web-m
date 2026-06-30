import test from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { readState, writeState } from "../src/daemon-manager.js"

test("writeState/readState 往返", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bctl-"))
  const f = path.join(dir, "daemon.json")
  writeState(f, { port: 34556, pid: 999, browser: "chrome", startedAt: 1 })
  assert.deepEqual(readState(f), { port: 34556, pid: 999, browser: "chrome", startedAt: 1 })
})

test("readState 文件不存在 → null", () => {
  assert.equal(readState(path.join(os.tmpdir(), "nope-bctl-xyz.json")), null)
})
