import * as Minio from 'minio';
import { randomBytes } from 'crypto';
import type { StorageSession, StorageObject, StorageBucket } from '../../types/index.js';

interface StorageClientConfig {
  endpoint: string;
  port?: number;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
  region?: string;
}

class StorageService {
  private sessions: Map<string, {
    client: Minio.Client;
    config: StorageClientConfig;
    storageConnectionId: number;
    userId: number;
    currentBucket?: string;
    currentPath?: string;
    lastActive: number;
  }> = new Map();

  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup inactive sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveSessions();
    }, 5 * 60 * 1000);
  }

  private cleanupInactiveSessions() {
    const now = Date.now();
    const timeout = 2 * 60 * 60 * 1000; // 2 hours

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActive > timeout) {
        console.log(`[STORAGE] Cleaning up inactive session: ${sessionId}`);
        this.sessions.delete(sessionId);
      }
    }
  }

  async connect(
    storageConnectionId: number,
    userId: number,
    config: StorageClientConfig
  ): Promise<string> {
    try {
      const client = new Minio.Client({
        endPoint: config.endpoint,
        port: config.port,
        useSSL: config.useSSL,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        region: config.region,
      });

      // Test connection by listing buckets
      await client.listBuckets();

      const sessionId = randomBytes(16).toString('hex');
      this.sessions.set(sessionId, {
        client,
        config,
        storageConnectionId,
        userId,
        lastActive: Date.now(),
      });

      console.log(`[STORAGE] Session created: ${sessionId} for user ${userId}`);
      return sessionId;
    } catch (error: any) {
      console.error('[STORAGE] Connection failed:', error);
      throw new Error(`Failed to connect to storage: ${error.message}`);
    }
  }

  disconnect(sessionId: string, userId: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.userId !== userId) {
      throw new Error('Unauthorized');
    }

    this.sessions.delete(sessionId);
    console.log(`[STORAGE] Session disconnected: ${sessionId}`);
  }

  private getSession(sessionId: string, userId: number) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found or expired');
    }

    if (session.userId !== userId) {
      throw new Error('Unauthorized');
    }

    session.lastActive = Date.now();
    return session;
  }

  async listBuckets(sessionId: string, userId: number): Promise<StorageBucket[]> {
    const session = this.getSession(sessionId, userId);

    try {
      const buckets = await session.client.listBuckets();
      return buckets.map(bucket => ({
        name: bucket.name,
        creationDate: bucket.creationDate,
      }));
    } catch (error: any) {
      console.error('[STORAGE] List buckets failed:', error);
      throw new Error(`Failed to list buckets: ${error.message}`);
    }
  }

  async createBucket(sessionId: string, userId: number, bucketName: string, region?: string): Promise<void> {
    const session = this.getSession(sessionId, userId);

    try {
      await session.client.makeBucket(bucketName, region || session.config.region || '');
      console.log(`[STORAGE] Bucket created: ${bucketName}`);
    } catch (error: any) {
      console.error('[STORAGE] Create bucket failed:', error);
      throw new Error(`Failed to create bucket: ${error.message}`);
    }
  }

  async deleteBucket(sessionId: string, userId: number, bucketName: string): Promise<void> {
    const session = this.getSession(sessionId, userId);

    try {
      await session.client.removeBucket(bucketName);
      console.log(`[STORAGE] Bucket deleted: ${bucketName}`);
    } catch (error: any) {
      console.error('[STORAGE] Delete bucket failed:', error);
      throw new Error(`Failed to delete bucket: ${error.message}`);
    }
  }

  async listObjects(
    sessionId: string,
    userId: number,
    bucketName: string,
    prefix: string = '',
    recursive: boolean = false
  ): Promise<StorageObject[]> {
    const session = this.getSession(sessionId, userId);
    session.currentBucket = bucketName;
    session.currentPath = prefix;

    try {
      const objects: StorageObject[] = [];

      // Use listObjectsV2 with delimiter for folder-like behavior
      const objectsStream = session.client.listObjectsV2(
        bucketName,
        prefix,
        recursive,
        '' // startAfter
      );

      return new Promise((resolve, reject) => {
        objectsStream.on('data', (obj) => {
          console.log('[STORAGE] Object from stream:', JSON.stringify(obj));

          // Check if this is a common prefix (folder)
          if (obj.prefix) {
            const folderName = obj.prefix.replace(prefix, '').replace(/\/$/, '');
            if (folderName) {
              objects.push({
                name: folderName,
                path: obj.prefix,
                type: 'folder',
                size: 0,
                lastModified: new Date(),
                isPrefix: true,
              });
            }
          }
          // Check if this is a file
          else if (obj.name) {
            const fileName = obj.name.replace(prefix, '');
            // Skip if it's the same as prefix (directory marker)
            // Also skip empty folder placeholder objects (ending with / and size 0)
            if (fileName && fileName !== '/' && !(fileName.endsWith('/') && obj.size === 0)) {
              objects.push({
                name: fileName,
                path: obj.name,
                type: 'file',
                size: obj.size || 0,
                lastModified: obj.lastModified || new Date(),
                etag: obj.etag,
                isPrefix: false,
              });
            }
          }
        });

        objectsStream.on('end', () => {
          console.log(`[STORAGE] Listed ${objects.length} objects in ${bucketName}/${prefix}`);
          resolve(objects);
        });

        objectsStream.on('error', (error) => {
          console.error('[STORAGE] List objects failed:', error);
          reject(new Error(`Failed to list objects: ${error.message}`));
        });
      });
    } catch (error: any) {
      console.error('[STORAGE] List objects failed:', error);
      throw new Error(`Failed to list objects: ${error.message}`);
    }
  }

  async uploadObject(
    sessionId: string,
    userId: number,
    bucketName: string,
    objectName: string,
    data: Buffer,
    contentType?: string
  ): Promise<void> {
    const session = this.getSession(sessionId, userId);

    try {
      const metadata: Record<string, string> = {};
      if (contentType) {
        metadata['Content-Type'] = contentType;
      }

      await session.client.putObject(bucketName, objectName, data, data.length, metadata);
      console.log(`[STORAGE] Object uploaded: ${bucketName}/${objectName}`);
    } catch (error: any) {
      console.error('[STORAGE] Upload failed:', error);
      throw new Error(`Failed to upload object: ${error.message}`);
    }
  }

  async downloadObject(
    sessionId: string,
    userId: number,
    bucketName: string,
    objectName: string
  ): Promise<Buffer> {
    const session = this.getSession(sessionId, userId);

    try {
      const chunks: Buffer[] = [];
      const stream = await session.client.getObject(bucketName, objectName);

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
          chunks.push(chunk);
        });

        stream.on('end', () => {
          resolve(Buffer.concat(chunks));
        });

        stream.on('error', (error) => {
          console.error('[STORAGE] Download failed:', error);
          reject(new Error(`Failed to download object: ${error.message}`));
        });
      });
    } catch (error: any) {
      console.error('[STORAGE] Download failed:', error);
      throw new Error(`Failed to download object: ${error.message}`);
    }
  }

  async deleteObject(
    sessionId: string,
    userId: number,
    bucketName: string,
    objectName: string
  ): Promise<void> {
    const session = this.getSession(sessionId, userId);

    try {
      await session.client.removeObject(bucketName, objectName);
      console.log(`[STORAGE] Object deleted: ${bucketName}/${objectName}`);
    } catch (error: any) {
      console.error('[STORAGE] Delete failed:', error);
      throw new Error(`Failed to delete object: ${error.message}`);
    }
  }

  async deleteObjects(
    sessionId: string,
    userId: number,
    bucketName: string,
    objectNames: string[]
  ): Promise<void> {
    const session = this.getSession(sessionId, userId);

    try {
      await session.client.removeObjects(bucketName, objectNames);
      console.log(`[STORAGE] Objects deleted: ${objectNames.length} items from ${bucketName}`);
    } catch (error: any) {
      console.error('[STORAGE] Batch delete failed:', error);
      throw new Error(`Failed to delete objects: ${error.message}`);
    }
  }

  async copyObject(
    sessionId: string,
    userId: number,
    sourceBucket: string,
    sourceObject: string,
    destBucket: string,
    destObject: string
  ): Promise<void> {
    const session = this.getSession(sessionId, userId);

    try {
      const conditions = new Minio.CopyConditions();
      await session.client.copyObject(
        destBucket,
        destObject,
        `/${sourceBucket}/${sourceObject}`,
        conditions
      );
      console.log(`[STORAGE] Object copied: ${sourceBucket}/${sourceObject} -> ${destBucket}/${destObject}`);
    } catch (error: any) {
      console.error('[STORAGE] Copy failed:', error);
      throw new Error(`Failed to copy object: ${error.message}`);
    }
  }

  async getObjectInfo(
    sessionId: string,
    userId: number,
    bucketName: string,
    objectName: string
  ): Promise<any> {
    const session = this.getSession(sessionId, userId);

    try {
      const stat = await session.client.statObject(bucketName, objectName);
      return {
        size: stat.size,
        etag: stat.etag,
        lastModified: stat.lastModified,
        contentType: stat.metaData?.['content-type'],
        metadata: stat.metaData,
      };
    } catch (error: any) {
      console.error('[STORAGE] Get object info failed:', error);
      throw new Error(`Failed to get object info: ${error.message}`);
    }
  }

  async getPresignedUrl(
    sessionId: string,
    userId: number,
    bucketName: string,
    objectName: string,
    expirySeconds: number = 3600
  ): Promise<string> {
    const session = this.getSession(sessionId, userId);

    try {
      const url = await session.client.presignedGetObject(bucketName, objectName, expirySeconds);
      return url;
    } catch (error: any) {
      console.error('[STORAGE] Presigned URL generation failed:', error);
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  getSessionInfo(sessionId: string, userId: number): StorageSession {
    const session = this.getSession(sessionId, userId);

    return {
      sessionId,
      storageConnectionId: session.storageConnectionId,
      storageType: 'minio',
      currentBucket: session.currentBucket,
      currentPath: session.currentPath,
      connected: true,
      lastActive: session.lastActive,
    };
  }

  cleanup() {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
  }
}

export const storageService = new StorageService();
