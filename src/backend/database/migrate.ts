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
    const hasRdpFields = tableInfo.some((col: any) => col.name === 'rdp_security');

    // Check if the type CHECK constraint includes 'rdp'
    // We need to check the SQL used to create the table
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='connections'").get() as any;
    const needsRdpTypeConstraint = tableSql?.sql && !tableSql.sql.includes("'rdp'");

    if (!hasDatabaseType || needsRdpTypeConstraint) {
      console.log('[MIGRATION] Migrating connections table to support RDP connections...');

      // Begin transaction
      db.exec('BEGIN TRANSACTION');

      try {
        // Create new table with updated schema including RDP in type constraint
        db.exec(`
          CREATE TABLE connections_new (
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

        // Build column list based on what exists in old table
        const existingColumns = tableInfo.map((col: any) => col.name);
        const columnsToMigrate = [
          'id', 'user_id', 'name', 'type', 'host', 'port', 'username', 'auth_type',
          'password', 'private_key', 'passphrase', 'enable_terminal', 'enable_file_manager',
          'enable_tunneling', 'default_path', 'tags', 'folder', 'created_at', 'updated_at'
        ].filter(col => existingColumns.includes(col));

        // Add database fields if they exist
        if (existingColumns.includes('database_type')) columnsToMigrate.push('database_type');
        if (existingColumns.includes('database')) columnsToMigrate.push('database');
        if (existingColumns.includes('ssl')) columnsToMigrate.push('ssl');
        if (existingColumns.includes('ssl_options')) columnsToMigrate.push('ssl_options');

        // Add RDP fields if they exist
        if (existingColumns.includes('domain')) columnsToMigrate.push('domain');
        if (existingColumns.includes('rdp_security')) columnsToMigrate.push('rdp_security');
        if (existingColumns.includes('rdp_width')) columnsToMigrate.push('rdp_width');
        if (existingColumns.includes('rdp_height')) columnsToMigrate.push('rdp_height');
        if (existingColumns.includes('rdp_color_depth')) columnsToMigrate.push('rdp_color_depth');
        if (existingColumns.includes('rdp_audio')) columnsToMigrate.push('rdp_audio');
        if (existingColumns.includes('rdp_clipboard')) columnsToMigrate.push('rdp_clipboard');
        if (existingColumns.includes('rdp_drives')) columnsToMigrate.push('rdp_drives');

        const columnList = columnsToMigrate.join(', ');

        // Copy data from old table to new table
        db.exec(`
          INSERT INTO connections_new (${columnList})
          SELECT ${columnList}
          FROM connections
        `);

        // Drop old table
        db.exec('DROP TABLE connections');

        // Rename new table
        db.exec('ALTER TABLE connections_new RENAME TO connections');

        // Commit transaction
        db.exec('COMMIT');

        console.log('[MIGRATION] ✅ Successfully migrated connections table with RDP support');
      } catch (error) {
        // Rollback on error
        db.exec('ROLLBACK');
        throw error;
      }
    } else if (!hasRdpFields) {
      // Add RDP fields to existing table (only columns, constraint already OK)
      console.log('[MIGRATION] Adding RDP fields to connections table...');

      db.exec('BEGIN TRANSACTION');

      try {
        // Add RDP-specific columns
        db.exec(`ALTER TABLE connections ADD COLUMN domain TEXT`);
        db.exec(`ALTER TABLE connections ADD COLUMN rdp_security TEXT CHECK(rdp_security IN ('any', 'nla', 'tls', 'rdp'))`);
        db.exec(`ALTER TABLE connections ADD COLUMN rdp_width INTEGER DEFAULT 1280`);
        db.exec(`ALTER TABLE connections ADD COLUMN rdp_height INTEGER DEFAULT 720`);
        db.exec(`ALTER TABLE connections ADD COLUMN rdp_color_depth INTEGER DEFAULT 24`);
        db.exec(`ALTER TABLE connections ADD COLUMN rdp_audio INTEGER DEFAULT 0`);
        db.exec(`ALTER TABLE connections ADD COLUMN rdp_clipboard INTEGER DEFAULT 1`);
        db.exec(`ALTER TABLE connections ADD COLUMN rdp_drives INTEGER DEFAULT 0`);

        db.exec('COMMIT');
        console.log('[MIGRATION] ✅ Successfully added RDP fields');
      } catch (error) {
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
