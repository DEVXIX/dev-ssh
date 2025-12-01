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
import { ArrowLeft, Power, RefreshCw, Lock, AlertCircle, Activity, PanelRightClose, PanelRightOpen, Plus, X, Edit2, Check, FolderOpen } from 'lucide-react';
import { ServerMetrics } from '../components/ServerMetrics';
import { SystemInfo } from '../components/SystemInfo';
import { NetworkInterfaces } from '../components/NetworkInterfaces';
import { UptimeDisplay } from '../components/UptimeDisplay';
import { ServerStats } from '../../types';
import { FileManager, FileEditorProvider, useFileEditor } from '../components/file-manager/FileManager';

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

function TerminalContent({ activeSessionId, onSessionChange }: { activeSessionId: string; onSessionChange: (id: string) => void }) {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const { token } = useAuthStore();
  const fileEditor = useFileEditor();
  
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<string>('');
  
  const [connection, setConnection] = useState<any>(null);
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [error, setError] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const [viewMode, setViewMode] = useState<'tabs' | 'split'>('tabs');
  const [shouldAutoConnect, setShouldAutoConnect] = useState(false);
  
  // Stats panel state
  const [showStatsPanel, setShowStatsPanel] = useState(true);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [statsConnected, setStatsConnected] = useState(false);
  const statsWsRef = useRef<WebSocket | null>(null);

  // File Manager panel state
  const [showFileManager, setShowFileManager] = useState(false);

  const activeSession = sessions.find(s => s.id === activeTabId);

  // Update parent with active session ID
  useEffect(() => {
    if (activeSession?.sessionId) {
      onSessionChange(activeSession.sessionId);
    }
  }, [activeSession?.sessionId, onSessionChange]);

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
          setShouldAutoConnect(true);
        }
      }
    } catch (error) {
      console.error('Failed to load connection:', error);
      setError('Failed to load connection details');
    }
  };

  // Create a new terminal session/tab
  const createNewSession = useCallback((name?: string) => {
    if (!connection) {
      return;
    }
    
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
    
    // Connect immediately - the function will work with the tabId
    connectSession(newId, connection);
  }, [connection, sessions.length]);

  // Auto-connect when connection is loaded and has stored password
  useEffect(() => {
    if (shouldAutoConnect && connection && sessions.length === 0) {
      setShouldAutoConnect(false); // Reset flag
      createNewSession('Main');
    }
  }, [shouldAutoConnect, connection, sessions.length, createNewSession]);

  // Connect a specific session to the server
  const connectSession = async (tabId: string, conn?: any) => {
    const connectionData = conn || connection;
    
    if (!connectionData) {
      return;
    }

    try {
      // Create SSH session - use passwordRef or connection password
      const authPassword = passwordRef.current || connectionData.password || undefined;
      const response = await filesAPI.connect(Number(connectionId), authPassword);
      const newSessionId = response.data.data.sessionId;

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
        // First, update session with terminal instances so it can be rendered
        setSessions(prev => prev.map(s => 
          s.id === tabId ? { ...s, terminal: term, ws, fitAddon, sessionId: newSessionId } : s
        ));
        
        // Then send connect message after a short delay to ensure terminal is rendered
        setTimeout(() => {
          const connectMessage = {
            type: 'connect',
            data: {
              connectionId: Number(connectionId),
              sessionId: newSessionId,
              cols: term.cols,
              rows: term.rows,
            },
          };
          ws.send(JSON.stringify(connectMessage));
        }, 100);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'connected':
              setSessions(prev => prev.map(s => 
                s.id === tabId ? { ...s, connected: true, connecting: false } : s
              ));
              term.writeln('\x1b[32mConnected to server\x1b[0m\r\n');
              
              // Connect stats WebSocket for this session
              connectStatsWebSocket(newSessionId);
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
    if (!activeSession || !activeSession.terminal) return;

    // Find the terminal container for this specific session
    const container = document.getElementById(`terminal-${activeSession.id}`);
    if (!container) {
      return;
    }
    
    // Only open the terminal if it hasn't been opened yet
    if (!container.hasChildNodes()) {
      activeSession.terminal.open(container);
      
      // Fit terminal to container
      if (activeSession.fitAddon) {
        setTimeout(() => {
          activeSession.fitAddon?.fit();
        }, 0);
      }
    } else {
      // Just fit the existing terminal
      if (activeSession.fitAddon) {
        setTimeout(() => {
          activeSession.fitAddon?.fit();
        }, 0);
      }
    }

    // Handle window resize
    const handleResize = () => {
      if (activeSession.fitAddon) {
        activeSession.fitAddon.fit();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeSession?.id, activeSession?.terminal, viewMode]);

  // Render all terminals in split view
  useEffect(() => {
    if (viewMode !== 'split') return;

    sessions.forEach(session => {
      if (!session.terminal) return;

      const container = document.getElementById(`terminal-${session.id}`);
      if (!container) return;

      // Get the terminal element
      const termElement = session.terminal.element;
      
      // If terminal element exists and is attached elsewhere, move it
      if (termElement) {
        // Remove from old parent if exists
        if (termElement.parentNode && termElement.parentNode !== container) {
          termElement.parentNode.removeChild(termElement);
          container.appendChild(termElement);
        } else if (!container.contains(termElement)) {
          // Terminal not in container yet
          container.appendChild(termElement);
        }
      } else {
        // Terminal not opened yet, open it
        session.terminal.open(container);
      }

      // Fit all terminals
      if (session.fitAddon) {
        setTimeout(() => {
          session.fitAddon?.fit();
        }, 100);
      }
    });
  }, [viewMode, sessions]);

  // Resize terminals when view mode changes
  useEffect(() => {
    const resizeTimeout = setTimeout(() => {
      sessions.forEach(session => {
        if (session.fitAddon && session.terminal) {
          const container = document.getElementById(`terminal-${session.id}`);
          if (container && container.hasChildNodes()) {
            session.fitAddon.fit();
          }
        }
      });
    }, 200);

    return () => clearTimeout(resizeTimeout);
  }, [viewMode, sessions.length]);

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
        setStatsConnected(false);
        
        if (activeSession?.connected && sid) {
          setTimeout(() => {
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
    
    passwordRef.current = password;
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
          {sessions.length > 0 && (
            <div className="flex items-center gap-1 border border-border rounded-md p-1">
              <Button
                onClick={() => setViewMode('tabs')}
                variant={viewMode === 'tabs' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-2"
              >
                Tabs
              </Button>
              <Button
                onClick={() => setViewMode('split')}
                variant={viewMode === 'split' ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-2"
              >
                Split
              </Button>
            </div>
          )}
          
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
              onClick={() => setShowFileManager(!showFileManager)}
              variant="outline"
              size="sm"
            >
              <FolderOpen className="h-3.5 w-3.5 mr-2" />
              {showFileManager ? 'Hide' : 'Show'} Files
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
        {/* Terminal and Editor Container */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Terminal */}
          {viewMode === 'tabs' ? (
            /* Tabs View - Show only active terminal */
            <div className={`${fileEditor.editingFile ? 'flex-1' : 'flex-1'} p-4 overflow-hidden transition-all duration-300 relative`}>
              {sessions.map(session => (
                <div
                  key={session.id}
                  id={`terminal-${session.id}`}
                  className={`w-full h-full rounded-lg overflow-hidden border border-border shadow-2xl ${
                    activeTabId === session.id ? 'block' : 'hidden'
                  }`}
                  style={{ backgroundColor: '#0a0a0a' }}
                />
              ))}
            </div>
          ) : (
          /* Split View - Show all terminals in grid */
          <div className="flex-1 p-4 overflow-hidden transition-all duration-300">
            <div className={`w-full h-full grid gap-4 ${
              sessions.length === 1 ? 'grid-cols-1' :
              sessions.length === 2 ? 'grid-cols-2' :
              sessions.length === 3 ? 'grid-cols-2 grid-rows-2' :
              'grid-cols-2 grid-rows-2'
            }`}>
              {sessions.slice(0, 4).map(session => (
                <div
                  key={session.id}
                  className="relative border border-border rounded-lg overflow-hidden shadow-xl"
                  style={{ backgroundColor: '#0a0a0a' }}
                >
                  {/* Terminal label */}
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-2 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      session.connected ? 'bg-success' : session.connecting ? 'bg-warning' : 'bg-destructive'
                    }`} />
                    <span className="font-medium">{session.name}</span>
                  </div>
                  {/* Terminal container */}
                  <div
                    id={`terminal-${session.id}`}
                    className="w-full h-full"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

          {/* Editor Panel */}
          {fileEditor.editingFile && (
            <div className="border-t border-border bg-card flex flex-col" style={{ height: '40%' }}>
              <div className="border-b border-border bg-muted/30 p-2 flex items-center justify-between">
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
              <div className="flex-1 overflow-auto">
                <textarea
                  value={fileEditor.editContent}
                  onChange={(e) => fileEditor.updateContent(e.target.value)}
                  className="w-full h-full p-3 bg-transparent font-mono text-sm resize-none focus:outline-none"
                  spellCheck={false}
                  placeholder="File content..."
                />
              </div>
            </div>
          )}
        </div>

        {/* File Manager Panel */}
        {activeSession?.connected && showFileManager && activeSession.sessionId && (
          <div className="w-96 border-l border-border overflow-hidden bg-card/30 backdrop-blur-sm">
            <FileManager
              sessionId={activeSession.sessionId}
              connectionType={connection?.type || 'ssh'}
            />
          </div>
        )}

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

export default function Terminal() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const [connection, setConnection] = useState<any>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>('');

  // Load connection details to get type
  useEffect(() => {
    const loadConnection = async () => {
      if (!connectionId) return;
      try {
        const response = await connectionsAPI.getOne(Number(connectionId));
        if (response.data.success) {
          setConnection(response.data.data);
        }
      } catch (error) {
        console.error('Failed to load connection:', error);
      }
    };
    loadConnection();
  }, [connectionId]);

  return (
    <FileEditorProvider
      sessionId={activeSessionId}
      connectionType={connection?.type || 'ssh'}
    >
      <TerminalContent activeSessionId={activeSessionId} onSessionChange={setActiveSessionId} />
    </FileEditorProvider>
  );
}
