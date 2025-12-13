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

    try {
      switch (session.type) {
        case 'mysql':
        case 'mariadb':
          await session.client.query(`USE \`${database}\``);
          break;
        case 'postgresql': {
          await session.client.end();
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

    // Switch database if needed
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

    return this.executeQuery(sessionId, query, database);
  }

  getSession(sessionId: string): DatabaseConnection | undefined {
    return this.sessions.get(sessionId);
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
