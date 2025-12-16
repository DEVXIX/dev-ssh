import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { workspacesAPI, connectionsAPI, filesAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { Workspace, WorkspacePane, Connection } from '../../types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { ArrowLeft, X, Lock, Activity, FolderOpen, PanelRightClose, PanelRightOpen, Save } from 'lucide-react';
import { ServerStats } from '../../types';
import { FileManager, FileEditorProvider, useFileEditor } from '../components/file-manager/FileManager';
import { toast } from 'sonner';
import DatabaseManager from './DatabaseManager';

// Component to display FileManager with integrated editor
function FileManagerWithEditor({ sessionId, connectionType }: { sessionId: string; connectionType: 'ssh' | 'ftp' }) {
  const fileEditor = useFileEditor();

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      {/* File Manager */}
      <div className={fileEditor.editingFile ? 'h-1/2 overflow-hidden' : 'flex-1 overflow-hidden'}>
        <FileManager sessionId={sessionId} connectionType={connectionType} />
      </div>

      {/* Editor Panel */}
      {fileEditor.editingFile && (
        <div className="h-1/2 border-t border-border bg-card flex flex-col overflow-hidden">
          <div className="border-b border-border bg-muted/30 p-2 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{fileEditor.editingFile.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={fileEditor.saveFile}
                disabled={fileEditor.isSaving}
                size="sm"
                variant="default"
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                {fileEditor.isSaving ? 'Saving...' : 'Save'}
              </Button>
              <Button
                onClick={fileEditor.closeEditor}
                size="sm"
                variant="ghost"
              >
                Close
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-muted/5">
            <textarea
              value={fileEditor.editContent}
              onChange={(e) => fileEditor.updateContent(e.target.value)}
              className="w-full h-full p-3 bg-transparent text-foreground font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/20"
              spellCheck={false}
              placeholder="File content..."
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface TerminalSession {
  paneId: string;
  sessionId: string | null;
  terminal: XTerm | null;
  fitAddon: FitAddon | null;
  socket: WebSocket | null;
  connection: Connection | null;
}

// Stats section component for individual pane
function StatsSection({ paneName, connectionName, sessionId, token }: {
  paneName: string;
  connectionName: string;
  sessionId: string;
  token: string | null;
}) {
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token || !sessionId) return;

    const connectWs = () => {
      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.hostname}:5000/ws/stats?token=${token}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          ws.send(JSON.stringify({
            type: 'start',
            data: { sessionId, interval: 5000 },
          }));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'stats') {
              setStats(message.data);
            }
          } catch (err) {
            console.error('Failed to parse stats:', err);
          }
        };

        ws.onerror = () => setConnected(false);
        ws.onclose = () => {
          setConnected(false);
          setTimeout(connectWs, 3000);
        };
      } catch (err) {
        console.error('Failed to create WebSocket:', err);
      }
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        wsRef.current.close();
      }
    };
  }, [sessionId, token]);

  return (
    <div className="border border-border rounded-lg p-3 bg-card/50">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{paneName}</h3>
          <p className="text-xs text-muted-foreground">{connectionName}</p>
        </div>
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-warning'}`} />
      </div>

      {stats ? (
        <div className="space-y-3">
          {/* CPU */}
          <Card className="p-3 bg-card/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">CPU</span>
              <span className="text-sm font-bold">{stats.cpu.usage.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(stats.cpu.usage, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.cpu.cores} cores • Load: {stats.cpu.loadAvg[0]?.toFixed(2)}
            </p>
          </Card>

          {/* Memory */}
          <Card className="p-3 bg-card/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Memory</span>
              <span className="text-sm font-bold">{stats.memory.usagePercent.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(stats.memory.usagePercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.memory.used >= 1073741824
                ? `${(stats.memory.used / 1024 / 1024 / 1024).toFixed(1)} GB` 
                : `${(stats.memory.used / 1024 / 1024).toFixed(0)} MB`} / {stats.memory.total >= 1073741824
                ? `${(stats.memory.total / 1024 / 1024 / 1024).toFixed(1)} GB` 
                : `${(stats.memory.total / 1024 / 1024).toFixed(0)} MB`}
            </p>
          </Card>

          {/* Disk */}
          <Card className="p-3 bg-card/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Disk</span>
              <span className="text-sm font-bold">{stats.disk.usagePercent.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-orange-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(stats.disk.usagePercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.disk.used >= 1073741824
                ? `${(stats.disk.used / 1024 / 1024 / 1024).toFixed(1)} GB` 
                : `${(stats.disk.used / 1024 / 1024).toFixed(0)} MB`} / {stats.disk.total >= 1073741824
                ? `${(stats.disk.total / 1024 / 1024 / 1024).toFixed(1)} GB` 
                : `${(stats.disk.total / 1024 / 1024).toFixed(0)} MB`}
            </p>
            <p className="text-xs text-success mt-1">
              Free: {stats.disk.free >= 1073741824
                ? `${(stats.disk.free / 1024 / 1024 / 1024).toFixed(1)} GB` 
                : `${(stats.disk.free / 1024 / 1024).toFixed(0)} MB`}
            </p>
          </Card>

          {/* System Info */}
          <Card className="p-3 bg-card/50">
            <h3 className="text-xs font-semibold text-foreground mb-2">System</h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Host</span>
                <span className="font-mono">{stats.system.hostname}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">OS</span>
                <span className="font-mono text-right">{stats.system.os}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Kernel</span>
                <span className="font-mono text-right">{stats.system.kernel}</span>
              </div>
            </div>
          </Card>

          {/* Uptime */}
          <Card className="p-3 bg-card/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Uptime</span>
              <span className="text-sm font-semibold">
                {Math.floor(stats.uptime / 86400)}d {Math.floor((stats.uptime % 86400) / 3600)}h {Math.floor((stats.uptime % 3600) / 60)}m
              </span>
            </div>
          </Card>

          {/* Network Interfaces */}
          {stats.network && stats.network.length > 0 && (
            <Card className="p-3 bg-card/50">
              <h3 className="text-xs font-semibold text-foreground mb-2">Network</h3>
              <div className="space-y-2">
                {stats.network.slice(0, 3).map((iface: any, index: number) => (
                  <div key={index} className="text-xs">
                    <div className="font-mono font-medium">{iface.name}</div>
                    <div className="text-muted-foreground ml-2">
                      {iface.ip}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground text-center py-4">
          {connected ? 'Loading...' : 'Connecting...'}
        </div>
      )}
    </div>
  );
}

export default function WorkspaceLauncher() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [sessions, setSessions] = useState<Map<string, TerminalSession>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [pendingConnections, setPendingConnections] = useState<Connection[]>([]);
  const [currentPasswordIndex, setCurrentPasswordIndex] = useState(0);
  const [passwords, setPasswords] = useState<Map<number, string>>(new Map());
  const [passwordsReady, setPasswordsReady] = useState(false);
  const [shouldConnect, setShouldConnect] = useState(false);
  const connectionAttemptedRef = useRef(false);
  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const passwordInputRef = useRef<string>('');

  // Stats panel state
  const [showStatsPanel, setShowStatsPanel] = useState(false);

  // File Manager panel state
  const [showFileManager, setShowFileManager] = useState(false);
  const [activeFileSessionId, setActiveFileSessionId] = useState<string | null>(null);

  // Load workspace and connections
  useEffect(() => {
    const loadData = async () => {
      try {
        const [wsRes, connRes] = await Promise.all([
          workspacesAPI.getOne(Number(workspaceId)),
          connectionsAPI.getAll(),
        ]);

        if (wsRes.data.success && wsRes.data.data) {
          setWorkspace(wsRes.data.data);
        } else {
          setError(wsRes.data.error || 'Failed to load workspace');
        }

        if (connRes.data.success && connRes.data.data) {
          setConnections(connRes.data.data);
        }
      } catch (err: any) {
        console.error('Failed to load workspace:', err);
        setError(err.message || 'Failed to load workspace');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [workspaceId]);

  // Initialize terminals for all panes
  useEffect(() => {
    if (!workspace || connections.length === 0) return;

    const newSessions = new Map<string, TerminalSession>();

    workspace.panes.forEach((pane) => {
      const connection = connections.find(c => c.id === pane.connectionId);
      if (!connection) return;

      const terminalRef = terminalRefs.current[pane.id];
      if (!terminalRef) return;

      // Create terminal instance
      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef);
      fitAddon.fit();

      newSessions.set(pane.id, {
        paneId: pane.id,
        sessionId: null,
        terminal: term,
        fitAddon,
        socket: null,
        connection,
      });
    });

    setSessions(newSessions);

    // Cleanup
    return () => {
      newSessions.forEach((session) => {
        session.socket?.close();
        session.terminal?.dispose();
      });
    };
  }, [workspace, connections]);

  // Trigger connection check after sessions are initialized
  useEffect(() => {
    if (sessions.size > 0 && workspace && !connectionAttemptedRef.current) {
      setShouldConnect(true);
    }
  }, [sessions.size, workspace]);

  // Connect terminals after they're initialized
  useEffect(() => {
    if (!shouldConnect || sessions.size === 0 || !workspace || !token) return;
    if (connectionAttemptedRef.current && !passwordsReady) return;

    const connectPanes = async () => {
      // First, check which connections need passwords
      const connectionsNeedingPasswords: Connection[] = [];
      const seenConnectionIds = new Set<number>();
      
      console.log('🔍 [WorkspaceLauncher] Checking connections for password requirements...');
      
      for (const [paneId, session] of sessions.entries()) {
        if (session.sessionId || !session.connection) continue;
        // Skip database connections - they don't need SSH password
        if (session.connection.type === 'database') continue;
        
        // Check hasPassword indicator (from list endpoint) or password field (from detail endpoint)
        const hasStoredPassword = session.connection.hasPassword || !!session.connection.password;
        
        console.log(`🔍 [WorkspaceLauncher] Connection "${session.connection.name}" (id=${session.connection.id}):`, {
          hasPassword: session.connection.hasPassword,
          passwordField: !!session.connection.password,
          hasStoredPassword,
          hasInPasswordsMap: passwords.has(session.connection.id),
          authType: session.connection.authType
        });
        
        if (!hasStoredPassword && !passwords.has(session.connection.id)) {
          if (!seenConnectionIds.has(session.connection.id)) {
            console.log(`⚠️ [WorkspaceLauncher] Connection "${session.connection.name}" needs password prompt`);
            connectionsNeedingPasswords.push(session.connection);
            seenConnectionIds.add(session.connection.id);
          }
          continue;
        }
      }
      
      // If there are connections needing passwords, show prompt
      if (connectionsNeedingPasswords.length > 0 && !passwordsReady) {
        console.log('🔒 [WorkspaceLauncher] Showing password prompt for:', connectionsNeedingPasswords.map(c => c.name));
        connectionAttemptedRef.current = true;
        setPendingConnections(connectionsNeedingPasswords);
        setCurrentPasswordIndex(0);
        setShowPasswordPrompt(true);
        return;
      }
      
      console.log('🔌 Starting connection process for all panes');
      if (connectionsNeedingPasswords.length > 0) {
        console.log('🔒 Awaiting passwords for connections:', connectionsNeedingPasswords.map((c) => `${c.name} (${c.host})`));
      }

      // Mark that we're attempting connection
      connectionAttemptedRef.current = true;
      setShouldConnect(false);

      const updates = new Map(sessions);

      for (const [paneId, session] of sessions.entries()) {
        const pane = workspace.panes.find(p => p.id === paneId);
        if (!pane) {
          console.warn(`🟠 Skipping pane ${paneId}: pane not found in workspace definition`);
          continue;
        }

        if (session.sessionId) {
          console.log(`ℹ️ Skipping pane "${pane.name}" (${paneId}): already connected`);
          continue;
        }

        if (!session.connection) {
          console.warn(`🟠 Skipping pane "${pane.name}" (${paneId}): no connection assigned`);
          toast.error(`${pane.name}: No connection selected for this pane`);
          continue;
        }

        if (!session.terminal) {
          console.warn(`🟠 Skipping pane "${pane.name}" (${paneId}): terminal ref missing`);
          continue;
        }

        if (session.connection.type === 'database') {
          console.log(`ℹ️ Pane "${pane.name}" (${paneId}) is a database connection; skipping terminal connect.`);
          continue;
        }

        if (session.connection.type !== 'ssh' && session.connection.type !== 'ftp') {
          console.warn(`🟠 Skipping pane "${pane.name}" (${paneId}): unsupported connection type ${session.connection.type}`);
          toast.error(`${pane.name}: Only SSH/FTP supported in workspace terminal`);
          continue;
        }

        try {
          // Connect to server using filesAPI with password
          const password = passwords.get(session.connection.id) || session.connection.password;
          console.log(`🔑 Connecting pane "${pane.name}" (conn ${session.connection.id}) hasPassword=${!!password}`);
          const response = await filesAPI.connect(session.connection.id, password);
          
          if (!response.data.success || !response.data.data.sessionId) {
            console.error('Connect response payload:', response.data);
            throw new Error(response.data.error || 'Failed to create session');
          }

          const sessionId = response.data.data.sessionId;
          console.log(`✅ SSH session created for pane "${pane.name}", sessionId:`, sessionId);

          // Create WebSocket connection with token from auth store
          const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsUrl = `${wsProtocol}//${window.location.hostname}:5000/ws/terminal?token=${token}`;
          console.log(`🌐 Creating WebSocket for pane "${pane.name}"`);
          const ws = new WebSocket(wsUrl);

          ws.onopen = () => {
            console.log(`✅ WebSocket opened for pane "${pane.name}"`);

            // Send connect message with session ID
            const connectMessage = {
              type: 'connect',
              data: {
                connectionId: session.connection?.id || pane.connectionId,
                sessionId: sessionId,
                cols: session.fitAddon?.proposeDimensions()?.cols || 80,
                rows: session.fitAddon?.proposeDimensions()?.rows || 24,
              }
            };
            console.log(`📤 Sending connect message for pane "${pane.name}":`, connectMessage);
            ws.send(JSON.stringify(connectMessage));

            // Send resize after connection
            const dims = session.fitAddon?.proposeDimensions();
            if (dims) {
              ws.send(JSON.stringify({
                type: 'resize',
                cols: dims.cols,
                rows: dims.rows,
              }));
            }

            // Execute default path command if specified
            if (pane.defaultPath) {
              ws.send(JSON.stringify({
                type: 'input',
                data: `cd ${pane.defaultPath}\n`,
              }));
            }

            // Execute auto-commands if specified
            if (pane.commands && pane.commands.length > 0) {
              pane.commands.forEach(cmd => {
                ws.send(JSON.stringify({
                  type: 'input',
                  data: `${cmd}\n`,
                }));
              });
            }
          };

          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
              case 'connected':
                console.log(`Pane ${pane.name} connected`);
                if (session.terminal) {
                  session.terminal.writeln('\x1b[32mConnected to server\x1b[0m\r\n');
                }
                break;
              case 'output':
                if (session.terminal) {
                  session.terminal.write(message.data);
                }
                break;
              case 'error':
                console.error('Terminal error:', message.data);
                if (session.terminal) {
                  session.terminal.writeln(`\r\n\x1b[31mError: ${message.data}\x1b[0m\r\n`);
                }
                break;
              case 'disconnected':
                if (session.terminal) {
                  session.terminal.writeln('\r\n\x1b[33mConnection closed\x1b[0m\r\n');
                }
                break;
            }
          };

          ws.onerror = (error) => {
            console.error('WebSocket error:', error);
          };

          ws.onclose = () => {
            console.log('WebSocket closed');
          };

          // Handle terminal input
          session.terminal.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'input', data }));
            }
          });

          updates.set(paneId, { ...session, sessionId, socket: ws });
        } catch (error: any) {
          console.error(`Failed to connect pane ${pane.name}:`, error);
          const errMsg = error?.response?.data?.error || error?.message || 'Failed to connect';
          toast.error(`${pane.name}: ${errMsg}`);

          // Log diagnostic details if available
          if (error?.response?.data) {
            console.error('Connect error response:', error.response.data);
          }

          // If missing password or auth failed, prompt for credentials
          if (!session.connection.password && !passwords.has(session.connection.id)) {
            setPendingConnections([session.connection]);
            setCurrentPasswordIndex(0);
            setShowPasswordPrompt(true);
            setPasswordsReady(false);
            break;
          }
        }
      }

      setSessions(updates);
    };

    connectPanes();
  }, [shouldConnect, sessions, workspace, token, passwordsReady, passwords]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      sessions.forEach((session) => {
        if (session.fitAddon && session.socket?.readyState === WebSocket.OPEN) {
          session.fitAddon.fit();
          const dims = session.fitAddon.proposeDimensions();
          if (dims) {
            session.socket.send(JSON.stringify({
              type: 'resize',
              cols: dims.cols,
              rows: dims.rows,
            }));
          }
        }
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sessions]);

  const closePane = async (paneId: string) => {
    const session = sessions.get(paneId);
    if (!session) return;

    // Close WebSocket
    if (session.socket) {
      session.socket.close();
    }

    // Dispose terminal
    if (session.terminal) {
      session.terminal.dispose();
    }

    // Disconnect session
    if (session.sessionId) {
      try {
        await fetch(`/api/ssh/disconnect/${session.sessionId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
      } catch (error) {
        console.error('Failed to disconnect:', error);
      }
    }

    // Remove from sessions
    const newSessions = new Map(sessions);
    newSessions.delete(paneId);
    setSessions(newSessions);
  };

  const getGridClass = () => {
    if (!workspace) return '';

    const paneCount = workspace.panes.length;

    switch (workspace.layout) {
      case 'single':
        return 'grid-cols-1 grid-rows-1';
      case 'horizontal-2':
        return 'grid-cols-2 grid-rows-1';
      case 'vertical-2':
        return 'grid-cols-1 grid-rows-2';
      case 'main-vertical':
        return 'grid-cols-2 grid-rows-2';
      case 'main-horizontal':
        return 'grid-cols-2 grid-rows-2';
      case 'grid-4':
        return 'grid-cols-2 grid-rows-2';
      default:
        return 'grid-cols-1 grid-rows-1';
    }
  };

  const getPaneStyle = (pane: WorkspacePane, index: number) => {
    if (!workspace) return {};

    switch (workspace.layout) {
      case 'main-vertical':
        if (index === 0) return { gridColumn: '1', gridRow: '1 / 3' };
        return {};
      case 'main-horizontal':
        if (index === 0) return { gridColumn: '1 / 3', gridRow: '1' };
        return {};
      default:
        return {};
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-lg">Loading workspace...</div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-lg font-semibold">Workspace not found</div>
        {error && (
          <div className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg">
            {error}
          </div>
        )}
        <div className="text-sm text-muted-foreground">
          Workspace ID: {workspaceId}
        </div>
        <Button onClick={() => navigate('/workspaces')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Workspaces
        </Button>
      </div>
    );
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInputRef.current || pendingConnections.length === 0) {
      setPasswordError('Password is required');
      return;
    }
    
    const currentConnection = pendingConnections[currentPasswordIndex];
    
    // Store password for this connection
    const newPasswords = new Map(passwords);
    newPasswords.set(currentConnection.id, passwordInputRef.current);
    setPasswords(newPasswords);
    
    // Move to next connection or close prompt
    if (currentPasswordIndex < pendingConnections.length - 1) {
      setCurrentPasswordIndex(currentPasswordIndex + 1);
      passwordInputRef.current = '';
      setPasswordError('');
    } else {
      setShowPasswordPrompt(false);
      setPendingConnections([]);
      setCurrentPasswordIndex(0);
      setPasswordError('');
      passwordInputRef.current = '';
      
      // Reset connection flag and trigger reconnection
      setPasswordsReady(true);
      setShouldConnect(true);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Password Prompt Modal */}
      {showPasswordPrompt && pendingConnections.length > 0 && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="rounded-full bg-primary/20 p-3">
                <Lock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Authentication Required</h2>
                <p className="text-sm text-muted-foreground">
                  Enter password for {pendingConnections[currentPasswordIndex].username}@{pendingConnections[currentPasswordIndex].host}
                  {pendingConnections.length > 1 && ` (${currentPasswordIndex + 1} of ${pendingConnections.length})`}
                </p>
              </div>
            </div>

            {passwordError && (
              <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
                {passwordError}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  onChange={(e) => passwordInputRef.current = e.target.value}
                  placeholder="Enter password..."
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  Connect
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/workspaces')}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Header */}
      <div className="border-b p-4 flex items-center justify-between bg-background">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/workspaces')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowStatsPanel(!showStatsPanel)}
              variant="outline"
              size="sm"
            >
              {showStatsPanel ? <PanelRightClose className="h-3.5 w-3.5 mr-2" /> : <PanelRightOpen className="h-3.5 w-3.5 mr-2" />}
              {showStatsPanel ? 'Hide' : 'Show'} Stats
            </Button>
            <Button
              onClick={() => setShowFileManager(!showFileManager)}
              variant="outline"
              size="sm"
            >
              <FolderOpen className="h-3.5 w-3.5 mr-2" />
              {showFileManager ? 'Hide' : 'Show'} Files
            </Button>
          </div>
          <div>
            <h1 className="text-xl font-semibold">{workspace.name}</h1>
            {workspace.description && (
              <p className="text-sm text-muted-foreground">{workspace.description}</p>
            )}
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          Layout: {workspace.layout} • {workspace.panes.length} panes
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Terminal Grid */}
        <div className={`flex-1 grid gap-2 p-2 ${getGridClass()}`}>
        {workspace.panes.map((pane, index) => {
          const session = sessions.get(pane.id);
          const connection = connections.find(c => c.id === pane.connectionId);
          const isDatabase = connection?.type === 'database';

          return (
            <div
              key={pane.id}
              className={`border rounded-lg overflow-hidden flex flex-col ${isDatabase ? 'bg-dark min-h-0' : 'bg-background'}`}
              style={getPaneStyle(pane, index)}
            >
              {/* Pane Header */}
              <div className={`border-b px-3 flex items-center justify-between flex-shrink-0 ${isDatabase ? 'py-1.5 bg-dark-lighter border-dark-border' : 'py-2 bg-muted/50'}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`font-medium truncate ${isDatabase ? 'text-xs text-gray-200' : 'text-sm'}`}>{pane.name}</div>
                  {connection && !isDatabase && (
                    <div className="text-xs text-muted-foreground truncate">
                      {connection.username}@{connection.host}
                    </div>
                  )}
                  {session?.sessionId && !isDatabase && (
                    <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Connected" />
                  )}
                  {isDatabase && (
                    <div className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 flex-shrink-0">DB</div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => closePane(pane.id)}
                  className={`p-0 flex-shrink-0 ${isDatabase ? 'h-5 w-5 text-gray-400 hover:text-white' : 'h-6 w-6'}`}
                >
                  <X className={isDatabase ? 'h-3 w-3' : 'h-4 w-4'} />
                </Button>
              </div>

              {/* Terminal or DB Content */}
              {isDatabase ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <DatabaseManager
                    connectionIdOverride={connection?.id}
                    embedded
                    onClose={() => closePane(pane.id)}
                  />
                </div>
              ) : (
                <div className="flex-1 p-2">
                  <div
                    ref={(el) => (terminalRefs.current[pane.id] = el)}
                    className="w-full h-full"
                  />
                </div>
              )}
            </div>
          );
        })}
        </div>

        {/* File Manager Panel */}
        {showFileManager && (
          <div className="w-96 border-l border-border overflow-hidden bg-card/30 backdrop-blur-sm flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm">File Manager</h3>
              </div>
            </div>

            {/* Session Selector */}
            <div className="p-3 border-b border-border">
              <Label className="text-xs text-muted-foreground mb-2 block">Browse Session</Label>
              <select
                className="w-full bg-card border-2 border-border rounded-md px-3 py-2 text-sm text-foreground font-medium hover:border-primary/50 transition-colors cursor-pointer"
                style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
                value={activeFileSessionId || ''}
                onChange={(e) => setActiveFileSessionId(e.target.value || null)}
              >
                <option value="" style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--muted-foreground))' }}>-- Select a session --</option>
                {workspace.panes.map((pane) => {
                  const session = sessions.get(pane.id);
                  if (!session?.sessionId) return null;
                  return (
                    <option key={pane.id} value={session.sessionId} style={{ backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}>
                      {pane.name} - {session.connection?.name}
                    </option>
                  );
                })}
              </select>
            </div>

            {activeFileSessionId ? (
              <FileEditorProvider
                sessionId={activeFileSessionId}
                connectionType="ssh"
              >
                <FileManagerWithEditor sessionId={activeFileSessionId} connectionType="ssh" />
              </FileEditorProvider>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-4 text-center">
                Select a connected session to browse files
              </div>
            )}
          </div>
        )}

        {/* Stats Panel */}
        {showStatsPanel && (
          <div className="w-96 border-l border-border overflow-y-auto bg-card/30 backdrop-blur-sm">
            <div className="p-4 space-y-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold">Live Server Stats</h2>
                </div>
              </div>

              {/* Show all connected sessions */}
              {workspace.panes.map((pane) => {
                const session = sessions.get(pane.id);
                if (!session?.sessionId) return null;
                
                return (
                  <StatsSection 
                    key={pane.id}
                    paneName={pane.name}
                    connectionName={session.connection?.name || ''}
                    sessionId={session.sessionId}
                    token={token}
                  />
                );
              })}

              {workspace.panes.every(pane => !sessions.get(pane.id)?.sessionId) && (
                <div className="text-center text-sm text-muted-foreground py-8 px-4">
                  Waiting for terminal connections...
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
