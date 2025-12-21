import express from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { databaseService } from '../services/database.js';
import db from '../database/init.js';
import { decrypt, isEncrypted } from '../utils/encryption.js';

const router = express.Router();

// Connect to database
router.post('/connect', async (req: AuthRequest, res) => {
  try {
    const { connectionId, password: providedPassword } = req.body;
    const userId = req.userId;

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        error: 'Connection ID is required',
      });
    }

    // Get connection details
    const connection = db
      .prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
      .get(connectionId, userId) as any;

    if (!connection) {
      return res.status(404).json({
        success: false,
        error: 'Connection not found',
      });
    }

    if (connection.type !== 'database') {
      return res.status(400).json({
        success: false,
        error: 'Connection is not a database connection',
      });
    }

    // Decrypt stored password if it exists and is encrypted
    let storedPassword = null;
    if (connection.password) {
      try {
        storedPassword = isEncrypted(connection.password) 
          ? decrypt(connection.password) 
          : connection.password;
      } catch (error) {
        console.warn('[DATABASE] Password decryption failed, clearing field');
        storedPassword = null;
      }
    }

    // Use provided password or decrypted stored password
    const authPassword = providedPassword !== undefined ? providedPassword : storedPassword;

    console.log('[DATABASE] Connect:', {
      connectionId,
      userId,
      type: connection.database_type,
      hasStoredPassword: !!storedPassword,
      hasProvidedPassword: providedPassword !== undefined,
      willUsePassword: !!authPassword
    });

    const sessionId = await databaseService.connect(
      connection.id,
      connection.database_type,
      {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: authPassword,
        database: connection.database,
        ssl: connection.ssl === 1,
        sslOptions: connection.ssl_options ? JSON.parse(connection.ssl_options) : undefined,
      }
    );

    res.json({
      success: true,
      data: { sessionId },
    });
  } catch (error: any) {
    console.error('Database connection error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to connect to database',
    });
  }
});

// Disconnect from database
router.post('/disconnect/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    await databaseService.disconnect(sessionId);

    res.json({
      success: true,
      message: 'Disconnected successfully',
    });
  } catch (error: any) {
    console.error('Database disconnection error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to disconnect from database',
    });
  }
});

// List databases
router.get('/databases/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const databases = await databaseService.listDatabases(sessionId);

    res.json({
      success: true,
      data: databases,
    });
  } catch (error: any) {
    console.error('List databases error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list databases',
    });
  }
});

// List tables
router.get('/tables/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { database } = req.query;

    const tables = await databaseService.listTables(sessionId, database as string | undefined);

    res.json({
      success: true,
      data: tables,
    });
  } catch (error: any) {
    console.error('List tables error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list tables',
    });
  }
});

// Get table columns
router.get('/columns/:sessionId/:tableName', async (req, res) => {
  try {
    const { sessionId, tableName } = req.params;
    const { database } = req.query;

    const columns = await databaseService.getTableColumns(
      sessionId,
      tableName,
      database as string | undefined
    );

    res.json({
      success: true,
      data: columns,
    });
  } catch (error: any) {
    console.error('Get columns error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get table columns',
    });
  }
});

// Execute query
router.post('/query/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { query, database } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required',
      });
    }

    const result = await databaseService.executeQuery(sessionId, query, database);

    res.json({
      success: !result.error,
      data: result,
    });
  } catch (error: any) {
    console.error('Query execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to execute query',
    });
  }
});

// Get table data (with pagination)
router.get('/table-data/:sessionId/:tableName', async (req, res) => {
  try {
    const { sessionId, tableName } = req.params;
    const { database, limit = '100', offset = '0' } = req.query;

    const result = await databaseService.getTableData(
      sessionId,
      tableName,
      database as string | undefined,
      Number(limit),
      Number(offset)
    );

    res.json({
      success: !result.error,
      data: result,
    });
  } catch (error: any) {
    console.error('Get table data error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get table data',
    });
  }
});

// Get table schema (CREATE TABLE statement)
router.get('/schema/:sessionId/:tableName', async (req, res) => {
  try {
    const { sessionId, tableName } = req.params;
    const { database } = req.query;

    const schema = await databaseService.getTableSchema(
      sessionId,
      tableName,
      database as string | undefined
    );

    res.json({
      success: true,
      data: schema,
    });
  } catch (error: any) {
    console.error('Get schema error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get table schema',
    });
  }
});

// Get migration order
router.get('/migrations/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { database } = req.query;

    const order = await databaseService.getMigrationOrder(
      sessionId,
      database as string | undefined
    );

    res.json({
      success: true,
      data: order,
    });
  } catch (error: any) {
    console.error('Get migrations error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get migration order',
    });
  }
});

// Get table dependencies (foreign keys)
router.get('/dependencies/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { database } = req.query;

    const dependencies = await databaseService.getTableDependencies(
      sessionId,
      database as string | undefined
    );

    // Convert Map to object for JSON response
    const depsObject: Record<string, string[]> = {};
    dependencies.forEach((deps, table) => {
      depsObject[table] = deps;
    });

    res.json({
      success: true,
      data: depsObject,
    });
  } catch (error: any) {
    console.error('Get dependencies error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get table dependencies',
    });
  }
});

export default router;
