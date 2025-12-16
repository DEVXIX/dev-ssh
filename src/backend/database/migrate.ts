import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../../data/database.db');

export function migrateDatabase() {
  console.log('[MIGRATION] Starting database migration...');

  const db = new Database(dbPath);

  try {
    // Check if we need to migrate the connections table
    const tableInfo = db.pragma('table_info(connections)') as any[];
    const hasDatabaseType = tableInfo.some((col: any) => col.name === 'database_type');

    if (!hasDatabaseType) {
      console.log('[MIGRATION] Migrating connections table to support database connections...');

      // Begin transaction
      db.exec('BEGIN TRANSACTION');

      try {
        // Create new table with updated schema
        db.exec(`
          CREATE TABLE connections_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('ssh', 'ftp', 'database')),
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
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `);

        // Copy data from old table to new table
        db.exec(`
          INSERT INTO connections_new (
            id, user_id, name, type, host, port, username, auth_type,
            password, private_key, passphrase, enable_terminal, enable_file_manager,
            enable_tunneling, default_path, tags, folder, created_at, updated_at
          )
          SELECT
            id, user_id, name, type, host, port, username, auth_type,
            password, private_key, passphrase, enable_terminal, enable_file_manager,
            enable_tunneling, default_path, tags, folder, created_at, updated_at
          FROM connections
        `);

        // Drop old table
        db.exec('DROP TABLE connections');

        // Rename new table
        db.exec('ALTER TABLE connections_new RENAME TO connections');

        // Commit transaction
        db.exec('COMMIT');

        console.log('[MIGRATION] ✅ Successfully migrated connections table');
      } catch (error) {
        // Rollback on error
        db.exec('ROLLBACK');
        throw error;
      }
    } else {
      console.log('[MIGRATION] Database already up to date');
    }
  } catch (error) {
    console.error('[MIGRATION] ❌ Migration failed:', error);
    throw error;
  } finally {
    db.close();
  }

  console.log('[MIGRATION] Migration completed');
}
