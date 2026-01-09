import { Router, Request, Response } from 'express';
import { getDatabase } from '../database/init.js';
import { AuthRequest } from '../middleware/auth.js';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption.js';
import { storageService } from '../services/storage.js';
import multer from 'multer';

const router = Router();
const db = getDatabase();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

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

// Helper function to convert camelCase to snake_case
function toSnakeCase(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const converted: any = {};
  for (const key in obj) {
    const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    converted[snakeKey] = obj[key];
  }

  return converted;
}

// Get all storage connections for user
router.get('/connections', (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;

    const connections = db.prepare(
      'SELECT * FROM storage_connections WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId) as any[];

    // Remove sensitive fields from list view
    const sanitizedConnections = connections.map(conn => {
      const sanitized = { ...conn };
      delete sanitized.secret_key;
      return sanitized;
    });

    res.json({ success: true, data: toCamelCase(sanitizedConnections) });
  } catch (error) {
    console.error('[STORAGE] Get connections error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch storage connections' });
  }
});

// Get single storage connection
router.get('/connections/:id', (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { id } = req.params;

    const connection = db.prepare(
      'SELECT * FROM storage_connections WHERE id = ? AND user_id = ?'
    ).get(id, userId) as any;

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Storage connection not found' });
    }

    // Decrypt secret key
    const decrypted = { ...connection };
    if (decrypted.secret_key && isEncrypted(decrypted.secret_key)) {
      decrypted.secret_key = decrypt(decrypted.secret_key);
    }

    res.json({ success: true, data: toCamelCase(decrypted) });
  } catch (error) {
    console.error('[STORAGE] Get connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch storage connection' });
  }
});

// Create storage connection
router.post('/connections', (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { name, type, endpoint, port, accessKey, secretKey, region, useSsl, bucket } = req.body;

    if (!name || !type || !endpoint || !accessKey || !secretKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, type, endpoint, accessKey, secretKey'
      });
    }

    // Encrypt secret key
    const encryptedSecretKey = encrypt(secretKey);

    const result = db.prepare(`
      INSERT INTO storage_connections (user_id, name, type, endpoint, port, access_key, secret_key, region, use_ssl, bucket)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, name, type, endpoint, port || null, accessKey, encryptedSecretKey, region || null, useSsl ? 1 : 0, bucket || null);

    const connection = db.prepare(
      'SELECT * FROM storage_connections WHERE id = ?'
    ).get(result.lastInsertRowid) as any;

    // Remove secret key from response
    const sanitized = { ...connection };
    delete sanitized.secret_key;

    res.json({ success: true, data: toCamelCase(sanitized) });
  } catch (error) {
    console.error('[STORAGE] Create connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to create storage connection' });
  }
});

// Update storage connection
router.put('/connections/:id', (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { id } = req.params;
    const { name, type, endpoint, port, accessKey, secretKey, region, useSsl, bucket } = req.body;

    // Check if connection exists and belongs to user
    const existing = db.prepare(
      'SELECT * FROM storage_connections WHERE id = ? AND user_id = ?'
    ).get(id, userId);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Storage connection not found' });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (type !== undefined) {
      updates.push('type = ?');
      values.push(type);
    }
    if (endpoint !== undefined) {
      updates.push('endpoint = ?');
      values.push(endpoint);
    }
    if (port !== undefined) {
      updates.push('port = ?');
      values.push(port);
    }
    if (accessKey !== undefined) {
      updates.push('access_key = ?');
      values.push(accessKey);
    }
    if (secretKey !== undefined) {
      updates.push('secret_key = ?');
      values.push(encrypt(secretKey));
    }
    if (region !== undefined) {
      updates.push('region = ?');
      values.push(region);
    }
    if (useSsl !== undefined) {
      updates.push('use_ssl = ?');
      values.push(useSsl ? 1 : 0);
    }
    if (bucket !== undefined) {
      updates.push('bucket = ?');
      values.push(bucket);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id, userId);

    db.prepare(`
      UPDATE storage_connections
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `).run(...values);

    const connection = db.prepare(
      'SELECT * FROM storage_connections WHERE id = ?'
    ).get(id) as any;

    // Remove secret key from response
    const sanitized = { ...connection };
    delete sanitized.secret_key;

    res.json({ success: true, data: toCamelCase(sanitized) });
  } catch (error) {
    console.error('[STORAGE] Update connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to update storage connection' });
  }
});

// Delete storage connection
router.delete('/connections/:id', (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { id } = req.params;

    const result = db.prepare(
      'DELETE FROM storage_connections WHERE id = ? AND user_id = ?'
    ).run(id, userId);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Storage connection not found' });
    }

    res.json({ success: true, message: 'Storage connection deleted' });
  } catch (error) {
    console.error('[STORAGE] Delete connection error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete storage connection' });
  }
});

// Connect to storage
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { storageConnectionId } = req.body;

    if (!storageConnectionId) {
      return res.status(400).json({ success: false, error: 'Storage connection ID is required' });
    }

    // Get connection details
    const connection = db.prepare(
      'SELECT * FROM storage_connections WHERE id = ? AND user_id = ?'
    ).get(storageConnectionId, userId) as any;

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Storage connection not found' });
    }

    // Decrypt secret key
    const secretKey = isEncrypted(connection.secret_key)
      ? decrypt(connection.secret_key)
      : connection.secret_key;

    // Connect using storage service
    const sessionId = await storageService.connect(
      connection.id,
      userId,
      {
        endpoint: connection.endpoint,
        port: connection.port,
        accessKey: connection.access_key,
        secretKey: secretKey,
        useSSL: !!connection.use_ssl,
        region: connection.region,
      }
    );

    res.json({
      success: true,
      data: {
        sessionId,
        storageConnectionId: connection.id,
        name: connection.name,
        type: connection.type,
      }
    });
  } catch (error: any) {
    console.error('[STORAGE] Connect error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to connect to storage' });
  }
});

// Disconnect from storage
router.post('/disconnect/:sessionId', (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId } = req.params;

    storageService.disconnect(sessionId, userId);

    res.json({ success: true, message: 'Disconnected from storage' });
  } catch (error: any) {
    console.error('[STORAGE] Disconnect error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to disconnect' });
  }
});

// List buckets
router.get('/buckets/:sessionId', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId } = req.params;

    const buckets = await storageService.listBuckets(sessionId, userId);

    res.json({ success: true, data: buckets });
  } catch (error: any) {
    console.error('[STORAGE] List buckets error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to list buckets' });
  }
});

// Create bucket
router.post('/buckets/:sessionId', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId } = req.params;
    const { bucketName, region } = req.body;

    if (!bucketName) {
      return res.status(400).json({ success: false, error: 'Bucket name is required' });
    }

    await storageService.createBucket(sessionId, userId, bucketName, region);

    res.json({ success: true, message: 'Bucket created successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Create bucket error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create bucket' });
  }
});

// Delete bucket
router.delete('/buckets/:sessionId/:bucketName', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName } = req.params;

    await storageService.deleteBucket(sessionId, userId, bucketName);

    res.json({ success: true, message: 'Bucket deleted successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Delete bucket error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete bucket' });
  }
});

// List objects in bucket
router.get('/objects/:sessionId/:bucketName', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName } = req.params;
    const { prefix = '', recursive = 'false' } = req.query;

    const objects = await storageService.listObjects(
      sessionId,
      userId,
      bucketName,
      prefix as string,
      recursive === 'true'
    );

    res.json({ success: true, data: objects });
  } catch (error: any) {
    console.error('[STORAGE] List objects error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to list objects' });
  }
});

// Create folder (empty object with trailing slash)
router.post('/folders/:sessionId/:bucketName', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName } = req.params;
    const { folderName } = req.body;

    if (!folderName) {
      return res.status(400).json({ success: false, error: 'Folder name is required' });
    }

    // Ensure folder name ends with /
    const folderPath = folderName.endsWith('/') ? folderName : `${folderName}/`;

    // Create an empty object to represent the folder
    await storageService.uploadObject(
      sessionId,
      userId,
      bucketName,
      folderPath,
      Buffer.from(''),
      'application/x-directory'
    );

    res.json({ success: true, message: 'Folder created successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Create folder error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create folder' });
  }
});

// Copy object (must be before upload route to avoid matching conflict)
router.post('/objects/:sessionId/copy', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId } = req.params;
    const { sourceBucket, sourceObject, destBucket, destObject } = req.body;

    if (!sourceBucket || !sourceObject || !destBucket || !destObject) {
      return res.status(400).json({
        success: false,
        error: 'Source and destination bucket/object names are required'
      });
    }

    await storageService.copyObject(
      sessionId,
      userId,
      sourceBucket,
      sourceObject,
      destBucket,
      destObject
    );

    res.json({ success: true, message: 'Object copied successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Copy object error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to copy object' });
  }
});

// Upload object
router.post('/objects/:sessionId/:bucketName', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName } = req.params;
    const { objectName } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    if (!objectName) {
      return res.status(400).json({ success: false, error: 'Object name is required' });
    }

    await storageService.uploadObject(
      sessionId,
      userId,
      bucketName,
      objectName,
      req.file.buffer,
      req.file.mimetype
    );

    res.json({ success: true, message: 'File uploaded successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Upload error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to upload file' });
  }
});

// Download/View object (inline for images, download for others)
router.get('/objects/:sessionId/:bucketName/:objectName(*)', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName, objectName } = req.params;
    const { download } = req.query;

    const data = await storageService.downloadObject(sessionId, userId, bucketName, objectName);

    // Get object info for content type
    const info = await storageService.getObjectInfo(sessionId, userId, bucketName, objectName);
    const contentType = info.contentType || 'application/octet-stream';

    res.setHeader('Content-Type', contentType);

    // Only force download if explicitly requested or if not an image
    const isImage = contentType.startsWith('image/');
    if (download === 'true' || !isImage) {
      res.setHeader('Content-Disposition', `attachment; filename="${objectName.split('/').pop()}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${objectName.split('/').pop()}"`);
    }

    res.send(data);
  } catch (error: any) {
    console.error('[STORAGE] Download error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to download file' });
  }
});

// Delete folder (recursively delete all objects with the folder prefix)
router.delete('/folders/:sessionId/:bucketName/:folderPath(*)', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName, folderPath } = req.params;

    // Ensure folder path ends with /
    const normalizedPath = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

    // List all objects with this prefix
    const objects = await storageService.listObjects(sessionId, userId, bucketName, normalizedPath, true);

    // Delete all objects in the folder
    if (objects.length > 0) {
      const objectPaths = objects.map(obj => obj.path);
      await storageService.deleteObjects(sessionId, userId, bucketName, objectPaths);
    }

    // Also delete the folder placeholder itself
    try {
      await storageService.deleteObject(sessionId, userId, bucketName, normalizedPath);
    } catch (e) {
      // Ignore if folder placeholder doesn't exist
    }

    res.json({ success: true, message: 'Folder deleted successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Delete folder error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete folder' });
  }
});

// Delete object
router.delete('/objects/:sessionId/:bucketName/:objectName(*)', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName, objectName } = req.params;

    await storageService.deleteObject(sessionId, userId, bucketName, objectName);

    res.json({ success: true, message: 'Object deleted successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Delete object error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete object' });
  }
});

// Delete multiple objects
router.post('/objects/:sessionId/:bucketName/delete-batch', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName } = req.params;
    const { objectNames } = req.body;

    if (!Array.isArray(objectNames) || objectNames.length === 0) {
      return res.status(400).json({ success: false, error: 'Object names array is required' });
    }

    await storageService.deleteObjects(sessionId, userId, bucketName, objectNames);

    res.json({ success: true, message: 'Objects deleted successfully' });
  } catch (error: any) {
    console.error('[STORAGE] Batch delete error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to delete objects' });
  }
});

// Get presigned URL
router.get('/presigned-url/:sessionId/:bucketName/:objectName(*)', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName, objectName } = req.params;
    const { expiry = '3600' } = req.query;

    const url = await storageService.getPresignedUrl(
      sessionId,
      userId,
      bucketName,
      objectName,
      parseInt(expiry as string)
    );

    res.json({ success: true, data: { url } });
  } catch (error: any) {
    console.error('[STORAGE] Presigned URL error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate presigned URL' });
  }
});

// Get object info
router.get('/info/:sessionId/:bucketName/:objectName(*)', async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId, bucketName, objectName } = req.params;

    const info = await storageService.getObjectInfo(sessionId, userId, bucketName, objectName);

    res.json({ success: true, data: info });
  } catch (error: any) {
    console.error('[STORAGE] Get object info error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get object info' });
  }
});

// Get session info
router.get('/session/:sessionId', (req: Request, res: Response) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { sessionId } = req.params;

    const sessionInfo = storageService.getSessionInfo(sessionId, userId);

    res.json({ success: true, data: sessionInfo });
  } catch (error: any) {
    console.error('[STORAGE] Get session info error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get session info' });
  }
});

export default router;
