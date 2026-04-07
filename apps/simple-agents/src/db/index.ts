/**
 * Database Module - 数据库初始化模块
 *
 * 职责：
 * 1. 初始化 SQLite 数据库连接
 * 2. 配置数据库参数（WAL 模式、外键约束）
 * 3. 执行数据库迁移
 * 4. 导出数据库实例和配置
 *
 * SQLite 配置说明：
 * - WAL (Write-Ahead Logging) 模式：支持多读单写，提高并发性能
 * - 外键约束：启用 ON DELETE CASCADE，删除父记录时自动删除子记录
 */

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import fs from "node:fs"
import * as schema from "./schema"

/**
 * 数据存储目录
 *
 * 默认使用项目根目录下的 data 目录
 * 可通过 DATA_DIR 环境变量配置
 */
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data")

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * 数据库文件路径
 *
 * 格式：data/simple-agents.db
 */
const DB_PATH = path.join(DATA_DIR, "simple-agents.db")

/**
 * SQLite 数据库实例
 *
 * 使用 better-sqlite3 库，性能优于原生 SQLite
 */
const sqlite = new Database(DB_PATH)

/**
 * 配置数据库参数
 *
 * - journal_mode = WAL：开启 WAL 模式，提高并发性能
 * - foreign_keys = ON：启用外键约束
 */
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")

/**
 * Drizzle ORM 实例
 *
 * 将 SQLite 数据库和 Schema 关联，用于类型安全的数据库操作
 */
export const db = drizzle(sqlite, { schema })

/**
 * 数据库迁移目录
 *
 * 存储由 drizzle-kit generate 生成的迁移文件
 * 自动执行以同步数据库结构
 */
const MIGRATIONS_DIR = path.join(__dirname, "migrations")

// 如果迁移目录存在，执行迁移
if (fs.existsSync(MIGRATIONS_DIR)) {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}

// 导出数据库实例和配置
export { DATA_DIR, DB_PATH }
export type Database = typeof db
