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
import { ArrowLeft, X, Lock } from 'lucide-react';

interface TerminalSession {
  paneId: string;
  sessionId: string | null;
  terminal: XTerm | null;
  fitAddon: FitAddon | null;
  socket: WebSocket | null;
  connection: Connection | null;
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
  const connectionAttemptedRef = useRef(false);
  const terminalRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const passwordInputRef = useRef<string>('');

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

  // Connect terminals after they're initialized
  useEffect(() => {
    console.log('🔄 Connect effect triggered', { 
      hasSessions: sessions.size > 0, 
      hasWorkspace: !!workspace, 
      hasToken: !!token,
      passwordsReady,
      connectionAttempted: connectionAttemptedRef.current 
    });
    
    if (sessions.size === 0 || !workspace || !token) return;
    
    // Only attempt connection once, or when explicitly needed
    if (connectionAttemptedRef.current) return;

    const connectPanes = async () => {
      // First, check which connections need passwords
      const connectionsNeedingPasswords: Connection[] = [];
      const seenConnectionIds = new Set<number>();
      
      for (const [paneId, session] of sessions.entries()) {
        if (session.sessionId || !session.connection) continue;
        if (!session.connection.password && !passwords.has(session.connection.id)) {
          if (!seenConnectionIds.has(session.connection.id)) {
            connectionsNeedingPasswords.push(session.connection);
            seenConnectionIds.add(session.connection.id);
          }
        }
      }
      
      // If there are connections needing passwords, show prompt
      if (connectionsNeedingPasswords.length > 0) {
        setPendingConnections(connectionsNeedingPasswords);
        setCurrentPasswordIndex(0);
        setShowPasswordPrompt(true);
        return;
      }
      
      console.log('🔌 Starting connection process for all panes');

      // Mark that we're attempting connection
      connectionAttemptedRef.current = true;

      const updates = new Map(sessions);

      for (const [paneId, session] of sessions.entries()) {
        if (session.sessionId || !session.terminal || !session.connection) continue;

        const pane = workspace.panes.find(p => p.id === paneId);
        if (!pane) continue;

        try {
          // Connect to server using filesAPI with password
          const password = passwords.get(session.connection.id) || session.connection.password;
          console.log(`🔑 Connecting pane "${pane.name}" with connection ID ${session.connection.id}, hasPassword:`, !!password);
          const response = await filesAPI.connect(session.connection.id, password);
          
          if (!response.data.success || !response.data.data.sessionId) {
            console.error(`❌ Failed to connect pane "${pane.name}":`, response.data.error);
            continue;
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
        } catch (error) {
          console.error(`Failed to connect pane ${pane.name}:`, error);
        }
      }

      setSessions(updates);
    };

    connectPanes();
  }, [sessions, workspace, token, passwordsReady]);

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
      connectionAttemptedRef.current = false;
      setPasswordsReady(true);
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

      {/* Terminal Grid */}
      <div className={`flex-1 grid gap-2 p-2 ${getGridClass()}`}>
        {workspace.panes.map((pane, index) => {
          const session = sessions.get(pane.id);
          const connection = connections.find(c => c.id === pane.connectionId);

          return (
            <div
              key={pane.id}
              className="border rounded-lg overflow-hidden flex flex-col bg-background"
              style={getPaneStyle(pane, index)}
            >
              {/* Pane Header */}
              <div className="border-b px-3 py-2 flex items-center justify-between bg-muted/50">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">{pane.name}</div>
                  {connection && (
                    <div className="text-xs text-muted-foreground">
                      {connection.username}@{connection.host}
                    </div>
                  )}
                  {session?.sessionId && (
                    <div className="w-2 h-2 rounded-full bg-green-500" title="Connected" />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => closePane(pane.id)}
                  className="h-6 w-6 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Terminal */}
              <div className="flex-1 p-2">
                <div
                  ref={(el) => (terminalRefs.current[pane.id] = el)}
                  className="w-full h-full"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
