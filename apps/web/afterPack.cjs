const fs = require("fs/promises")
const path = require("path")

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function (context) {
  const localeDir = path.join(context.appOutDir, "locales")

  let files
  try {
    files = await fs.readdir(localeDir)
  } catch (err) {
    if (err && err.code === "ENOENT") return
    throw err
  }

  if (!files.length) return

  for (const name of files) {
    if (name.startsWith("en") || name.startsWith("zh")) continue
    await fs.unlink(path.join(localeDir, name))
  }
}
