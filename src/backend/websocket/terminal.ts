import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Client, PseudoTtyOptions } from 'ssh2';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../database/init.js';
import { getSSHSession } from '../services/ssh.js';

const db = getDatabase();

interface TerminalSession {
  client: Client;
  stream: any;
  connectionId: number;
  userId: number;
}

const terminalSessions = new Map<string, TerminalSession>();

export function handleTerminalWebSocket(ws: WebSocket, req: IncomingMessage) {
  console.log('handleTerminalWebSocket called');
  
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  
  console.log('Token present:', !!token);
  
  if (!token) {
    console.log('No token provided, closing connection');
    ws.close(1008, 'No token provided');
    return;
  }

  // Verify token
  let userId: number;
  try {
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    console.log('JWT_SECRET being used:', jwtSecret);
    const decoded = jwt.verify(token, jwtSecret) as any;
    userId = decoded.userId;
    console.log('Token verified, userId:', userId);
  } catch (error: any) {
    console.log('Invalid token, closing connection. Error:', error.message);
    ws.close(1008, 'Invalid token');
    return;
  }

  let sessionId: string;
  let terminalSession: TerminalSession | undefined;

  console.log('Setting up WebSocket message handlers...');
  
  // Keep connection alive with ping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) { // OPEN
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on('pong', () => {
    console.log('Received pong from client');
  });

  ws.on('message', async (data: Buffer) => {
    console.log('[TERMINAL] WebSocket message received:', data.toString().substring(0, 100));

    try {
      const message = JSON.parse(data.toString());
      console.log('[TERMINAL] Message type:', message.type);

      switch (message.type) {
        case 'connect':
          await handleConnect(ws, message.data, userId);
          sessionId = message.data.sessionId;
          break;

        case 'input':
          terminalSession = terminalSessions.get(sessionId);
          if (terminalSession?.stream) {
            terminalSession.stream.write(message.data);
          }
          break;

        case 'resize':
          terminalSession = terminalSessions.get(sessionId);
          if (terminalSession?.stream) {
            // Handle both message.data.rows and message.rows formats
            const rows = message.data?.rows || message.rows;
            const cols = message.data?.cols || message.cols;
            const height = message.data?.height || message.height || 480;
            const width = message.data?.width || message.width || 640;
            
            if (rows && cols) {
              terminalSession.stream.setWindow(rows, cols, height, width);
            }
          }
          break;

        case 'disconnect':
          if (sessionId) {
            closeTerminalSession(sessionId);
          }
          break;
      }
    } catch (error: any) {
      console.error('WebSocket message error:', error);
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify({
          type: 'error',
          data: error.message,
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed event fired');
    console.log('WebSocket close was', ws.readyState === 3 ? 'CLOSED' : 'unexpected state');
    console.trace('Close stack trace:');
    clearInterval(pingInterval);
    if (sessionId) {
      closeTerminalSession(sessionId);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error event fired:', error);
    if (sessionId) {
      closeTerminalSession(sessionId);
    }
  });
  
  console.log('[TERMINAL] WebSocket handlers registered successfully');
}

async function handleConnect(ws: WebSocket, data: any, userId: number) {
  const { connectionId, sessionId, cols, rows } = data;

  console.log(`=== HANDLE CONNECT START ===`);
  console.log(`handleConnect called with sessionId: ${sessionId}, userId: ${userId}`);
  console.log(`Connection ID: ${connectionId}, Cols: ${cols}, Rows: ${rows}`);

  // Get the existing SSH session
  const sshSession = getSSHSession(sessionId);
  
  console.log(`SSH session lookup result:`);
  console.log(`  - Found: ${!!sshSession}`);
  console.log(`  - Is Connected: ${sshSession?.isConnected}`);
  console.log(`  - User ID matches: ${sshSession?.userId === userId}`);
  
  if (!sshSession || !sshSession.isConnected) {
    console.error(`[TERMINAL] SSH session ${sessionId} not found or not connected`);
    if (ws.readyState === 1) { // WebSocket.OPEN
      console.log('Sending error message to client...');
      ws.send(JSON.stringify({
        type: 'error',
        data: 'SSH session not found or not connected. Please reconnect.',
      }));
    }
    console.log(`=== HANDLE CONNECT END (ERROR) ===`);
    return;
  }

  // Verify the connection belongs to the user
  if (sshSession.userId !== userId) {
    console.error(`[TERMINAL] Unauthorized: Session belongs to user ${sshSession.userId}, but request from user ${userId}`);
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({
        type: 'error',
        data: 'Unauthorized access to SSH session',
      }));
    }
    console.log(`=== HANDLE CONNECT END (UNAUTHORIZED) ===`);
    return;
  }

  console.log(`[TERMINAL] Authorization passed`);
  console.log(`Opening terminal shell for session ${sessionId}...`);
  
  const ptyOptions: PseudoTtyOptions = {
    cols: cols || 80,
    rows: rows || 24,
    term: 'xterm-256color',
  };

  // Use the existing SSH client to open a shell
  sshSession.client.shell(ptyOptions, (err: any, stream: any) => {
    if (err) {
      console.error(`[TERMINAL] Failed to open shell for session ${sessionId}:`, err);
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify({
          type: 'error',
          data: err.message,
        }));
      }
      console.log(`=== HANDLE CONNECT END (SHELL ERROR) ===`);
      return;
    }

    console.log(`[TERMINAL] Terminal shell opened for session ${sessionId}`);

    terminalSessions.set(sessionId, {
      client: sshSession.client,
      stream,
      connectionId,
      userId,
    });

    stream.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: data.toString('utf8'),
        }));
      }
    });

    stream.on('close', () => {
      console.log(`Terminal stream closed for session ${sessionId}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'disconnected',
        }));
      }
      closeTerminalSession(sessionId);
    });

    stream.stderr.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: data.toString('utf8'),
        }));
      }
    });

    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({
        type: 'connected',
      }));
      console.log(`✅ Sent 'connected' message to client`);
    } else {
      console.log(`⚠️  WebSocket not open (state: ${ws.readyState}), cannot send connected message`);
    }
    
    console.log(`=== HANDLE CONNECT END (SUCCESS) ===`);
  });
}

function closeTerminalSession(sessionId: string) {
  const session = terminalSessions.get(sessionId);
  if (session) {
    if (session.stream) {
      session.stream.end();
    }
    // Don't close the SSH client here - it's managed by the SSH service
    // and might be used for file operations too
    terminalSessions.delete(sessionId);
    console.log(`Terminal session ${sessionId} closed (stream only)`);
  }
}
