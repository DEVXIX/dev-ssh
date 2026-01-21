import { Router } from 'express';
import { getDatabase } from '../database/init.js';
import { AuthRequest } from '../middleware/auth.js';
import { createRDPSession, getRDPSession, closeRDPSession, generateRDPSessionId } from '../services/rdp.js';
import { decrypt, isEncrypted } from '../utils/encryption.js';

const router = Router();
const db = getDatabase();

// Connect to RDP server (creates session for WebSocket to use)
router.post('/connect', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { connectionId, password: providedPassword } = req.body;

    console.log('[RDP] Connect request:', { connectionId, userId });

    if (!connectionId) {
      return res.status(400).json({ success: false, error: 'Connection ID is required' });
    }

    const connection = db.prepare(
      'SELECT * FROM connections WHERE id = ? AND user_id = ? AND type = ?'
    ).get(connectionId, userId, 'rdp') as any;

    if (!connection) {
      return res.status(404).json({ success: false, error: 'RDP connection not found' });
    }

    const sessionId = generateRDPSessionId();

    // Decrypt stored password
    const storedPassword = connection.password
      ? (isEncrypted(connection.password) ? decrypt(connection.password) : connection.password)
      : null;

    const authPassword = providedPassword !== undefined ? providedPassword : storedPassword;

    // Create RDP session (actual connection happens via WebSocket)
    const session = createRDPSession(sessionId, {
      connectionId: connection.id,
      userId,
      host: connection.host,
      port: connection.port || 3389,
      username: connection.username,
      password: authPassword,
      domain: connection.domain || undefined,
      security: connection.rdp_security || 'any',
      width: connection.rdp_width || 1920,
      height: connection.rdp_height || 1080,
      colorDepth: connection.rdp_color_depth || 24,
      enableAudio: !!connection.rdp_audio,
      enableClipboard: connection.rdp_clipboard !== 0,
      enableDrives: !!connection.rdp_drives,
    });

    console.log(`[RDP] Session created: ${sessionId} for user ${userId}`);

    res.json({
      success: true,
      sessionId,
      config: {
        width: session.config.width,
        height: session.config.height,
        colorDepth: session.config.colorDepth,
      },
    });
  } catch (error: any) {
    console.error('[RDP] Connect error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to create RDP session' });
  }
});

// Disconnect RDP session
router.post('/disconnect', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    const session = getRDPSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    closeRDPSession(sessionId);
    console.log(`[RDP] Session disconnected: ${sessionId}`);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[RDP] Disconnect error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to disconnect' });
  }
});

// Get session status
router.get('/status/:sessionId', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const { sessionId } = req.params;

    const session = getRDPSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    if (session.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        isConnected: session.isConnected,
        config: {
          width: session.config.width,
          height: session.config.height,
          colorDepth: session.config.colorDepth,
        },
      },
    });
  } catch (error: any) {
    console.error('[RDP] Status error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get status' });
  }
});

export default router;
