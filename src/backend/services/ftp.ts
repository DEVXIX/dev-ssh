import { Client as FTPClient, FileInfo } from 'basic-ftp';
import crypto from 'crypto';

interface FTPSession {
  client: FTPClient;
  connectionId: number;
  userId: number;
  isConnected: boolean;
  lastActive: number;
}

const ftpSessions = new Map<string, FTPSession>();

export function generateFTPSessionId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function createFTPConnection(
  sessionId: string,
  config: {
    connectionId: number;
    userId: number;
    host: string;
    port: number;
    user: string;
    password?: string;
    secure?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = new FTPClient();
    client.ftp.verbose = process.env.NODE_ENV === 'development';

    await client.access({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password || '',
      secure: config.secure || false,
      secureOptions: {
        rejectUnauthorized: false,
      },
    });

    ftpSessions.set(sessionId, {
      client,
      connectionId: config.connectionId,
      userId: config.userId,
      isConnected: true,
      lastActive: Date.now(),
    });

    console.log(`FTP connection established for session ${sessionId}`);
    return { success: true };
  } catch (error: any) {
    console.error(`FTP connection error for session ${sessionId}:`, error);
    return { success: false, error: error.message };
  }
}

export function getFTPSession(sessionId: string): FTPSession | undefined {
  const session = ftpSessions.get(sessionId);
  if (session) {
    session.lastActive = Date.now();
  }
  return session;
}

export function closeFTPConnection(sessionId: string): void {
  const session = ftpSessions.get(sessionId);
  if (session) {
    session.client.close();
    ftpSessions.delete(sessionId);
    console.log(`FTP session ${sessionId} closed`);
  }
}

export async function listFTPFiles(sessionId: string, path: string): Promise<any[]> {
  const session = getFTPSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('FTP session not found or not connected');
  }

  try {
    const list = await session.client.list(path);

    // Normalize path to ensure proper joining
    const basePath = path.endsWith('/') ? path.slice(0, -1) : path;

    return list.map((item: FileInfo) => {
      const fullPath = basePath === '/' ? `/${item.name}` : `${basePath}/${item.name}`;

      return {
        name: item.name,
        path: fullPath,
        type: item.isDirectory ? 'directory' :
              item.isSymbolicLink ? 'symlink' : 'file',
        size: item.size,
        permissions: item.rawModifiedAt || '',
        modifiedAt: item.modifiedAt?.toISOString() || '',
        owner: '',
        group: '',
      };
    });
  } catch (error: any) {
    throw new Error(`Failed to list FTP directory: ${error.message}`);
  }
}

export async function downloadFTPFile(sessionId: string, remotePath: string): Promise<Buffer> {
  const session = getFTPSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('FTP session not found or not connected');
  }

  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    session.client.downloadTo(
      {
        write: (chunk: any) => {
          chunks.push(chunk);
        },
        end: () => {
          resolve(Buffer.concat(chunks));
        },
      } as any,
      remotePath
    ).catch(reject);
  });
}

export async function uploadFTPFile(
  sessionId: string,
  remotePath: string,
  content: string | Buffer
): Promise<{ success: boolean }> {
  const session = getFTPSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('FTP session not found or not connected');
  }

  try {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    await session.client.uploadFrom(buffer as any, remotePath);
    return { success: true };
  } catch (error: any) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

export async function deleteFTPFile(sessionId: string, path: string, isDirectory: boolean): Promise<{ success: boolean }> {
  const session = getFTPSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('FTP session not found or not connected');
  }

  try {
    if (isDirectory) {
      await session.client.removeDir(path);
    } else {
      await session.client.remove(path);
    }
    return { success: true };
  } catch (error: any) {
    throw new Error(`Failed to delete: ${error.message}`);
  }
}

export async function renameFTPFile(
  sessionId: string,
  oldPath: string,
  newPath: string
): Promise<{ success: boolean }> {
  const session = getFTPSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('FTP session not found or not connected');
  }

  try {
    await session.client.rename(oldPath, newPath);
    return { success: true };
  } catch (error: any) {
    throw new Error(`Failed to rename: ${error.message}`);
  }
}

export async function createFTPDirectory(sessionId: string, path: string): Promise<{ success: boolean }> {
  const session = getFTPSession(sessionId);
  if (!session || !session.isConnected) {
    throw new Error('FTP session not found or not connected');
  }

  try {
    await session.client.ensureDir(path);
    return { success: true };
  } catch (error: any) {
    throw new Error(`Failed to create directory: ${error.message}`);
  }
}

// Cleanup inactive FTP sessions
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes

  ftpSessions.forEach((session, sessionId) => {
    if (now - session.lastActive > timeout) {
      console.log(`Closing inactive FTP session ${sessionId}`);
      closeFTPConnection(sessionId);
    }
  });
}, 5 * 60 * 1000); // Check every 5 minutes

export { ftpSessions };
