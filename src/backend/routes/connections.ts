import { Router } from 'express';
import { getDatabase } from '../database/init.js';
import { AuthRequest } from '../middleware/auth.js';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption.js';
import { validateHostname, validatePort, validateConnectionName, sanitizeInput } from '../utils/validation.js';

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
    ).all(userId) as any[];

    // Decrypt sensitive fields and remove them from response (for security)
    const sanitizedConnections = connections.map(conn => {
      const decrypted = { ...conn };

      // Add indicators for whether credentials exist (without exposing them)
      decrypted.hasPassword = !!conn.password;
      decrypted.hasPrivateKey = !!conn.private_key;
      decrypted.hasPassphrase = !!conn.passphrase;

      // Remove sensitive fields from list view (they're not needed)
      delete decrypted.password;
      delete decrypted.private_key;
      delete decrypted.passphrase;

      return decrypted;
    });

    res.json({ success: true, data: toCamelCase(sanitizedConnections) });
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

    console.log('[CONNECTIONS] Get single connection:', { id, userId });

    const connection = db.prepare(
      'SELECT * FROM connections WHERE id = ? AND user_id = ?'
    ).get(id, userId) as any;

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    console.log('[CONNECTIONS] Found connection:', { 
      id: connection.id, 
      name: connection.name,
      hasPassword: !!connection.password,
      passwordLength: connection.password?.length || 0
    });

    // Decrypt sensitive fields (handle both encrypted and plaintext for backward compatibility)
    const decrypted = { ...connection };
    if (decrypted.password) {
      try {
        // Try to decrypt - if it fails, it's probably plaintext or encrypted with different key
        if (isEncrypted(decrypted.password)) {
          console.log('[CONNECTIONS] Password is encrypted, decrypting...');
          decrypted.password = decrypt(decrypted.password);
          console.log('[CONNECTIONS] Password decrypted successfully');
        } else {
          console.log('[CONNECTIONS] Password is plaintext, keeping as-is');
        }
        // If not encrypted format, keep as-is (plaintext)
      } catch (error) {
        // If decryption fails, the data may be corrupted or encrypted with different key
        // Clear it so user can re-enter
        console.warn('[CONNECTIONS] Password decryption failed, clearing field:', error);
        decrypted.password = null;
      }
    }
    if (decrypted.private_key) {
      try {
        if (isEncrypted(decrypted.private_key)) {
          decrypted.private_key = decrypt(decrypted.private_key);
        }
      } catch (error) {
        console.warn('[CONNECTIONS] Private key decryption failed, clearing field');
        decrypted.private_key = null;
      }
    }
    if (decrypted.passphrase) {
      try {
        if (isEncrypted(decrypted.passphrase)) {
          decrypted.passphrase = decrypt(decrypted.passphrase);
        }
      } catch (error) {
        console.warn('[CONNECTIONS] Passphrase decryption failed, clearing field');
        decrypted.passphrase = null;
      }
    }

    res.json({ success: true, data: toCamelCase(decrypted) });
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

    // Validate inputs
    if (!validateConnectionName(name)) {
      return res.status(400).json({ success: false, error: 'Invalid connection name' });
    }

    if (!validateHostname(host)) {
      return res.status(400).json({ success: false, error: 'Invalid hostname or IP address' });
    }

    const actualPort = port || (type === 'database' ? 3306 : type === 'ssh' ? 22 : 21);
    if (!validatePort(actualPort)) {
      return res.status(400).json({ success: false, error: 'Invalid port number' });
    }

    if (!['ssh', 'ftp', 'database'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid connection type' });
    }

    // Encrypt sensitive fields before storing
    const encryptedPassword = password ? encrypt(password) : null;
    const encryptedPrivateKey = privateKey ? encrypt(privateKey) : null;
    const encryptedPassphrase = passphrase ? encrypt(passphrase) : null;

    const result = db.prepare(`
      INSERT INTO connections (
        user_id, name, type, host, port, username, auth_type,
        password, private_key, passphrase,
        enable_terminal, enable_file_manager, enable_tunneling,
        default_path, tags, folder, database_type, database, ssl
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      sanitizeInput(name),
      type,
      host,
      actualPort,
      sanitizeInput(username),
      authType || 'password',
      encryptedPassword,
      encryptedPrivateKey,
      encryptedPassphrase,
      enableTerminal ? 1 : 0,
      enableFileManager ? 1 : 0,
      enableTunneling ? 1 : 0,
      defaultPath || '/',
      tags ? JSON.stringify(tags) : null,
      folder ? sanitizeInput(folder) : null,
      databaseType || null,
      database ? sanitizeInput(database) : null,
      ssl ? 1 : 0
    );

    const connection = db.prepare('SELECT * FROM connections WHERE id = ?').get(result.lastInsertRowid) as any;

    // Return connection without sensitive data
    const sanitized = { ...connection };
    delete sanitized.password;
    delete sanitized.private_key;
    delete sanitized.passphrase;

    res.json({ success: true, data: toCamelCase(sanitized) });
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

    console.log('[CONNECTIONS] Update connection request:', { id, userId });

    const connection = db.prepare(
      'SELECT id FROM connections WHERE id = ? AND user_id = ?'
    ).get(id, userId);

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    // Validate inputs if provided
    if (updateData.name && !validateConnectionName(updateData.name)) {
      return res.status(400).json({ success: false, error: 'Invalid connection name' });
    }
    if (updateData.host && !validateHostname(updateData.host)) {
      return res.status(400).json({ success: false, error: 'Invalid hostname' });
    }
    if (updateData.port && !validatePort(updateData.port)) {
      return res.status(400).json({ success: false, error: 'Invalid port number' });
    }

    const fields: string[] = [];
    const values: any[] = [];

    Object.keys(updateData).forEach(key => {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      let value = updateData[key];

      // Only update if value is not null/undefined, or explicitly allow null for password fields
      if (value !== undefined) {
        fields.push(`${snakeKey} = ?`);

        // Encrypt sensitive fields
        if (key === 'password' && value) {
          value = encrypt(value);
        } else if (key === 'privateKey' && value) {
          value = encrypt(value);
        } else if (key === 'passphrase' && value) {
          value = encrypt(value);
        }

        // Sanitize text inputs
        if (key === 'name' || key === 'username' || key === 'folder' || key === 'database') {
          value = sanitizeInput(value);
        }

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

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    db.prepare(
      `UPDATE connections SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
    ).run(...values);

    const updated = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as any;

    // Remove sensitive fields from response
    const sanitized = { ...updated };
    delete sanitized.password;
    delete sanitized.private_key;
    delete sanitized.passphrase;

    res.json({ success: true, data: toCamelCase(sanitized) });
  } catch (error: any) {
    console.error('Update connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update connection'
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
