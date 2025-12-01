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

const router = Router();
const db = getDatabase();

// Connect to server (SSH or FTP)
router.post('/connect', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { connectionId, password: providedPassword } = req.body;

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

    // Fix: Use proper null/undefined checking instead of falsy checking
    // If providedPassword is explicitly provided (even empty string), use it
    // Otherwise fall back to stored password
    const authPassword = providedPassword !== undefined ? providedPassword : connection.password;

    console.log('[FILES] Connect:', { connectionId, userId, type: connection.type, hasStoredPassword: !!connection.password, hasProvidedPassword: !!providedPassword });

    let result;
    if (connection.type === 'ssh') {
      result = await createSSHConnection(sessionId, {
        connectionId: connection.id,
        userId,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: authPassword,
        privateKey: connection.private_key,
        passphrase: connection.passphrase,
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
    const { sessionId, type } = req.body;

    if (!sessionId || !type) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
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
    const { sessionId, path, type } = req.query;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    console.log('[FILES] List request:', { sessionId, path: path || '/', type });

    if (type === 'ssh') {
      const files = await executeSFTPCommand(sessionId as string, 'list', { path: path || '/' });
      console.log('[FILES] Listed', files?.length || 0, 'items');
      res.json({ success: true, data: files });
    } else {
      const files = await listFTPFiles(sessionId as string, path as string || '/');
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
    const { sessionId, path, type } = req.query;

    if (!sessionId || !path) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (type === 'ssh') {
      const content = await executeSFTPCommand(sessionId as string, 'readFile', { path });
      res.json({ success: true, data: { content } });
    } else {
      const buffer = await downloadFTPFile(sessionId as string, path as string);
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
    const { sessionId, path, content, type } = req.body;

    if (!sessionId || !path) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    console.log('[FILES] Write request:', { sessionId, path, type, contentLength: content?.length });

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'writeFile', { path, content });
    } else {
      await uploadFTPFile(sessionId, path, content);
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
    const { sessionId, path, isDirectory, type } = req.body;

    if (!sessionId || !path) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'delete', { path, isDirectory });
    } else {
      await deleteFTPFile(sessionId, path, isDirectory);
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
    const { sessionId, oldPath, newPath, type } = req.body;

    if (!sessionId || !oldPath || !newPath) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'rename', { oldPath, newPath });
    } else {
      await renameFTPFile(sessionId, oldPath, newPath);
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
    const { sessionId, path, type } = req.body;

    if (!sessionId || !path) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (type === 'ssh') {
      await executeSFTPCommand(sessionId, 'mkdir', { path });
    } else {
      await createFTPDirectory(sessionId, path);
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
    const { sessionId, type } = req.query;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    let connected = false;
    if (type === 'ssh') {
      const session = getSSHSession(sessionId as string);
      connected = session?.isConnected || false;
    } else {
      const session = getFTPSession(sessionId as string);
      connected = session?.isConnected || false;
    }

    res.json({ success: true, data: { connected } });
  } catch (error: any) {
    console.error('[FILES] Status check error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to check status' });
  }
});

export default router;
