import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { migrateDatabase } from './migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../../data/database.db');

// Ensure data directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Check if database exists before creating it
const dbExists = fs.existsSync(dbPath);

// Run migration first if database exists
if (dbExists) {
  console.log('[DATABASE] Existing database found, running migration...');
  try {
    migrateDatabase();
  } catch (error) {
    console.error('[DATABASE] Migration failed:', error);
  }
}

// Create/open database
const db = new Database(dbPath);

export function initDatabase() {
  console.log('[DATABASE] Initializing database...');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create connections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ssh', 'ftp', 'database', 'rdp')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'key', 'none')),
      password TEXT,
      private_key TEXT,
      passphrase TEXT,
      enable_terminal INTEGER DEFAULT 1,
      enable_file_manager INTEGER DEFAULT 1,
      enable_tunneling INTEGER DEFAULT 1,
      default_path TEXT DEFAULT '/',
      tags TEXT,
      folder TEXT,
      database_type TEXT CHECK(database_type IN ('mysql', 'postgresql', 'sqlite', 'mariadb', 'mssql', 'oracle')),
      database TEXT,
      ssl INTEGER DEFAULT 0,
      ssl_options TEXT,
      domain TEXT,
      rdp_security TEXT CHECK(rdp_security IN ('any', 'nla', 'tls', 'rdp')),
      rdp_width INTEGER DEFAULT 1280,
      rdp_height INTEGER DEFAULT 720,
      rdp_color_depth INTEGER DEFAULT 24,
      rdp_audio INTEGER DEFAULT 0,
      rdp_clipboard INTEGER DEFAULT 1,
      rdp_drives INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create scheduled_tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      command TEXT NOT NULL,
      schedule TEXT NOT NULL,
      timezone TEXT DEFAULT 'UTC',
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT,
      last_status TEXT,
      last_output TEXT,
      last_error TEXT,
      run_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create task_logs table for execution history
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error', 'running')),
      output TEXT,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      duration_ms INTEGER,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id) ON DELETE CASCADE
    )
  `);

  // Create tunnels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tunnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      local_port INTEGER NOT NULL,
      remote_host TEXT NOT NULL,
      remote_port INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('local', 'remote', 'dynamic')),
      auto_start INTEGER DEFAULT 0,
      status TEXT DEFAULT 'disconnected',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
    )
  `);

  // Create sessions table for tracking active connections
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      connection_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_active TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create file operations log
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      connection_id INTEGER NOT NULL,
      operation TEXT NOT NULL,
      path TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
    )
  `);

  // Create server stats table
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      connection_id INTEGER NOT NULL,
      cpu_usage REAL NOT NULL,
      cpu_cores INTEGER NOT NULL,
      cpu_load_avg TEXT NOT NULL,
      memory_total INTEGER NOT NULL,
      memory_used INTEGER NOT NULL,
      memory_free INTEGER NOT NULL,
      memory_usage_percent REAL NOT NULL,
      disk_total INTEGER NOT NULL,
      disk_used INTEGER NOT NULL,
      disk_available INTEGER NOT NULL,
      disk_usage_percent REAL NOT NULL,
      uptime INTEGER NOT NULL,
      hostname TEXT NOT NULL,
      os TEXT NOT NULL,
      kernel TEXT NOT NULL,
      network_interfaces TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
    )
  `);

  // Create workspaces table (Tmuxinator-style layouts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      layout TEXT NOT NULL CHECK(layout IN ('single', 'horizontal-2', 'vertical-2', 'main-vertical', 'main-horizontal', 'grid-4')),
      panes TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create storage_connections table (MinIO and other object storage)
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('minio', 's3', 'azure', 'gcs')),
      endpoint TEXT NOT NULL,
      port INTEGER,
      access_key TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      region TEXT,
      use_ssl INTEGER DEFAULT 1,
      bucket TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create index for faster queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_server_stats_session
    ON server_stats(session_id, timestamp DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_server_stats_connection
    ON server_stats(connection_id, timestamp DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_workspaces_user
    ON workspaces(user_id, created_at DESC)
  `);

  console.log('[DATABASE] Initialized successfully');
}

export function getDatabase() {
  return db;
}

export default db;
