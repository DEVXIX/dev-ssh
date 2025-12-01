import { Client, ConnectConfig, ClientChannel, SFTPWrapper } from 'ssh2';
import crypto from 'crypto';

interface SSHSession {
  client: Client;
  connectionId: number;
  userId: number;
  isConnected: boolean;
  lastActive: number;
  sftp?: SFTPWrapper;
  tunnels: Map<string, ClientChannel>;
  password?: string; // Store password for terminal connections
}

const sessions = new Map<string, SSHSession>();

export function generateSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function createSSHConnection(
  sessionId: string,
  config: {
    connectionId: number;
    userId: number;
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const client = new Client();
    
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 60000,
    };

    if (config.password) {
      connectConfig.password = config.password;
    }

    if (config.privateKey) {
      connectConfig.privateKey = config.privateKey;
      if (config.passphrase) {
        connectConfig.passphrase = config.passphrase;
      }
    }

    client.on('ready', () => {
      console.log(`SSH connection established for session ${sessionId}`);
      
      sessions.set(sessionId, {
        client,
        connectionId: config.connectionId,
        userId: config.userId,
        isConnected: true,
        lastActive: Date.now(),
        tunnels: new Map(),
        password: config.password, // Store password for terminal use
      });

      resolve({ success: true });
    });

    client.on('error', (err) => {
      console.error(`SSH connection error for session ${sessionId}:`, err);
      resolve({ success: false, error: err.message });
    });

    client.on('close', () => {
      console.log(`SSH connection closed for session ${sessionId}`);
      const session = sessions.get(sessionId);
      if (session) {
        session.isConnected = false;
      }
    });

    client.connect(connectConfig);
  });
}

export function getSSHSession(sessionId: string): SSHSession | undefined {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActive = Date.now();
  }
  return session;
}

export function closeSSHConnection(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    // Close all tunnels
    session.tunnels.forEach((channel) => {
      channel.close();
    });
    session.tunnels.clear();

    // Close SFTP
    if (session.sftp) {
      session.sftp.end();
    }

    // Close SSH connection
    session.client.end();
    sessions.delete(sessionId);
    console.log(`SSH session ${sessionId} closed`);
  }
}

export async function executeSFTPCommand(
  sessionId: string,
  operation: 'list' | 'readFile' | 'writeFile' | 'delete' | 'rename' | 'mkdir',
  params: any
): Promise<any> {
  const session = getSSHSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('SSH session not found or not connected');
  }

  return new Promise((resolve, reject) => {
    if (session.sftp) {
      performSFTPOperation(session.sftp, operation, params, resolve, reject);
    } else {
      session.client.sftp((err, sftp) => {
        if (err) {
          return reject(err);
        }
        session.sftp = sftp;
        performSFTPOperation(sftp, operation, params, resolve, reject);
      });
    }
  });
}

function performSFTPOperation(
  sftp: SFTPWrapper,
  operation: string,
  params: any,
  resolve: Function,
  reject: Function
) {
  switch (operation) {
    case 'list':
      sftp.readdir(params.path, (err, list) => {
        if (err) return reject(err);

        // Normalize path to ensure proper joining
        const basePath = params.path.endsWith('/') ? params.path.slice(0, -1) : params.path;

        const files = list.map((item: any) => {
          const fullPath = basePath === '/' ? `/${item.filename}` : `${basePath}/${item.filename}`;

          return {
            name: item.filename,
            path: fullPath,
            type: item.attrs.isDirectory() ? 'directory' :
                  item.attrs.isSymbolicLink() ? 'symlink' : 'file',
            size: item.attrs.size,
            permissions: item.attrs.mode?.toString(8) || '',
            modifiedAt: new Date(item.attrs.mtime * 1000).toISOString(),
            owner: item.attrs.uid || '',
            group: item.attrs.gid || '',
          };
        });

        resolve(files);
      });
      break;

    case 'readFile':
      sftp.readFile(params.path, 'utf8', (err, data) => {
        if (err) return reject(err);
        resolve(data);
      });
      break;

    case 'writeFile':
      sftp.writeFile(params.path, params.content, (err: any) => {
        if (err) return reject(err);
        resolve({ success: true });
      });
      break;

    case 'delete':
      const deleteFunc = params.isDirectory ? sftp.rmdir : sftp.unlink;
      deleteFunc.call(sftp, params.path, (err: any) => {
        if (err) return reject(err);
        resolve({ success: true });
      });
      break;

    case 'rename':
      sftp.rename(params.oldPath, params.newPath, (err) => {
        if (err) return reject(err);
        resolve({ success: true });
      });
      break;

    case 'mkdir':
      sftp.mkdir(params.path, (err) => {
        if (err) return reject(err);
        resolve({ success: true });
      });
      break;

    default:
      reject(new Error(`Unknown operation: ${operation}`));
  }
}

// Cleanup inactive sessions
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes

  sessions.forEach((session, sessionId) => {
    if (now - session.lastActive > timeout) {
      console.log(`Closing inactive session ${sessionId}`);
      closeSSHConnection(sessionId);
    }
  });
}, 5 * 60 * 1000); // Check every 5 minutes

export { sessions };
