import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { connectionsAPI, filesAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { ArrowLeft, Power, RefreshCw, Lock, AlertCircle, Activity, PanelRightClose, PanelRightOpen, Plus, X, Edit2, Check } from 'lucide-react';
import { ServerMetrics } from '../components/ServerMetrics';
import { SystemInfo } from '../components/SystemInfo';
import { NetworkInterfaces } from '../components/NetworkInterfaces';
import { UptimeDisplay } from '../components/UptimeDisplay';
import { ServerStats } from '../../types';

interface TerminalSession {
  id: string;
  name: string;
  sessionId: string;
  connected: boolean;
  connecting: boolean;
  terminal: XTerm | null;
  ws: WebSocket | null;
  fitAddon: FitAddon | null;
}

export default function Terminal() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const { token } = useAuthStore();
  
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  
  const [connection, setConnection] = useState<any>(null);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [error, setError] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  
  // Stats panel state
  const [showStatsPanel, setShowStatsPanel] = useState(true);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [statsConnected, setStatsConnected] = useState(false);
  const statsWsRef = useRef<WebSocket | null>(null);

  const activeSession = sessions.find(s => s.id === activeTabId);

  // Load connection details
  useEffect(() => {
    loadConnection();
    return () => {
      cleanup();
    };
  }, [connectionId]);

  const loadConnection = async () => {
    try {
      const response = await connectionsAPI.getOne(Number(connectionId));
      if (response.data.success) {
        const conn = response.data.data;
        setConnection(conn);
        
        const needsPassword = !conn.password && conn.auth_type === 'password';
        
        if (needsPassword) {
          setShowPasswordPrompt(true);
        } else {
          // Create first session automatically
          createNewSession('Main');
        }
      }
    } catch (error) {
      console.error('Failed to load connection:', error);
      setError('Failed to load connection details');
    }
  };

  // Create a new terminal session/tab
  const createNewSession = useCallback((name?: string) => {
    if (!connection) return;
    
    const newId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sessionName = name || `Session ${sessions.length + 1}`;
    
    const newSession: TerminalSession = {
      id: newId,
      name: sessionName,
      sessionId: '',
      connected: false,
      connecting: true,
      terminal: null,
      ws: null,
      fitAddon: null,
    };
    
    setSessions(prev => [...prev, newSession]);
    setActiveTabId(newId);
    
    // Connect after state update
    setTimeout(() => connectSession(newId), 100);
  }, [connection, sessions.length]);

  // Connect a specific session to the server
  const connectSession = async (tabId: string) => {
    const sessionIndex = sessions.findIndex(s => s.id === tabId);
    if (sessionIndex === -1 || !connection) return;

    try {
      // Create SSH session
      const response = await filesAPI.connect(Number(connectionId), password || undefined);
      const newSessionId = response.data.sessionId;

      // Create terminal instance
      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#0a0a0a',
          foreground: '#ffffff',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      // Create WebSocket connection
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.hostname}:5000/ws/terminal?token=${token}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(`WebSocket connected for tab ${tabId}`);
        
        ws.send(JSON.stringify({
          type: 'connect',
          data: {
            connectionId: Number(connectionId),
            sessionId: newSessionId,
            cols: term.cols,
            rows: term.rows,
          },
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'connected':
              setSessions(prev => prev.map(s => 
                s.id === tabId ? { ...s, connected: true, connecting: false, sessionId: newSessionId } : s
              ));
              term.writeln('\x1b[32mConnected to server\x1b[0m\r\n');
              
              // Start stats WebSocket for first session only
              if (sessions.length === 0 || sessions[0].id === tabId) {
                connectStatsWebSocket(newSessionId);
              }
              break;
              
            case 'output':
              term.write(message.data);
              break;
              
            case 'error':
              term.writeln(`\r\n\x1b[31mError: ${message.data}\x1b[0m\r\n`);
              setError(message.data);
              setSessions(prev => prev.map(s => 
                s.id === tabId ? { ...s, connecting: false } : s
              ));
              break;
              
            case 'disconnected':
              term.writeln('\r\n\x1b[33mConnection closed\x1b[0m\r\n');
              setSessions(prev => prev.map(s => 
                s.id === tabId ? { ...s, connected: false } : s
              ));
              break;
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('WebSocket connection failed');
      };

      ws.onclose = () => {
        console.log(`WebSocket closed for tab ${tabId}`);
        setSessions(prev => prev.map(s => 
          s.id === tabId ? { ...s, connected: false, connecting: false } : s
        ));
      };

      // Handle terminal input
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'input',
            data: data,
          }));
        }
      });

      // Handle terminal resize
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'resize',
            data: { cols, rows },
          }));
        }
      });

      // Update session with terminal instances
      setSessions(prev => prev.map(s => 
        s.id === tabId ? { ...s, terminal: term, ws, fitAddon } : s
      ));

    } catch (error: any) {
      console.error('Connection error:', error);
      const errorMsg = error.response?.data?.error || 'Failed to connect to server';
      setError(errorMsg);
      setSessions(prev => prev.map(s => 
        s.id === tabId ? { ...s, connecting: false } : s
      ));
      
      if (errorMsg.includes('authentication') || errorMsg.includes('Authentication')) {
        setShowPasswordPrompt(true);
        setPasswordError('Authentication failed. Please check your password.');
      }
    }
  };

  // Render terminal when it becomes active
  useEffect(() => {
    if (!activeSession || !activeSession.terminal || !terminalContainerRef.current) return;

    const container = terminalContainerRef.current;
    
    // Clear container
    container.innerHTML = '';
    
    // Open terminal in container
    activeSession.terminal.open(container);
    
    // Fit terminal to container
    if (activeSession.fitAddon) {
      setTimeout(() => {
        activeSession.fitAddon?.fit();
      }, 0);
    }

    // Handle window resize
    const handleResize = () => {
      if (activeSession.fitAddon) {
        activeSession.fitAddon.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTabId, activeSession]);

  // Close a terminal session/tab
  const closeSession = (tabId: string) => {
    const session = sessions.find(s => s.id === tabId);
    if (!session) return;

    // Cleanup WebSocket
    if (session.ws) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: 'disconnect' }));
      }
      session.ws.close();
    }

    // Cleanup terminal
    if (session.terminal) {
      session.terminal.dispose();
    }

    // Disconnect from backend
    if (session.sessionId) {
      filesAPI.disconnect(session.sessionId, 'ssh').catch(console.error);
    }

    // Remove from sessions
    const newSessions = sessions.filter(s => s.id !== tabId);
    setSessions(newSessions);

    // Switch to another tab if this was active
    if (activeTabId === tabId && newSessions.length > 0) {
      setActiveTabId(newSessions[0].id);
    }
  };

  // Rename a session
  const renameSession = (tabId: string, newName: string) => {
    setSessions(prev => prev.map(s => 
      s.id === tabId ? { ...s, name: newName } : s
    ));
    setEditingTabId(null);
  };

  // Start editing tab name
  const startEditingTab = (tabId: string, currentName: string) => {
    setEditingTabId(tabId);
    setEditingTabName(currentName);
  };

  // Stats WebSocket functions
  const connectStatsWebSocket = (sid: string) => {
    if (!token) return;

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.hostname}:5000/ws/stats?token=${token}`;

      const ws = new WebSocket(wsUrl);
      statsWsRef.current = ws;

      ws.onopen = () => {
        console.log('Stats WebSocket connected');
        setStatsConnected(true);
        
        ws.send(JSON.stringify({
          type: 'start',
          data: { sessionId: sid, interval: 5000 }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'stats':
              setStats(message.data);
              break;
            case 'error':
              console.error('Stats error:', message.data);
              break;
          }
        } catch (err) {
          console.error('Failed to parse stats message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('Stats WebSocket error:', err);
      };

      ws.onclose = () => {
        console.log('Stats WebSocket closed');
        setStatsConnected(false);
        
        if (activeSession?.connected && sid) {
          setTimeout(() => {
            console.log('Reconnecting stats WebSocket...');
            connectStatsWebSocket(sid);
          }, 3000);
        }
      };
    } catch (err) {
      console.error('Failed to create stats WebSocket:', err);
    }
  };

  const disconnectStatsWebSocket = () => {
    if (statsWsRef.current) {
      if (statsWsRef.current.readyState === WebSocket.OPEN) {
        statsWsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      statsWsRef.current.close();
      statsWsRef.current = null;
    }
    setStatsConnected(false);
    setStats(null);
  };

  const cleanup = () => {
    // Close all sessions
    sessions.forEach(session => {
      if (session.ws) {
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({ type: 'disconnect' }));
        }
        session.ws.close();
      }
      
      if (session.terminal) {
        session.terminal.dispose();
      }
      
      if (session.sessionId) {
        filesAPI.disconnect(session.sessionId, 'ssh').catch(console.error);
      }
    });

    disconnectStatsWebSocket();
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setPasswordError('Password is required');
      return;
    }
    
    setShowPasswordPrompt(false);
    createNewSession('Main');
  };

  const disconnectSession = (tabId: string) => {
    const session = sessions.find(s => s.id === tabId);
    if (!session || !session.ws) return;

    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: 'disconnect' }));
    }
    session.ws.close();
    
    if (session.sessionId) {
      filesAPI.disconnect(session.sessionId, 'ssh').catch(console.error);
    }
    
    setSessions(prev => prev.map(s => 
      s.id === tabId ? { ...s, connected: false, sessionId: '' } : s
    ));
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Password Prompt Modal */}
      {showPasswordPrompt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <Card className="max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="rounded-full bg-primary/20 p-3">
                <Lock className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Authentication Required</h2>
                <p className="text-sm text-muted-foreground">Enter password for {connection?.username}@{connection?.host}</p>
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password..."
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  Connect
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/connections')}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-card border-b border-border">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/connections')}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground">
              {connection?.name || 'Terminal'}
            </h1>
            {connection && (
              <p className="text-xs text-muted-foreground">
                {connection.username}@{connection.host}:{connection.port}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {activeSession?.connected && (
            <Button
              onClick={() => setShowStatsPanel(!showStatsPanel)}
              variant="outline"
              size="sm"
            >
              {showStatsPanel ? <PanelRightClose className="h-3.5 w-3.5 mr-2" /> : <PanelRightOpen className="h-3.5 w-3.5 mr-2" />}
              {showStatsPanel ? 'Hide' : 'Show'} Stats
            </Button>
          )}
          
          {activeSession?.connected && (
            <Button
              onClick={() => disconnectSession(activeTabId)}
              variant="destructive"
              size="sm"
            >
              <Power className="h-3.5 w-3.5 mr-2" />
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-6 mt-3 px-4 py-3 bg-destructive/10 border border-destructive text-destructive rounded-lg flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Tabs Bar */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-2 bg-card/50 border-b border-border overflow-x-auto">
          {sessions.map(session => (
            <div
              key={session.id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg cursor-pointer transition-colors ${
                activeTabId === session.id
                  ? 'bg-background border-t border-x border-border'
                  : 'bg-card/30 hover:bg-card/50'
              }`}
              onClick={() => setActiveTabId(session.id)}
            >
              <div className={`w-2 h-2 rounded-full ${
                session.connected ? 'bg-success animate-pulse' : session.connecting ? 'bg-warning animate-pulse' : 'bg-destructive'
              }`} />
              
              {editingTabId === session.id ? (
                <Input
                  value={editingTabName}
                  onChange={(e) => setEditingTabName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameSession(session.id, editingTabName);
                    } else if (e.key === 'Escape') {
                      setEditingTabId(null);
                    }
                  }}
                  onBlur={() => renameSession(session.id, editingTabName)}
                  className="h-6 w-24 text-xs px-2"
                  autoFocus
                />
              ) : (
                <>
                  <span className="text-xs font-medium">{session.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditingTab(session.id, session.name);
                    }}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </>
              )}
              
              {sessions.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 hover:bg-destructive/20 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(session.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          
          <Button
            variant="ghost"
            size="sm"
            className="ml-2 h-7 gap-1"
            onClick={() => createNewSession()}
          >
            <Plus className="h-3.5 w-3.5" />
            New Tab
          </Button>
        </div>
      )}

      {/* Terminal and Stats Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Terminal */}
        <div className={`flex-1 p-4 overflow-hidden transition-all duration-300`}>
          <div 
            ref={terminalContainerRef}
            className="w-full h-full rounded-lg overflow-hidden border border-border shadow-2xl"
            style={{ backgroundColor: '#0a0a0a' }}
          />
        </div>

        {/* Stats Panel */}
        {activeSession?.connected && showStatsPanel && (
          <div className="w-96 border-l border-border overflow-y-auto bg-card/30 backdrop-blur-sm">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold">Live Server Stats</h2>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${statsConnected ? 'bg-success animate-pulse' : 'bg-warning'}`} />
                  <span className="text-xs text-muted-foreground">
                    {statsConnected ? 'Live' : 'Connecting...'}
                  </span>
                </div>
              </div>

              {stats ? (
                <>
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
                    </Card>
                  </div>

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

                  {/* Network */}
                  {stats.network && stats.network.length > 0 && (
                    <Card className="p-3 bg-card/50">
                      <h3 className="text-xs font-semibold text-foreground mb-2">Network</h3>
                      <div className="space-y-2">
                        {stats.network.slice(0, 3).map((iface, index) => (
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
                </>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <RefreshCw className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Loading stats...</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
