// Types for the application

export interface User {
  id: number;
  username: string;
  password: string;
  isAdmin: boolean;
  createdAt: string;
}

export type ConnectionType = 'ssh' | 'ftp' | 'database';
export type DatabaseType = 'mysql' | 'postgresql' | 'sqlite' | 'mariadb' | 'mssql' | 'oracle';

export interface Connection {
  id: number;
  userId: number;
  name: string;
  type: ConnectionType;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'none';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  // Credential existence indicators (from list endpoint, without exposing actual values)
  hasPassword?: boolean;
  hasPrivateKey?: boolean;
  hasPassphrase?: boolean;
  enableTerminal?: boolean;
  enableFileManager?: boolean;
  enableTunneling?: boolean;
  defaultPath?: string;
  tags?: string[];
  folder?: string;
  // Database-specific fields
  databaseType?: DatabaseType;
  database?: string;
  ssl?: boolean;
  sslOptions?: {
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Tunnel {
  id: number;
  connectionId: number;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  type: 'local' | 'remote' | 'dynamic';
  autoStart: boolean;
  status: 'connected' | 'disconnected' | 'error';
  createdAt: string;
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  permissions: string;
  owner: string;
  group: string;
  modifiedAt: string;
  isSymlink?: boolean;
  linkTarget?: string;
}

export interface SessionInfo {
  sessionId: string;
  connectionId: number;
  type: 'ssh' | 'ftp';
  connected: boolean;
  lastActive: number;
}

export interface TerminalConfig {
  cols: number;
  rows: number;
  cursorBlink?: boolean;
  fontSize?: number;
  fontFamily?: string;
  theme?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ConnectionConfig {
  id?: number;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  type: 'ssh' | 'ftp';
}

export interface TunnelConfig {
  connectionId: number;
  name: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  type: 'local' | 'remote' | 'dynamic';
}

export interface FTPConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  secure?: boolean; // FTPS
  secureOptions?: {
    rejectUnauthorized?: boolean;
  };
}

export interface ServerStats {
  cpu: {
    usage: number;
    cores: number;
    loadAvg: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    available: number;
    usagePercent: number;
  };
  uptime: number;
  system: {
    hostname: string;
    os: string;
    kernel: string;
  };
  network: Array<{
    name: string;
    ip: string;
    mac: string;
  }>;
  timestamp?: string;
}

// Workspace/Layout types (Tmuxinator-style)
export type WorkspaceLayoutType =
  | 'single'           // 1 pane
  | 'horizontal-2'     // 2 panes side by side
  | 'vertical-2'       // 2 panes top/bottom
  | 'main-vertical'    // 1 main + 2 side panes
  | 'main-horizontal'  // 1 main + 2 bottom panes
  | 'grid-4';          // 4 panes in 2x2 grid

export interface WorkspacePane {
  id: string;
  connectionId: number | null;  // Which server to connect to
  name: string;                  // Pane title
  commands?: string[];           // Auto-execute commands on connect
  defaultPath?: string;          // Starting directory
}

export interface Workspace {
  id: number;
  userId: number;
  name: string;
  description?: string;
  layout: WorkspaceLayoutType;
  panes: WorkspacePane[];
  createdAt: string;
  updatedAt: string;
}

// Database-specific types
export interface DatabaseInfo {
  name: string;
  size?: number;
  tables?: number;
}

export interface TableInfo {
  name: string;
  schema?: string;
  type: 'table' | 'view' | 'system';
  rows?: number;
  size?: number;
  engine?: string;
  collation?: string;
  comment?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key?: 'PRI' | 'UNI' | 'MUL' | '';
  default?: string | null;
  extra?: string;
  comment?: string;
}

export interface QueryResult {
  columns: string[];
  rows: any[];
  rowCount: number;
  affectedRows?: number;
  executionTime?: number;
  error?: string;
}

export interface DatabaseSession {
  sessionId: string;
  connectionId: number;
  databaseType: DatabaseType;
  currentDatabase?: string;
  connected: boolean;
  lastActive: number;
}
