import { Router } from 'express';
import { getDatabase } from '../database/init.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();
const db = getDatabase();

// Helper function to convert snake_case to camelCase
function toCamelCase(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => toCamelCase(item));
  }

  const converted: any = {};
  for (const key in obj) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    let value = obj[key];

    // Parse JSON strings back to arrays/objects
    if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
      try {
        value = JSON.parse(value);
      } catch (e) {
        // If parsing fails, keep original value
      }
    }

    converted[camelKey] = value;
  }

  return converted;
}

// Get all connections for user
router.get('/', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;

    const connections = db.prepare(
      'SELECT * FROM connections WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId);

    res.json({ success: true, data: toCamelCase(connections) });
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch connections' });
  }
});

// Get single connection
router.get('/:id', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { id } = req.params;

    const connection = db.prepare(
      'SELECT * FROM connections WHERE id = ? AND user_id = ?'
    ).get(id, userId);

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    res.json({ success: true, data: toCamelCase(connection) });
  } catch (error) {
    console.error('Get connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch connection' });
  }
});

// Create connection
router.post('/', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const {
      name,
      type,
      host,
      port,
      username,
      authType,
      password,
      privateKey,
      passphrase,
      enableTerminal,
      enableFileManager,
      enableTunneling,
      defaultPath,
      tags,
      folder,
      databaseType,
      database,
      ssl,
    } = req.body;

    if (!name || !type || !host || !username) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const result = db.prepare(`
      INSERT INTO connections (
        user_id, name, type, host, port, username, auth_type,
        password, private_key, passphrase,
        enable_terminal, enable_file_manager, enable_tunneling,
        default_path, tags, folder, database_type, database, ssl
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      name,
      type,
      host,
      port || (type === 'database' ? 3306 : type === 'ssh' ? 22 : 21),
      username,
      authType || 'password',
      password || null,
      privateKey || null,
      passphrase || null,
      enableTerminal ? 1 : 0,
      enableFileManager ? 1 : 0,
      enableTunneling ? 1 : 0,
      defaultPath || '/',
      tags ? JSON.stringify(tags) : null,
      folder || null,
      databaseType || null,
      database || null,
      ssl ? 1 : 0
    );

    const connection = db.prepare('SELECT * FROM connections WHERE id = ?').get(result.lastInsertRowid);

    res.json({ success: true, data: toCamelCase(connection) });
  } catch (error) {
    console.error('Create connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to create connection' });
  }
});

// Update connection
router.put('/:id', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { id } = req.params;
    const updateData = req.body;

    console.log('[CONNECTIONS] Update connection request:', { id, userId, updateData });

    const connection = db.prepare(
      'SELECT id FROM connections WHERE id = ? AND user_id = ?'
    ).get(id, userId);

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    const fields: string[] = [];
    const values: any[] = [];

    Object.keys(updateData).forEach(key => {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      const value = updateData[key];

      // Only update if value is not null/undefined, or explicitly allow null for password fields
      if (value !== undefined) {
        fields.push(`${snakeKey} = ?`);

        // Convert value to appropriate type for SQLite
        let sqlValue;
        if (value === '') {
          sqlValue = null;
        } else if (typeof value === 'boolean') {
          sqlValue = value ? 1 : 0;
        } else if (Array.isArray(value)) {
          sqlValue = JSON.stringify(value);
        } else {
          sqlValue = value;
        }

        values.push(sqlValue);
      }
    });

    console.log('[CONNECTIONS] Update query:', { fields, values });

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    db.prepare(
      `UPDATE connections SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...values);

    const updated = db.prepare('SELECT * FROM connections WHERE id = ?').get(id);

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Update connection error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update connection'
    });
  }
});

// Delete connection
router.delete('/:id', (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { id } = req.params;

    const result = db.prepare(
      'DELETE FROM connections WHERE id = ? AND user_id = ?'
    ).run(id, userId);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    res.json({ success: true, message: 'Connection deleted' });
  } catch (error) {
    console.error('Delete connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete connection' });
  }
});

export default router;
