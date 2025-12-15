import { Router } from 'express';
import { getDatabase } from '../database/init.js';
import { AuthRequest } from '../middleware/auth.js';
import {
  createSSHConnection,
  closeSSHConnection,
  executeSFTPCommand,
  generateSessionId,
  getSSHSession,
} from '../services/ssh.js';
import {
  createFTPConnection,
  closeFTPConnection,
  generateFTPSessionId,
  getFTPSession,
  listFTPFiles,
  downloadFTPFile,
  uploadFTPFile,
  deleteFTPFile,
  renameFTPFile,
  createFTPDirectory,
} from '../services/ftp.js';
import { decrypt } from '../utils/encryption.js';
import { validatePath, validateSessionId, validateFileSize } from '../utils/validation.js';

const router = Router();
const db = getDatabase();

// Connect to server (SSH or FTP)
router.post('/connect', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { connectionId, password: providedPassword } = req.body;

    console.log('[FILES] Connect REQUEST BODY:', req.body);

    if (!connectionId) {
      return res.status(400).json({ success: false, error: 'Connection ID is required' });
    }

    const connection = db.prepare(
      'SELECT * FROM connections WHERE id = ? AND user_id = ?'
    ).get(connectionId, userId) as any;

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    const sessionId = connection.type === 'ssh' ? generateSessionId() : generateFTPSessionId();

    // Decrypt stored credentials
    const storedPassword = connection.password ? decrypt(connection.password) : null;
    const storedPrivateKey = connection.private_key ? decrypt(connection.private_key) : null;
    const storedPassphrase = connection.passphrase ? decrypt(connection.passphrase) : null;

    // Fix: Use proper null/undefined checking instead of falsy checking
    // If providedPassword is explicitly provided (even empty string), use it
    // Otherwise fall back to stored password
    const authPassword = providedPassword !== undefined ? providedPassword : storedPassword;

    console.log('[FILES] Connect:', {
      connectionId,
      userId,
      type: connection.type,
      hasStoredPassword: !!storedPassword,
      hasProvidedPassword: providedPassword !== undefined,
      willUsePassword: !!authPassword
    });

    let result;
    if (connection.type === 'ssh') {
      result = await createSSHConnection(sessionId, {
        connectionId: connection.id,
        userId,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: authPassword,
        privateKey: storedPrivateKey || undefined,
        passphrase: storedPassphrase || undefined,
      });
    } else {
      result = await createFTPConnection(sessionId, {
        connectionId: connection.id,
        userId,
        host: connection.host,
        port: connection.port,
        user: connection.username,
        password: authPassword,
        secure: false,
      });
    }

    if (result.success) {
      console.log('[FILES] Connected successfully:', sessionId);
      res.json({ success: true, data: { sessionId, type: connection.type } });
    } else {
      console.log('[FILES] Connection failed:', result.error);
      res.status(500).json({ success: false, error: 'Connection failed' });
    }
  } catch (error: any) {
    console.error('[FILES] Connection error:', error);
    res.status(500).json({ success: false, error: 'Connection failed' });
  }
});

// Disconnect session
router.post('/disconnect', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, type } = req.body;

    if (!sessionId || !type) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Validate session ID format
    if (!validateSessionId(sessionId)) {
      return res.status(400).json({ success: false, error: 'Invalid session ID' });
    }

    // Verify session ownership
    const session = type === 'ssh' ? getSSHSession(sessionId) : getFTPSession(sessionId);
    if (session && session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    if (type === 'ssh') {
      closeSSHConnection(sessionId);
    } else {
      closeFTPConnection(sessionId);
    }

    console.log('[FILES] Disconnected:', sessionId);
    res.json({ success: true, message: 'Disconnected' });
  } catch (error: any) {
    console.error('[FILES] Disconnect error:', error);
    res.status(500).json({ success: false, error: 'Disconnection failed' });
  }
});

// List files
router.get('/list', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, path, type } = req.query;

    if (!sessionId || !validateSessionId(sessionId as string)) {
      return res.status(400).json({ success: false, error: 'Invalid session ID' });
    }

    // Verify session ownership
    const session = type === 'ssh' ? getSSHSession(sessionId as string) : getFTPSession(sessionId as string);
    if (!session || session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Validate and normalize path to prevent traversal
    const safePath = path ? validatePath(path as string) : '/';

    console.log('[FILES] List request:', { sessionId, path: safePath, type });

    if (type === 'ssh') {
      const files = await executeSFTPCommand(sessionId as string, 'list', { path: safePath });
      console.log('[FILES] Listed', files?.length || 0, 'items');
      res.json({ success: true, data: files });
    } else {
      const files = await listFTPFiles(sessionId as string, safePath);
      console.log('[FILES] Listed', files?.length || 0, 'items');
      res.json({ success: true, data: files });
    }
  } catch (error: any) {
    console.error('[FILES] List error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list files' });
  }
});

// Read file
router.get('/read', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, path, type } = req.query;

    if (!sessionId || !path || !validateSessionId(sessionId as string)) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required fields' });
    }

    // Verify session ownership
    const session = type === 'ssh' ? getSSHSession(sessionId as string) : getFTPSession(sessionId as string);
    if (!session || session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Validate path to prevent traversal
    const safePath = validatePath(path as string);

    if (type === 'ssh') {
      const content = await executeSFTPCommand(sessionId as string, 'readFile', { path: safePath });
      res.json({ success: true, data: { content } });
    } else {
      const buffer = await downloadFTPFile(sessionId as string, safePath);
      res.json({ success: true, data: { content: buffer.toString('utf8') } });
    }
  } catch (error: any) {
    console.error('[FILES] Read error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to read file' });
  }
});

// Write file
router.post('/write', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, path, content, type } = req.body;

    if (!sessionId || !path || !validateSessionId(sessionId)) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required fields' });
    }

    // Verify session ownership
    const session = type === 'ssh' ? getSSHSession(sessionId) : getFTPSession(sessionId);
    if (!session || session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Validate path
    const safePath = validatePath(path);

    // Validate file size (10MB limit)
    const contentSize = content ? Buffer.byteLength(content, 'utf8') : 0;
    if (!validateFileSize(contentSize)) {
      return res.status(413).json({ success: false, error: 'File size exceeds 10MB limit' });
    }

    console.log('[FILES] Write request:', { sessionId, path: safePath, type, contentLength: contentSize });

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'writeFile', { path: safePath, content });
    } else {
      await uploadFTPFile(sessionId, safePath, content);
    }

    console.log('[FILES] File saved');
    res.json({ success: true, message: 'File saved' });
  } catch (error: any) {
    console.error('[FILES] Write error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save file' });
  }
});

// Delete file/directory
router.delete('/delete', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, path, isDirectory, type } = req.body;

    if (!sessionId || !path || !validateSessionId(sessionId)) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required fields' });
    }

    // Verify session ownership
    const session = type === 'ssh' ? getSSHSession(sessionId) : getFTPSession(sessionId);
    if (!session || session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Validate path
    const safePath = validatePath(path);

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'delete', { path: safePath, isDirectory });
    } else {
      await deleteFTPFile(sessionId, safePath, isDirectory);
    }

    res.json({ success: true, message: 'Deleted successfully' });
  } catch (error: any) {
    console.error('[FILES] Delete error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete' });
  }
});

// Rename/move file
router.post('/rename', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, oldPath, newPath, type } = req.body;

    if (!sessionId || !oldPath || !newPath || !validateSessionId(sessionId)) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required fields' });
    }

    // Verify session ownership
    const session = type === 'ssh' ? getSSHSession(sessionId) : getFTPSession(sessionId);
    if (!session || session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Validate paths
    const safeOldPath = validatePath(oldPath);
    const safeNewPath = validatePath(newPath);

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'rename', { oldPath: safeOldPath, newPath: safeNewPath });
    } else {
      await renameFTPFile(sessionId, safeOldPath, safeNewPath);
    }

    res.json({ success: true, message: 'Renamed successfully' });
  } catch (error: any) {
    console.error('[FILES] Rename error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to rename' });
  }
});

// Create directory
router.post('/mkdir', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, path, type } = req.body;

    if (!sessionId || !path || !validateSessionId(sessionId)) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required fields' });
    }

    // Verify session ownership
    const session = type === 'ssh' ? getSSHSession(sessionId) : getFTPSession(sessionId);
    if (!session || session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Validate path
    const safePath = validatePath(path);

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'mkdir', { path: safePath });
    } else {
      await createFTPDirectory(sessionId, safePath);
    }

    res.json({ success: true, message: 'Directory created' });
  } catch (error: any) {
    console.error('[FILES] Mkdir error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create directory' });
  }
});

// Check session status
router.get('/status', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId, type } = req.query;

    if (!sessionId || !validateSessionId(sessionId as string)) {
      return res.status(400).json({ success: false, error: 'Invalid session ID' });
    }

    let connected = false;
    if (type === 'ssh') {
      const session = getSSHSession(sessionId as string);
      // Verify ownership
      if (session && session.userId !== userId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }
      connected = session?.isConnected || false;
    } else {
      const session = getFTPSession(sessionId as string);
      // Verify ownership
      if (session && session.userId !== userId) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }
      connected = session?.isConnected || false;
    }

    res.json({ success: true, data: { connected } });
  } catch (error: any) {
    console.error('[FILES] Status check error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to check status' });
  }
});

export default router;
