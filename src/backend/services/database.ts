import { DatabaseType, DatabaseInfo, TableInfo, ColumnInfo, QueryResult } from '../../types/index.js';
import { randomBytes } from 'crypto';

interface DatabaseConnection {
  sessionId: string;
  connectionId: number;
  type: DatabaseType;
  client: any;
  currentDatabase?: string;
  connectionConfig: {
    host: string;
    port: number;
    username: string;
    password?: string;
    database?: string;
    ssl?: boolean;
    sslOptions?: any;
  };
  lastActive: number;
}

class DatabaseService {
  private sessions: Map<string, DatabaseConnection> = new Map();
  private mysql: any = null;
  private pg: any = null;
  private sqlite3: any = null;

  constructor() {
    // Lazy load database drivers
    this.initDrivers();
  }

  private async initDrivers() {
    try {
      // These will be dynamically imported when needed
      // We'll handle missing drivers gracefully
    } catch (error) {
      console.warn('Some database drivers may not be available:', error);
    }
  }

  async connect(
    connectionId: number,
    databaseType: DatabaseType,
    config: {
      host: string;
      port: number;
      username: string;
      password?: string;
      database?: string;
      ssl?: boolean;
      sslOptions?: any;
    }
  ): Promise<string> {
    const sessionId = randomBytes(16).toString('hex');

    try {
      let client: any;

      switch (databaseType) {
        case 'mysql':
        case 'mariadb':
          client = await this.connectMySQL(config);
          break;
        case 'postgresql':
          client = await this.connectPostgreSQL(config);
          break;
        case 'sqlite':
          client = await this.connectSQLite(config);
          break;
        default:
          throw new Error(`Unsupported database type: ${databaseType}`);
      }

      this.sessions.set(sessionId, {
        sessionId,
        connectionId,
        type: databaseType,
        client,
        currentDatabase: config.database,
        connectionConfig: { ...config },
        lastActive: Date.now(),
      });

      return sessionId;
    } catch (error: any) {
      throw new Error(`Failed to connect to ${databaseType}: ${error.message}`);
    }
  }

  private async connectMySQL(config: any): Promise<any> {
    if (!this.mysql) {
      try {
        this.mysql = await import('mysql2/promise');
      } catch (error) {
        throw new Error('MySQL driver not installed. Run: npm install mysql2');
      }
    }

    const connection = await this.mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? config.sslOptions || {} : false,
    });

    return connection;
  }

  private async connectPostgreSQL(config: any): Promise<any> {
    await this.ensurePostgresDriver();

    const client = new this.pg.Client({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: config.database || 'postgres',
      ssl: config.ssl ? config.sslOptions || { rejectUnauthorized: false } : false,
    });

    await client.connect();
    return client;
  }

  private async ensurePostgresDriver() {
    if (!this.pg) {
      try {
        this.pg = await import('pg');
      } catch (error) {
        throw new Error('PostgreSQL driver not installed. Run: npm install pg');
      }
    }
  }

  private async connectSQLite(config: any): Promise<any> {
    if (!this.sqlite3) {
      try {
        this.sqlite3 = await import('sqlite3');
        const { open } = await import('sqlite');

        return await open({
          filename: config.database || ':memory:',
          driver: this.sqlite3.Database,
        });
      } catch (error) {
        throw new Error('SQLite driver not installed. Run: npm install sqlite3 sqlite');
      }
    }
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          await session.client.end();
          break;
        case 'postgresql':
          await session.client.end();
          break;
        case 'sqlite':
          await session.client.close();
          break;
      }
    } catch (error) {
      console.error('Error disconnecting database:', error);
    }

    this.sessions.delete(sessionId);
  }

  async listDatabases(sessionId: string): Promise<DatabaseInfo[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.lastActive = Date.now();

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          return await this.listDatabasesMySQL(session.client);
        case 'postgresql':
          return await this.listDatabasesPostgreSQL(session.client);
        case 'sqlite':
          return [{ name: 'main' }];
        default:
          throw new Error('Unsupported database type');
      }
    } catch (error: any) {
      throw new Error(`Failed to list databases: ${error.message}`);
    }
  }

  private async listDatabasesMySQL(client: any): Promise<DatabaseInfo[]> {
    const [rows] = await client.query('SHOW DATABASES');
    return rows.map((row: any) => ({
      name: row.Database,
    }));
  }

  private async listDatabasesPostgreSQL(client: any): Promise<DatabaseInfo[]> {
    const result = await client.query(
      "SELECT datname as name FROM pg_database WHERE datistemplate = false ORDER BY datname"
    );
    return result.rows;
  }

  async listTables(sessionId: string, database?: string): Promise<TableInfo[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.lastActive = Date.now();

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          // MySQL supports switching databases
          if (database && database !== session.currentDatabase) {
            await this.useDatabase(sessionId, database);
          }
          return await this.listTablesMySQL(session.client, database);
        case 'postgresql':
          if (database && database !== session.currentDatabase) {
            await this.useDatabase(sessionId, database);
          }
          return await this.listTablesPostgreSQL(session.client);
        case 'sqlite':
          return await this.listTablesSQLite(session.client);
        default:
          throw new Error('Unsupported database type');
      }
    } catch (error: any) {
      console.error('Error listing tables:', error);
      throw new Error(`Failed to list tables: ${error.message}`);
    }
  }

  private async listTablesMySQL(client: any, database?: string): Promise<TableInfo[]> {
    const query = database ? `SHOW TABLES FROM \`${database}\`` : 'SHOW TABLES';
    const [rows] = await client.query(query);

    return rows.map((row: any) => {
      const tableName = Object.values(row)[0] as string;
      return {
        name: tableName,
        type: 'table' as const,
      };
    });
  }

  private async listTablesPostgreSQL(client: any): Promise<TableInfo[]> {
    const result = await client.query(`
      SELECT
        table_name as name,
        table_type as type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    return result.rows.map((row: any) => ({
      name: row.name,
      type: row.type.toLowerCase().includes('view') ? 'view' : 'table',
    }));
  }

  private async listTablesSQLite(client: any): Promise<TableInfo[]> {
    const result = await client.all(`
      SELECT name, type
      FROM sqlite_master
      WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    return result.map((row: any) => ({
      name: row.name,
      type: row.type as 'table' | 'view',
    }));
  }

  async getTableColumns(sessionId: string, tableName: string, database?: string): Promise<ColumnInfo[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.lastActive = Date.now();

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          // MySQL supports switching databases
          if (database && database !== session.currentDatabase) {
            await this.useDatabase(sessionId, database);
          }
          return await this.getTableColumnsMySQL(session.client, tableName, database);
        case 'postgresql':
          if (database && database !== session.currentDatabase) {
            await this.useDatabase(sessionId, database);
          }
          return await this.getTableColumnsPostgreSQL(session.client, tableName);
        case 'sqlite':
          return await this.getTableColumnsSQLite(session.client, tableName);
        default:
          throw new Error('Unsupported database type');
      }
    } catch (error: any) {
      console.error('Error getting table columns:', error);
      throw new Error(`Failed to get table columns: ${error.message}`);
    }
  }

  private async getTableColumnsMySQL(client: any, tableName: string, database?: string): Promise<ColumnInfo[]> {
    const query = database
      ? `SHOW FULL COLUMNS FROM \`${database}\`.\`${tableName}\``
      : `SHOW FULL COLUMNS FROM \`${tableName}\``;

    const [rows] = await client.query(query);

    return rows.map((row: any) => ({
      name: row.Field,
      type: row.Type,
      nullable: row.Null === 'YES',
      key: row.Key || '',
      default: row.Default,
      extra: row.Extra,
      comment: row.Comment,
    }));
  }

  private async getTableColumnsPostgreSQL(client: any, tableName: string): Promise<ColumnInfo[]> {
    const result = await client.query(
      `
        WITH pk_columns AS (
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
            AND tc.table_name = kcu.table_name
          WHERE tc.table_name = $1
            AND tc.table_schema = 'public'
            AND tc.constraint_type = 'PRIMARY KEY'
        )
        SELECT
          c.column_name as name,
          c.data_type as type,
          c.is_nullable as nullable,
          c.column_default as "default",
          CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END as key
        FROM information_schema.columns c
        LEFT JOIN pk_columns pk ON pk.column_name = c.column_name
        WHERE c.table_name = $1
          AND c.table_schema = 'public'
        ORDER BY c.ordinal_position
      `,
      [tableName]
    );

    return result.rows.map((row: any) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable === 'YES',
      key: row.key || '',
      default: row.default,
      extra: row.default && String(row.default).startsWith('nextval(') ? 'auto_increment' : '',
    }));
  }

  private async getTableColumnsSQLite(client: any, tableName: string): Promise<ColumnInfo[]> {
    const result = await client.all(`PRAGMA table_info(\`${tableName}\`)`);

    return result.map((row: any) => ({
      name: row.name,
      type: row.type,
      nullable: row.notnull === 0,
      key: row.pk ? 'PRI' : '',
      default: row.dflt_value,
      extra: '',
    }));
  }

  async executeQuery(sessionId: string, query: string, database?: string): Promise<QueryResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.lastActive = Date.now();

    const startTime = Date.now();

    try {
      let result: any;

      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          // MySQL supports switching databases
          if (database && database !== session.currentDatabase) {
            await this.useDatabase(sessionId, database);
          }
          result = await this.executeQueryMySQL(session.client, query);
          break;
        case 'postgresql':
          if (database && database !== session.currentDatabase) {
            await this.useDatabase(sessionId, database);
          }
          result = await this.executeQueryPostgreSQL(session.client, query);
          break;
        case 'sqlite':
          result = await this.executeQuerySQLite(session.client, query);
          break;
        default:
          throw new Error('Unsupported database type');
      }

      const executionTime = Date.now() - startTime;
      return { ...result, executionTime };
    } catch (error: any) {
      console.error('Error executing query:', error);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        error: error.message,
        executionTime: Date.now() - startTime,
      };
    }
  }

  private async executeQueryMySQL(client: any, query: string): Promise<QueryResult> {
    const [rows, fields] = await client.query(query);

    if (Array.isArray(rows)) {
      return {
        columns: fields?.map((f: any) => f.name) || [],
        rows: rows,
        rowCount: rows.length,
      };
    } else {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: rows.affectedRows,
      };
    }
  }

  private async executeQueryPostgreSQL(client: any, query: string): Promise<QueryResult> {
    const result = await client.query(query);

    return {
      columns: result.fields?.map((f: any) => f.name) || [],
      rows: result.rows || [],
      rowCount: result.rowCount || 0,
    };
  }

  private async executeQuerySQLite(client: any, query: string): Promise<QueryResult> {
    const trimmedQuery = query.trim().toUpperCase();

    if (trimmedQuery.startsWith('SELECT') || trimmedQuery.startsWith('PRAGMA')) {
      const rows = await client.all(query);
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      return {
        columns,
        rows,
        rowCount: rows.length,
      };
    } else {
      const result = await client.run(query);

      return {
        columns: [],
        rows: [],
        rowCount: 0,
        affectedRows: result.changes,
      };
    }
  }

  private async useDatabase(sessionId: string, database: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    // Skip if already on the correct database
    if (session.currentDatabase === database) {
      return;
    }

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          await session.client.query(`USE \`${database}\``);
          break;
        case 'postgresql': {
          // For PostgreSQL, we need to disconnect and reconnect to a different database
          try {
            await session.client.end();
          } catch (e) {
            // Client might already be disconnected
            console.warn('PostgreSQL client already disconnected');
          }
          const newClient = await this.connectPostgreSQL({
            ...session.connectionConfig,
            database,
          });
          session.client = newClient;
          break;
        }
        case 'sqlite':
          // SQLite doesn't support multiple databases in the same connection
          break;
      }

      session.currentDatabase = database;
    } catch (error: any) {
      throw new Error(`Failed to switch database: ${error.message}`);
    }
  }

  async getTableData(
    sessionId: string,
    tableName: string,
    database: string | undefined,
    limit: number,
    offset: number
  ): Promise<QueryResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.lastActive = Date.now();

    // Switch database if needed (and if database is specified)
    if (database && database !== session.currentDatabase) {
      await this.useDatabase(sessionId, database);
    }

    const safeLimit = Number.isFinite(limit) ? limit : 100;
    const safeOffset = Number.isFinite(offset) ? offset : 0;

    let query = '';
    switch (session.type) {
      case 'mysql':
      case 'mariadb':
        query = `SELECT * FROM \`${tableName}\` LIMIT ${safeLimit} OFFSET ${safeOffset}`;
        break;
      case 'postgresql':
        query = `SELECT * FROM "${tableName}" LIMIT ${safeLimit} OFFSET ${safeOffset}`;
        break;
      case 'sqlite':
        query = `SELECT * FROM "${tableName}" LIMIT ${safeLimit} OFFSET ${safeOffset}`;
        break;
      default:
        throw new Error('Unsupported database type');
    }

    // Don't pass database again to executeQuery to avoid double-switching
    return this.executeQuery(sessionId, query);
  }

  getSession(sessionId: string): DatabaseConnection | undefined {
    return this.sessions.get(sessionId);
  }

  async getTableSchema(sessionId: string, tableName: string, database?: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    session.lastActive = Date.now();

    if (database && database !== session.currentDatabase) {
      await this.useDatabase(sessionId, database);
    }

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          return await this.getTableSchemaMySQL(session.client, tableName);
        case 'postgresql':
          return await this.getTableSchemaPostgreSQL(session.client, tableName);
        case 'sqlite':
          return await this.getTableSchemaSQLite(session.client, tableName);
        default:
          throw new Error('Unsupported database type');
      }
    } catch (error: any) {
      throw new Error(`Failed to get table schema: ${error.message}`);
    }
  }

  private async getTableSchemaMySQL(client: any, tableName: string): Promise<string> {
    const [rows] = await client.query(`SHOW CREATE TABLE \`${tableName}\``);
    return rows[0]?.['Create Table'] || '';
  }

  private async getTableSchemaPostgreSQL(client: any, tableName: string): Promise<string> {
    // Get columns
    const columnsResult = await client.query(`
      SELECT 
        c.column_name,
        c.data_type,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        c.is_nullable,
        c.column_default,
        c.udt_name
      FROM information_schema.columns c
      WHERE c.table_name = $1 AND c.table_schema = 'public'
      ORDER BY c.ordinal_position
    `, [tableName]);

    // Get primary key
    const pkResult = await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = $1 
        AND tc.table_schema = 'public'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `, [tableName]);

    // Get foreign keys
    const fkResult = await client.query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_name = $1
        AND tc.table_schema = 'public'
    `, [tableName]);

    const pkColumns = pkResult.rows.map((r: any) => r.column_name);
    const fkMap = new Map<string, { table: string; column: string; name: string }>();
    fkResult.rows.forEach((r: any) => {
      fkMap.set(r.column_name, { 
        table: r.foreign_table_name, 
        column: r.foreign_column_name,
        name: r.constraint_name 
      });
    });

    // Build CREATE TABLE statement
    const columnDefs = columnsResult.rows.map((col: any) => {
      let typeDef = col.udt_name.toUpperCase();
      if (col.character_maximum_length) {
        typeDef = `VARCHAR(${col.character_maximum_length})`;
      } else if (col.udt_name === 'int4') {
        typeDef = 'INTEGER';
      } else if (col.udt_name === 'int8') {
        typeDef = 'BIGINT';
      } else if (col.udt_name === 'bool') {
        typeDef = 'BOOLEAN';
      } else if (col.udt_name === 'float8') {
        typeDef = 'DOUBLE PRECISION';
      } else if (col.udt_name === 'timestamptz') {
        typeDef = 'TIMESTAMP WITH TIME ZONE';
      } else if (col.udt_name === 'timestamp') {
        typeDef = 'TIMESTAMP';
      }

      let def = `  "${col.column_name}" ${typeDef}`;
      if (col.is_nullable === 'NO') def += ' NOT NULL';
      if (col.column_default) {
        // Handle serial/identity columns
        if (col.column_default.startsWith('nextval(')) {
          def = `  "${col.column_name}" SERIAL`;
          if (col.is_nullable === 'NO') def += ' NOT NULL';
        } else {
          def += ` DEFAULT ${col.column_default}`;
        }
      }
      return def;
    });

    // Add primary key constraint
    if (pkColumns.length > 0) {
      columnDefs.push(`  PRIMARY KEY (${pkColumns.map((c: string) => `"${c}"`).join(', ')})`);
    }

    // Add foreign key constraints
    const addedFks = new Set<string>();
    fkMap.forEach((fk, colName) => {
      if (!addedFks.has(fk.name)) {
        columnDefs.push(`  CONSTRAINT "${fk.name}" FOREIGN KEY ("${colName}") REFERENCES "${fk.table}" ("${fk.column}")`);
        addedFks.add(fk.name);
      }
    });

    return `CREATE TABLE "${tableName}" (\n${columnDefs.join(',\n')}\n);`;
  }

  private async getTableSchemaSQLite(client: any, tableName: string): Promise<string> {
    const result = await client.get(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    return result?.sql || '';
  }

  async getMigrationOrder(sessionId: string, database?: string): Promise<string[] | null> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (database && database !== session.currentDatabase) {
      await this.useDatabase(sessionId, database);
    }

    try {
      // Try common migration table names
      const migrationTables = ['migrations', '_migrations', 'schema_migrations', 'knex_migrations', 'drizzle_migrations', 'prisma_migrations', '_prisma_migrations'];
      
      for (const migTable of migrationTables) {
        try {
          const result = await this.executeQuery(sessionId, 
            session.type === 'mysql' || session.type === 'mariadb'
              ? `SELECT * FROM \`${migTable}\` ORDER BY id ASC`
              : `SELECT * FROM "${migTable}" ORDER BY id ASC`,
            database
          );
          
          if (result.rows.length > 0) {
            // Try to extract table names from migration names/filenames
            const tableOrder: string[] = [];
            for (const row of result.rows) {
              // Common migration columns: name, migration, filename
              const migrationName = row.name || row.migration || row.filename || row.migration_name || '';
              // Extract potential table name from migration (e.g., "create_users_table" -> "users")
              const match = migrationName.match(/create_(\w+)_table|create_(\w+)|(\w+)_migration/i);
              if (match) {
                const tableName = match[1] || match[2] || match[3];
                if (tableName && !tableOrder.includes(tableName)) {
                  tableOrder.push(tableName);
                }
              }
            }
            if (tableOrder.length > 0) {
              return tableOrder;
            }
          }
        } catch {
          // Table doesn't exist, try next
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async getTableDependencies(sessionId: string, database?: string): Promise<Map<string, string[]>> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (database && database !== session.currentDatabase) {
      await this.useDatabase(sessionId, database);
    }

    const dependencies = new Map<string, string[]>();

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb': {
          const [rows] = await session.client.query(`
            SELECT 
              TABLE_NAME as table_name,
              REFERENCED_TABLE_NAME as referenced_table
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE REFERENCED_TABLE_NAME IS NOT NULL
              AND TABLE_SCHEMA = DATABASE()
          `);
          for (const row of rows) {
            const deps = dependencies.get(row.table_name) || [];
            if (!deps.includes(row.referenced_table)) {
              deps.push(row.referenced_table);
            }
            dependencies.set(row.table_name, deps);
          }
          break;
        }
        case 'postgresql': {
          const result = await session.client.query(`
            SELECT
              tc.table_name,
              ccu.table_name AS referenced_table
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
          `);
          for (const row of result.rows) {
            const deps = dependencies.get(row.table_name) || [];
            if (!deps.includes(row.referenced_table)) {
              deps.push(row.referenced_table);
            }
            dependencies.set(row.table_name, deps);
          }
          break;
        }
        case 'sqlite': {
          // Get all tables first
          const tables = await this.listTablesSQLite(session.client);
          for (const table of tables) {
            const fkResult = await session.client.all(`PRAGMA foreign_key_list("${table.name}")`);
            const deps: string[] = [];
            for (const fk of fkResult) {
              if (fk.table && !deps.includes(fk.table)) {
                deps.push(fk.table);
              }
            }
            if (deps.length > 0) {
              dependencies.set(table.name, deps);
            }
          }
          break;
        }
      }
    } catch (error) {
      console.error('Error getting table dependencies:', error);
    }

    return dependencies;
  }

  cleanup(): void {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActive > timeout) {
        this.disconnect(sessionId).catch(console.error);
      }
    }
  }
}

export const databaseService = new DatabaseService();

// Cleanup inactive sessions every 5 minutes
setInterval(() => {
  databaseService.cleanup();
}, 5 * 60 * 1000);
