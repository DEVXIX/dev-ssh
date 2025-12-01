import { Router } from 'express';
import { getDatabase } from '../database/init.js';
import { AuthRequest } from '../middleware/auth.js';
import { getSSHSession } from '../services/ssh.js';
import net from 'net';

const router = Router();
const db = getDatabase();

interface ActiveTunnel {
  server: net.Server;
  connectionId: number;
  status: 'connected' | 'disconnected' | 'error';
}

const activeTunnels = new Map<string, ActiveTunnel>();

// Get all tunnels for a connection
router.get('/:connectionId', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { connectionId } = req.params;

    const tunnels = db.prepare(`
      SELECT t.* FROM tunnels t
      JOIN connections c ON t.connection_id = c.id
      WHERE t.connection_id = ? AND c.user_id = ?
    `).all(connectionId, userId);

    res.json({ success: true, data: tunnels });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create tunnel
router.post('/', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { connectionId, name, localPort, remoteHost, remotePort, type, autoStart } = req.body;

    // Verify connection ownership
    const connection = db.prepare(
      'SELECT id FROM connections WHERE id = ? AND user_id = ?'
    ).get(connectionId, userId);

    if (!connection) {
      return res.status(404).json({ success: false, error: 'Connection not found' });
    }

    const result = db.prepare(`
      INSERT INTO tunnels (connection_id, name, local_port, remote_host, remote_port, type, auto_start)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(connectionId, name, localPort, remoteHost, remotePort, type, autoStart ? 1 : 0);

    const tunnel = db.prepare('SELECT * FROM tunnels WHERE id = ?').get(result.lastInsertRowid);

    res.json({ success: true, data: tunnel });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start tunnel
router.post('/:tunnelId/start', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { tunnelId } = req.params;
    const { sessionId } = req.body;

    // Get tunnel details
    const tunnel = db.prepare(`
      SELECT t.*, c.user_id FROM tunnels t
      JOIN connections c ON t.connection_id = c.id
      WHERE t.id = ?
    `).get(tunnelId) as any;

    if (!tunnel || tunnel.user_id !== userId) {
      return res.status(404).json({ success: false, error: 'Tunnel not found' });
    }

    const sshSession = getSSHSession(sessionId);
    if (!sshSession || !sshSession.isConnected) {
      return res.status(400).json({ success: false, error: 'SSH session not connected' });
    }

    const tunnelKey = `${userId}-${tunnelId}`;

    // Close existing tunnel if any
    if (activeTunnels.has(tunnelKey)) {
      const existing = activeTunnels.get(tunnelKey)!;
      existing.server.close();
      activeTunnels.delete(tunnelKey);
    }

    // Create local server
    const server = net.createServer((localSocket) => {
      sshSession.client.forwardOut(
        '127.0.0.1',
        tunnel.local_port,
        tunnel.remote_host,
        tunnel.remote_port,
        (err, stream) => {
          if (err) {
            console.error('Tunnel forward error:', err);
            localSocket.end();
            return;
          }

          localSocket.pipe(stream).pipe(localSocket);

          localSocket.on('error', (err) => {
            console.error('Local socket error:', err);
          });

          stream.on('error', (err: Error) => {
            console.error('Stream error:', err);
          });
        }
      );
    });

    server.listen(tunnel.local_port, '127.0.0.1', () => {
      console.log(`Tunnel ${tunnel.name} started on port ${tunnel.local_port}`);
      
      activeTunnels.set(tunnelKey, {
        server,
        connectionId: tunnel.connection_id,
        status: 'connected',
      });

      // Update status in database
      db.prepare('UPDATE tunnels SET status = ? WHERE id = ?').run('connected', tunnelId);

      res.json({ success: true, message: 'Tunnel started' });
    });

    server.on('error', (err: any) => {
      console.error('Tunnel server error:', err);
      activeTunnels.delete(tunnelKey);
      db.prepare('UPDATE tunnels SET status = ? WHERE id = ?').run('error', tunnelId);
    });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop tunnel
router.post('/:tunnelId/stop', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { tunnelId } = req.params;

    const tunnelKey = `${userId}-${tunnelId}`;
    const tunnel = activeTunnels.get(tunnelKey);

    if (tunnel) {
      tunnel.server.close();
      activeTunnels.delete(tunnelKey);
    }

    db.prepare('UPDATE tunnels SET status = ? WHERE id = ?').run('disconnected', tunnelId);

    res.json({ success: true, message: 'Tunnel stopped' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete tunnel
router.delete('/:tunnelId', async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId;
    const { tunnelId } = req.params;

    // Stop tunnel if running
    const tunnelKey = `${userId}-${tunnelId}`;
    const tunnel = activeTunnels.get(tunnelKey);
    if (tunnel) {
      tunnel.server.close();
      activeTunnels.delete(tunnelKey);
    }

    // Delete from database
    const result = db.prepare(`
      DELETE FROM tunnels WHERE id = ? AND connection_id IN (
        SELECT id FROM connections WHERE user_id = ?
      )
    `).run(tunnelId, userId);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Tunnel not found' });
    }

    res.json({ success: true, message: 'Tunnel deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
