import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage, Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import net from 'net';
import { getRDPSession, setRDPConnected, closeRDPSession, RDPSession } from '../services/rdp.js';

// Guacd connection settings
const GUACD_HOST = process.env.GUACD_HOST || '127.0.0.1';
const GUACD_PORT = parseInt(process.env.GUACD_PORT || '4822');

interface RDPGuacSession {
  sessionId: string;
  connectionId: number;
  userId: number;
  guacdSocket: net.Socket | null;
  webSocket: WebSocket;
  rdpSession: RDPSession;
  handshakeComplete: boolean;
  buffer: string;
}

const activeSessions = new Map<string, RDPGuacSession>();

/**
 * Encode a Guacamole instruction
 * Format: length.value,length.value,...;
 */
function encodeGuacInstruction(elements: (string | null | undefined)[]): string {
  return elements.map(el => {
    const str = el === null || el === undefined ? '' : String(el);
    return `${str.length}.${str}`;
  }).join(',') + ';';
}

/**
 * Parse a single Guacamole instruction from a buffer
 * Returns the parsed instruction elements or null if incomplete
 */
function parseGuacInstruction(data: string): { elements: string[], consumed: number } | null {
  const elements: string[] = [];
  let pos = 0;

  while (pos < data.length) {
    // Find the length prefix
    const dotPos = data.indexOf('.', pos);
    if (dotPos === -1) return null;

    const length = parseInt(data.substring(pos, dotPos));
    if (isNaN(length)) return null;

    // Extract the value
    const valueStart = dotPos + 1;

    // Check if we have enough data
    if (valueStart + length > data.length) {
      return null; // Incomplete instruction
    }

    const value = data.substring(valueStart, valueStart + length);
    elements.push(value);

    pos = valueStart + length;

    // Check for separator or terminator
    if (pos < data.length) {
      const sep = data[pos];
      pos++;
      if (sep === ';') {
        // Complete instruction
        return { elements, consumed: pos };
      } else if (sep !== ',') {
        return null; // Invalid separator
      }
    } else {
      return null; // Need more data
    }
  }

  return null;
}

/**
 * Intercept the 'select' instruction from client and replace with our RDP config
 */
function interceptClientHandshake(
  session: RDPGuacSession,
  message: string
): string | null {
  // Parse the instruction
  const result = parseGuacInstruction(message);
  if (!result) return message; // Pass through if can't parse

  const [opcode, ...args] = result.elements;
  const config = session.rdpSession.config;

  // If client sends 'select', we need to intercept and use our stored config
  if (opcode === 'select') {
    console.log('[RDP-GUAC] Intercepted select instruction, protocol:', args[0]);
    // Just pass it through - client wants RDP
    return message;
  }

  // If client sends 'connect' with their query data, intercept and build proper RDP args
  if (opcode === 'connect') {
    console.log('[RDP-GUAC] Intercepted connect instruction from client');
    // The args sent by client are query params (token, sessionId)
    // We need to wait for guacd to send args first
    // For now, pass through and let guacd handle it
    return message;
  }

  // Pass through other instructions
  return message;
}

/**
 * Handle RDP WebSocket connections using Guacamole protocol
 * This acts as a transparent proxy between the browser client and guacd
 */
export function handleRDPGuacWebSocket(ws: WebSocket, req: IncomingMessage) {
  console.log('[RDP-GUAC] WebSocket connection initiated');

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const sessionId = url.searchParams.get('sessionId');

  if (!token) {
    console.log('[RDP-GUAC] No token provided');
    ws.close(1008, 'No token provided');
    return;
  }

  if (!sessionId) {
    console.log('[RDP-GUAC] No sessionId provided');
    ws.close(1008, 'No sessionId provided');
    return;
  }

  // Verify JWT token
  let userId: number;
  try {
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, jwtSecret) as any;
    userId = decoded.userId;
    console.log('[RDP-GUAC] Token verified, userId:', userId);
  } catch (error: any) {
    console.log('[RDP-GUAC] Invalid token:', error.message);
    ws.close(1008, 'Invalid token');
    return;
  }

  // Get the RDP session
  const rdpSession = getRDPSession(sessionId);
  if (!rdpSession) {
    console.log('[RDP-GUAC] Session not found:', sessionId);
    ws.send(encodeGuacInstruction(['error', 'Session not found', '519']));
    ws.close(1008, 'Session not found');
    return;
  }

  if (rdpSession.userId !== userId) {
    console.log('[RDP-GUAC] Unauthorized access');
    ws.close(1008, 'Unauthorized');
    return;
  }

  // Create session object
  const session: RDPGuacSession = {
    sessionId,
    connectionId: rdpSession.connectionId,
    userId,
    guacdSocket: null,
    webSocket: ws,
    rdpSession,
    handshakeComplete: false,
    buffer: '',
  };

  activeSessions.set(sessionId, session);

  // Connect to guacd
  console.log(`[RDP-GUAC] Connecting to guacd at ${GUACD_HOST}:${GUACD_PORT}`);

  const guacdSocket = new net.Socket();
  session.guacdSocket = guacdSocket;

  let guacdBuffer = '';
  let expectingArgs = false;
  let guacdArgs: string[] = [];

  guacdSocket.connect(GUACD_PORT, GUACD_HOST, () => {
    console.log('[RDP-GUAC] Connected to guacd');

    // Send initial select instruction for RDP
    const selectInstruction = encodeGuacInstruction(['select', 'rdp']);
    console.log('[RDP-GUAC] Sending to guacd:', selectInstruction);
    guacdSocket.write(selectInstruction);
    expectingArgs = true;
  });

  guacdSocket.on('data', (data: Buffer) => {
    guacdBuffer += data.toString('utf-8');

    // Process all complete instructions
    while (true) {
      const result = parseGuacInstruction(guacdBuffer);
      if (!result) break;

      const instruction = result.elements;
      guacdBuffer = guacdBuffer.substring(result.consumed);

      const opcode = instruction[0];

      // Log instruction (truncate for readability)
      const logArgs = instruction.slice(1, 4).join(',');
      console.log(`[RDP-GUAC] From guacd: ${opcode} ${logArgs.substring(0, 50)}${logArgs.length > 50 ? '...' : ''}`);

      if (expectingArgs && opcode === 'args') {
        // guacd is telling us what args it needs
        expectingArgs = false;
        guacdArgs = instruction.slice(1);
        console.log('[RDP-GUAC] Guacd expects args:', guacdArgs.length);

        // Build the connect args using our RDP session config
        const config = rdpSession.config;

        // First send size instruction - default to 1920x1080
        const sizeInstruction = encodeGuacInstruction([
          'size',
          String(config.width || 1920),
          String(config.height || 1080),
          '96' // dpi
        ]);
        console.log('[RDP-GUAC] Sending size:', sizeInstruction);
        guacdSocket.write(sizeInstruction);

        // Send audio instruction
        const audioInstruction = encodeGuacInstruction(['audio', 'audio/L16', 'audio/L8']);
        guacdSocket.write(audioInstruction);

        // Send video instruction
        const videoInstruction = encodeGuacInstruction(['video']);
        guacdSocket.write(videoInstruction);

        // Send image instruction
        const imageInstruction = encodeGuacInstruction(['image', 'image/jpeg', 'image/png', 'image/webp']);
        guacdSocket.write(imageInstruction);

        // Send timezone for protocol 1.1.0+
        const tz = 'America/New_York'; // Default timezone
        const tzInstruction = encodeGuacInstruction(['timezone', tz]);
        guacdSocket.write(tzInstruction);

        // Build RDP settings map
        const rdpSettings: Record<string, string> = {
          'hostname': config.host,
          'port': String(config.port || 3389),
          'username': config.username || '',
          'password': config.password || '',
          'domain': config.domain || '',
          'security': config.security || 'any',
          'ignore-cert': 'true',
          'disable-auth': '',
          'width': String(config.width || 1920),
          'height': String(config.height || 1080),
          'dpi': '96',
          'color-depth': String(config.colorDepth || 24),
          'resize-method': 'display-update',
          'disable-audio': config.enableAudio ? '' : 'true',
          'enable-audio-input': '',
          'enable-printing': '',
          'enable-drive': config.enableDrives ? 'true' : '',
          'drive-path': '/drive',
          'create-drive-path': 'true',
          'disable-copy': config.enableClipboard ? '' : 'true',
          'disable-paste': config.enableClipboard ? '' : 'true',
          'console': '',
          'server-layout': '',
          'timezone': tz,
          'enable-wallpaper': '',
          'enable-theming': '',
          'enable-font-smoothing': 'true',
          'enable-full-window-drag': '',
          'enable-desktop-composition': '',
          'enable-menu-animations': '',
          'disable-bitmap-caching': '',
          'disable-offscreen-caching': '',
          'disable-glyph-caching': '',
        };

        // Build connect args in the order guacd expects
        const connectArgs: string[] = [];
        for (const argName of guacdArgs) {
          if (argName.startsWith('VERSION_')) {
            connectArgs.push('VERSION_1_1_0');
          } else if (rdpSettings[argName] !== undefined) {
            connectArgs.push(rdpSettings[argName]);
          } else {
            connectArgs.push(''); // Empty for unknown args
          }
        }

        // Send connect instruction
        const connectInstruction = encodeGuacInstruction(['connect', ...connectArgs]);
        console.log(`[RDP-GUAC] Sending connect with ${connectArgs.length} args`);
        guacdSocket.write(connectInstruction);

        // Don't forward 'args' to client - we handled it ourselves
        continue;
      }

      if (opcode === 'ready') {
        session.handshakeComplete = true;
        setRDPConnected(sessionId, true);
        console.log('[RDP-GUAC] Handshake complete, connection ready');
      }

      if (opcode === 'error') {
        const errorMessage = instruction[1] || 'Unknown error';
        const errorCode = instruction[2] || '0';
        console.error(`[RDP-GUAC] Guacd error: ${errorMessage} (code: ${errorCode})`);
      }

      // Forward instruction to WebSocket client
      if (ws.readyState === WebSocket.OPEN) {
        const encoded = encodeGuacInstruction(instruction);
        ws.send(encoded);
      }
    }
  });

  guacdSocket.on('error', (err) => {
    console.error('[RDP-GUAC] Guacd socket error:', err);

    if (ws.readyState === WebSocket.OPEN) {
      let errorMsg = 'Connection to RDP service failed';
      if ((err as any).code === 'ECONNREFUSED') {
        errorMsg = 'RDP service (guacd) is not running. Start with: docker-compose up guacd';
      }
      ws.send(encodeGuacInstruction(['error', errorMsg, '519']));
    }
  });

  guacdSocket.on('close', () => {
    console.log('[RDP-GUAC] Guacd connection closed');

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeGuacInstruction(['disconnect']));
    }

    setRDPConnected(sessionId, false);
  });

  // Handle messages from WebSocket client (forward to guacd)
  ws.on('message', (data: Buffer) => {
    const message = data.toString('utf-8');

    // Log message (truncate for readability)
    const logMsg = message.substring(0, 60);
    console.log(`[RDP-GUAC] From client: ${logMsg}${message.length > 60 ? '...' : ''}`);

    // Forward to guacd
    if (session.guacdSocket && !session.guacdSocket.destroyed) {
      session.guacdSocket.write(message);
    } else {
      console.log('[RDP-GUAC] Cannot forward - guacd socket not available');
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    console.log('[RDP-GUAC] WebSocket closed for session:', sessionId);

    if (session.guacdSocket) {
      session.guacdSocket.destroy();
    }

    activeSessions.delete(sessionId);
    closeRDPSession(sessionId);
  });

  // Handle WebSocket errors
  ws.on('error', (err) => {
    console.error('[RDP-GUAC] WebSocket error:', err);

    if (session.guacdSocket) {
      session.guacdSocket.destroy();
    }

    activeSessions.delete(sessionId);
    closeRDPSession(sessionId);
  });

  // Ping/pong for keepalive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on('pong', () => {
    // Connection is alive
  });
}

export default handleRDPGuacWebSocket;
