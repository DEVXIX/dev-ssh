import crypto from 'crypto';
import { EventEmitter } from 'events';

export interface RDPConfig {
  connectionId: number;
  userId: number;
  host: string;
  port: number;
  username: string;
  password?: string;
  domain?: string;
  security?: 'any' | 'nla' | 'tls' | 'rdp';
  width?: number;
  height?: number;
  colorDepth?: 15 | 16 | 24 | 32;
  enableAudio?: boolean;
  enableClipboard?: boolean;
  enableDrives?: boolean;
}

export interface RDPSession {
  sessionId: string;
  connectionId: number;
  userId: number;
  config: RDPConfig;
  isConnected: boolean;
  lastActive: number;
  emitter: EventEmitter;
  rdpClient?: any;
}

const sessions = new Map<string, RDPSession>();

export function generateRDPSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function createRDPSession(
  sessionId: string,
  config: RDPConfig
): RDPSession {
  const session: RDPSession = {
    sessionId,
    connectionId: config.connectionId,
    userId: config.userId,
    config: {
      ...config,
      width: config.width || 1920,
      height: config.height || 1080,
      colorDepth: config.colorDepth || 24,
      security: config.security || 'any',
      enableAudio: config.enableAudio ?? false,
      enableClipboard: config.enableClipboard ?? true,
      enableDrives: config.enableDrives ?? false,
    },
    isConnected: false,
    lastActive: Date.now(),
    emitter: new EventEmitter(),
  };

  sessions.set(sessionId, session);
  console.log(`[RDP] Session created: ${sessionId}`);

  return session;
}

export function getRDPSession(sessionId: string): RDPSession | undefined {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActive = Date.now();
  }
  return session;
}

export function setRDPConnected(sessionId: string, connected: boolean): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.isConnected = connected;
    session.lastActive = Date.now();
  }
}

export function closeRDPSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    if (session.rdpClient) {
      try {
        session.rdpClient.close();
      } catch (err) {
        console.error(`[RDP] Error closing RDP client for session ${sessionId}:`, err);
      }
    }
    session.emitter.removeAllListeners();
    sessions.delete(sessionId);
    console.log(`[RDP] Session closed: ${sessionId}`);
  }
}

export function validateRDPSession(sessionId: string, userId: number): boolean {
  const session = getRDPSession(sessionId);
  return session !== undefined && session.userId === userId;
}

// Cleanup inactive sessions
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes

  sessions.forEach((session, sessionId) => {
    if (now - session.lastActive > timeout) {
      console.log(`[RDP] Closing inactive session ${sessionId}`);
      closeRDPSession(sessionId);
    }
  });
}, 5 * 60 * 1000); // Check every 5 minutes

export { sessions as rdpSessions };
