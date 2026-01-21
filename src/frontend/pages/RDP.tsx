import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { rdpAPI, connectionsAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card } from '../components/ui/card';
import { ArrowLeft, Power, RefreshCw, Lock, AlertCircle, Monitor, Maximize2, Minimize2 } from 'lucide-react';
import Guacamole from 'guacamole-common-js';

interface RDPProps {
  connectionIdOverride?: number;
  embedded?: boolean;
}

/**
 * Custom tunnel that works with our server-side handshake approach
 * The server handles the guacd handshake and forwards display instructions
 */
class ServerHandshakeTunnel {
  private ws: WebSocket | null = null;
  private receiveTimeout: number | null = null;
  private unstableTimeout: number | null = null;
  private readonly RECEIVE_TIMEOUT = 15000;
  private readonly UNSTABLE_THRESHOLD = 1500;

  // Tunnel interface properties
  public state: number = Guacamole.Tunnel.State.CONNECTING;
  public uuid: string = '';
  public receiveTimeout_: number = 0;
  public unstableThreshold: number = 0;

  // Event handlers
  public onstatechange: ((state: number) => void) | null = null;
  public oninstruction: ((opcode: string, args: string[]) => void) | null = null;
  public onerror: ((status: typeof Guacamole.Status.prototype) => void) | null = null;

  constructor(private url: string) {
    this.state = Guacamole.Tunnel.State.CONNECTING;
  }

  // Required method stubs for Tunnel interface
  isConnected(): boolean {
    return this.state === Guacamole.Tunnel.State.OPEN ||
           this.state === Guacamole.Tunnel.State.UNSTABLE;
  }

  connect(data?: string) {
    // Reset state
    this.state = Guacamole.Tunnel.State.CONNECTING;

    // Build URL with connection data
    const wsUrl = data ? `${this.url}?${data}` : this.url;
    console.log('[Tunnel] Connecting to:', wsUrl);

    this.ws = new WebSocket(wsUrl, 'guacamole');

    this.ws.onopen = () => {
      console.log('[Tunnel] WebSocket opened');
      this.state = Guacamole.Tunnel.State.OPEN;
      this.resetTimeout();

      if (this.onstatechange) {
        this.onstatechange(this.state);
      }
    };

    this.ws.onmessage = (event) => {
      this.resetTimeout();

      // Parse and dispatch instructions
      const message = event.data as string;
      this.parseInstructions(message);
    };

    this.ws.onerror = (event) => {
      console.error('[Tunnel] WebSocket error:', event);
      this.handleError('WebSocket error');
    };

    this.ws.onclose = (event) => {
      console.log('[Tunnel] WebSocket closed:', event.code, event.reason);
      this.clearTimeouts();

      if (this.state !== Guacamole.Tunnel.State.CLOSED) {
        this.state = Guacamole.Tunnel.State.CLOSED;
        if (this.onstatechange) {
          this.onstatechange(this.state);
        }
      }
    };
  }

  private parseInstructions(data: string) {
    let pos = 0;

    while (pos < data.length) {
      const elements: string[] = [];
      const instructionStart = pos;

      // Parse length-prefixed elements
      while (pos < data.length) {
        const dotPos = data.indexOf('.', pos);
        if (dotPos === -1) break;

        const length = parseInt(data.substring(pos, dotPos));
        if (isNaN(length)) break;

        const valueStart = dotPos + 1;
        if (valueStart + length > data.length) {
          // Incomplete - shouldn't happen with WebSocket messages
          break;
        }

        elements.push(data.substring(valueStart, valueStart + length));
        pos = valueStart + length;

        if (pos < data.length) {
          const sep = data[pos];
          pos++;
          if (sep === ';') {
            // Complete instruction - dispatch it
            if (elements.length > 0 && this.oninstruction) {
              this.oninstruction(elements[0], elements.slice(1));
            }
            break;
          } else if (sep !== ',') {
            break;
          }
        }
      }

      if (pos === instructionStart) break; // No progress
    }
  }

  sendMessage(...elements: (string | number | undefined)[]) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Convert all elements to strings, handling undefined/null
      const message = elements.map(el => {
        const str = el === undefined || el === null ? '' : String(el);
        return `${str.length}.${str}`;
      }).join(',') + ';';
      this.ws.send(message);
    }
  }

  disconnect() {
    this.clearTimeouts();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.state = Guacamole.Tunnel.State.CLOSED;
    if (this.onstatechange) {
      this.onstatechange(this.state);
    }
  }

  private resetTimeout() {
    // Clear unstable timeout
    if (this.unstableTimeout) {
      window.clearTimeout(this.unstableTimeout);
      this.unstableTimeout = null;
    }

    // If currently unstable, restore to open
    if (this.state === Guacamole.Tunnel.State.UNSTABLE) {
      this.state = Guacamole.Tunnel.State.OPEN;
      if (this.onstatechange) {
        this.onstatechange(this.state);
      }
    }

    // Clear and reset receive timeout
    if (this.receiveTimeout) {
      window.clearTimeout(this.receiveTimeout);
    }

    this.receiveTimeout = window.setTimeout(() => {
      this.handleError('Connection timed out');
    }, this.RECEIVE_TIMEOUT);

    // Set unstable threshold
    this.unstableTimeout = window.setTimeout(() => {
      if (this.state === Guacamole.Tunnel.State.OPEN) {
        this.state = Guacamole.Tunnel.State.UNSTABLE;
        if (this.onstatechange) {
          this.onstatechange(this.state);
        }
      }
    }, this.UNSTABLE_THRESHOLD);
  }

  private clearTimeouts() {
    if (this.receiveTimeout) {
      window.clearTimeout(this.receiveTimeout);
      this.receiveTimeout = null;
    }
    if (this.unstableTimeout) {
      window.clearTimeout(this.unstableTimeout);
      this.unstableTimeout = null;
    }
  }

  private handleError(message: string) {
    this.clearTimeouts();

    if (this.onerror) {
      const status = new Guacamole.Status(
        Guacamole.Status.Code.UPSTREAM_ERROR,
        message
      );
      this.onerror(status);
    }

    this.disconnect();
  }
}

export default function RDP({ connectionIdOverride, embedded = false }: RDPProps) {
  const { connectionId: paramConnectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const { token } = useAuthStore();

  const connectionId = connectionIdOverride || Number(paramConnectionId);

  const displayContainerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<typeof Guacamole.Client.prototype | null>(null);
  const tunnelRef = useRef<ServerHandshakeTunnel | null>(null);
  const mouseRef = useRef<typeof Guacamole.Mouse.prototype | null>(null);
  const keyboardRef = useRef<typeof Guacamole.Keyboard.prototype | null>(null);

  const [connection, setConnection] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const displayElementRef = useRef<HTMLElement | null>(null);

  // Get optimal screen size for RDP
  const getScreenSize = () => {
    return {
      width: Math.min(window.screen.width, 1920),
      height: Math.min(window.screen.height, 1080),
    };
  };

  // Load connection details
  useEffect(() => {
    loadConnection();
    return () => {
      cleanup();
    };
  }, [connectionId]);

  // Re-attach display element when container is available (handles React re-renders)
  useEffect(() => {
    if (displayContainerRef.current && displayElementRef.current) {
      // Check if display element is not already attached to this container
      if (displayElementRef.current.parentElement !== displayContainerRef.current) {
        console.log('[RDP] Re-attaching display element to container');
        displayContainerRef.current.innerHTML = '';
        displayContainerRef.current.appendChild(displayElementRef.current);

        // Fix Guacamole's z-index: -1 on canvases
        const canvases = displayElementRef.current.querySelectorAll('canvas');
        canvases.forEach((canvas: Element) => {
          const c = canvas as HTMLCanvasElement;
          console.log('[RDP] Re-attach: Fixing canvas z-index to 1');
          c.style.zIndex = '1';
          c.style.position = 'relative';
        });
      }
    }
  }, [connected, connecting]); // Re-run when connection state changes

  const loadConnection = async () => {
    try {
      const response = await connectionsAPI.getOne(connectionId);
      if (response.data.success) {
        const conn = response.data.data;
        setConnection(conn);
        // Use connection settings or default to 1920x1080
        const screenSize = getScreenSize();
        setCanvasSize({
          width: conn.rdpWidth || screenSize.width,
          height: conn.rdpHeight || screenSize.height,
        });

        const needsPassword = !conn.password && conn.authType === 'password';

        if (needsPassword) {
          setShowPasswordPrompt(true);
        } else if (embedded || conn.password) {
          connectRDP();
        }
      }
    } catch (error) {
      console.error('Failed to load connection:', error);
      setError('Failed to load connection details');
    }
  };

  const connectRDP = async (providedPassword?: string) => {
    if (!connection && !connectionId) return;

    setConnecting(true);
    setError('');
    setPasswordError('');

    try {
      // Create RDP session via API
      const response = await rdpAPI.connect(connectionId, providedPassword);

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to create RDP session');
      }

      const newSessionId = response.data.sessionId;
      setSessionId(newSessionId);

      const screenSize = getScreenSize();
      const width = response.data.config?.width || screenSize.width;
      const height = response.data.config?.height || screenSize.height;
      setCanvasSize({ width, height });

      // Build WebSocket URL - connect directly to backend port
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsBaseUrl = `${wsProtocol}//${window.location.hostname}:5000/ws/rdp`;

      console.log('[RDP] Creating custom tunnel to:', wsBaseUrl);
      console.log('[RDP] Token present:', !!token, 'Token length:', token?.length);
      console.log('[RDP] Session ID:', newSessionId);

      // Create our custom tunnel that works with server-side handshake
      const tunnel = new ServerHandshakeTunnel(wsBaseUrl);
      tunnelRef.current = tunnel;

      // Handle tunnel state changes
      tunnel.onstatechange = (state: number) => {
        console.log('[RDP] Tunnel state changed:', state,
          state === Guacamole.Tunnel.State.CONNECTING ? 'CONNECTING' :
          state === Guacamole.Tunnel.State.OPEN ? 'OPEN' :
          state === Guacamole.Tunnel.State.CLOSED ? 'CLOSED' :
          state === Guacamole.Tunnel.State.UNSTABLE ? 'UNSTABLE' : 'UNKNOWN');
      };

      // Handle tunnel errors
      tunnel.onerror = (status: typeof Guacamole.Status.prototype) => {
        console.error('[RDP] Tunnel error:', status);
        setError(status.message || 'Connection error');
        setConnecting(false);
      };

      // Create Guacamole client (cast our custom tunnel to Guacamole.Tunnel)
      const client = new Guacamole.Client(tunnel as unknown as typeof Guacamole.Tunnel.prototype);
      clientRef.current = client;

      // Handle client state changes
      client.onstatechange = (state: number) => {
        console.log('[RDP] Client state changed:', state,
          state === 0 ? 'IDLE' :
          state === 1 ? 'CONNECTING' :
          state === 2 ? 'WAITING' :
          state === 3 ? 'CONNECTED' :
          state === 4 ? 'DISCONNECTING' :
          state === 5 ? 'DISCONNECTED' : 'UNKNOWN');

        switch (state) {
          case Guacamole.Client.State.IDLE:
            break;
          case Guacamole.Client.State.CONNECTING:
            setConnecting(true);
            break;
          case Guacamole.Client.State.WAITING:
            break;
          case Guacamole.Client.State.CONNECTED:
            console.log('[RDP] Connected!');
            setConnected(true);
            setConnecting(false);
            break;
          case Guacamole.Client.State.DISCONNECTING:
          case Guacamole.Client.State.DISCONNECTED:
            setConnected(false);
            setConnecting(false);
            break;
        }
      };

      // Handle errors
      client.onerror = (error: typeof Guacamole.Status.prototype) => {
        console.error('[RDP] Client error:', error);
        const errorMessage = error.message || 'Connection error';
        setError(errorMessage);
        setConnecting(false);
      };

      // Add display to container
      const display = client.getDisplay();
      const displayElement = display.getElement();

      // Store reference to display element for re-attachment after React re-renders
      displayElementRef.current = displayElement;

      // Don't override Guacamole's display sizing - it manages canvas dimensions internally
      // Just ensure the element is visible
      displayElement.style.position = 'relative';
      displayElement.style.display = 'block';

      // Attach to container if available (may not be available yet due to React render timing)
      if (displayContainerRef.current) {
        displayContainerRef.current.innerHTML = '';
        displayContainerRef.current.appendChild(displayElement);

        // Fix Guacamole's z-index: -1 on canvases that causes them to render behind backgrounds
        // Use MutationObserver to catch dynamically added canvases
        const fixCanvasZIndex = (canvas: HTMLCanvasElement) => {
          if (canvas.style.zIndex === '-1' || canvas.style.zIndex === '') {
            console.log('[RDP] Fixing canvas z-index from', canvas.style.zIndex, 'to 1');
            canvas.style.zIndex = '1';
            canvas.style.position = 'relative';
          }
        };

        // Fix any existing canvases
        displayElement.querySelectorAll('canvas').forEach((canvas: Element) => {
          fixCanvasZIndex(canvas as HTMLCanvasElement);
        });

        // Watch for new canvases being added
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node instanceof HTMLCanvasElement) {
                console.log('[RDP] MutationObserver: New canvas detected');
                fixCanvasZIndex(node);
              }
              // Also check children if it's an element
              if (node instanceof HTMLElement) {
                node.querySelectorAll('canvas').forEach((canvas) => {
                  fixCanvasZIndex(canvas as HTMLCanvasElement);
                });
              }
            });
          });
        });

        observer.observe(displayElement, {
          childList: true,
          subtree: true,
        });

        // Store observer for cleanup - we'll handle this in the disconnect function
        (displayElement as any).__zindexObserver = observer;
      }

      // Handle display resize events from server
      display.onresize = (newWidth: number, newHeight: number) => {
        console.log('[RDP] Display resize event:', newWidth, 'x', newHeight);
        setCanvasSize({ width: newWidth, height: newHeight });

        // Force the container to match
        if (displayContainerRef.current) {
          displayContainerRef.current.style.width = `${newWidth}px`;
          displayContainerRef.current.style.height = `${newHeight}px`;
        }
      };

      console.log('[RDP] Display setup complete, waiting for frames...');

      // Set up mouse handling
      const mouse = new Guacamole.Mouse(displayElement);
      mouseRef.current = mouse;

      mouse.onmousedown =
      mouse.onmouseup =
      mouse.onmousemove = (mouseState: typeof Guacamole.Mouse.State.prototype) => {
        client.sendMouseState(mouseState);
      };

      // Set up keyboard handling
      const keyboard = new Guacamole.Keyboard(document);
      keyboardRef.current = keyboard;

      keyboard.onkeydown = (keysym: number) => {
        client.sendKeyEvent(1, keysym);
      };

      keyboard.onkeyup = (keysym: number) => {
        client.sendKeyEvent(0, keysym);
      };

      // Connect the client with token and sessionId as query data
      const connectData = `token=${encodeURIComponent(token!)}&sessionId=${encodeURIComponent(newSessionId)}`;
      console.log('[RDP] Calling client.connect() with data');
      client.connect(connectData);
      console.log('[RDP] client.connect() called');

      setShowPasswordPrompt(false);
    } catch (error: any) {
      console.error('[RDP] Connect error:', error);
      if (showPasswordPrompt) {
        setPasswordError(error.response?.data?.error || error.message || 'Connection failed');
      } else {
        setError(error.response?.data?.error || error.message || 'Failed to connect');
      }
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    // Disconnect client
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }

    // Disconnect tunnel
    if (tunnelRef.current) {
      tunnelRef.current.disconnect();
      tunnelRef.current = null;
    }

    // Clean up mouse
    if (mouseRef.current) {
      mouseRef.current = null;
    }

    // Clean up keyboard
    if (keyboardRef.current) {
      keyboardRef.current = null;
    }

    // Clear display container
    if (displayContainerRef.current) {
      displayContainerRef.current.innerHTML = '';
    }

    if (sessionId) {
      try {
        await rdpAPI.disconnect(sessionId);
      } catch (error) {
        console.error('[RDP] Failed to disconnect:', error);
      }
    }

    setConnected(false);
    setSessionId(null);
  };

  const cleanup = () => {
    disconnect();
  };

  const toggleFullscreen = () => {
    const container = document.getElementById('rdp-container');
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch(err => {
        console.error('Failed to exit fullscreen:', err);
      });
    }
  };

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setPasswordError('Password is required');
      return;
    }
    connectRDP(password);
  };

  // Password prompt dialog
  if (showPasswordPrompt) {
    return (
      <div className={`flex items-center justify-center ${embedded ? 'h-full' : 'min-h-screen'} bg-background`}>
        <Card className="max-w-md w-full p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="rounded-full bg-primary/10 p-3">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Authentication Required</h2>
              <p className="text-sm text-muted-foreground">
                Enter password for {connection?.name || 'RDP connection'}
              </p>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoFocus
              />
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
            </div>

            <div className="flex gap-3">
              {!embedded && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(-1)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              )}
              <Button type="submit" className="flex-1" disabled={connecting}>
                {connecting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div id="rdp-container" className={`flex flex-col ${embedded ? 'h-full' : 'min-h-screen'} bg-background`}>
      {/* Header */}
      {!embedded && (
        <div className="border-b border-border bg-card/30 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-purple-500/10 p-2">
                    <Monitor className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold">
                      {connection?.name || 'RDP Connection'}
                    </h1>
                    <p className="text-xs text-muted-foreground">
                      {connection?.host}:{connection?.port || 3389}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {connected && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleFullscreen}
                    >
                      {isFullscreen ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={disconnect}
                    >
                      <Power className="h-4 w-4 mr-2" />
                      Disconnect
                    </Button>
                  </>
                )}
                {!connected && !connecting && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => connectRDP()}
                  >
                    <Power className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={`flex-1 flex items-center justify-center ${isFullscreen ? 'p-0' : 'p-4'} bg-black/95`}>
        {error && (
          <Card className="max-w-md p-6">
            <div className="flex items-center gap-3 text-destructive mb-4">
              <AlertCircle className="h-6 w-6" />
              <h3 className="font-semibold">Connection Error</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <div className="flex gap-3">
              {!embedded && (
                <Button variant="outline" onClick={() => navigate(-1)}>
                  Go Back
                </Button>
              )}
              <Button onClick={() => { setError(''); connectRDP(); }}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          </Card>
        )}

        {connecting && !error && (
          <Card className="max-w-md p-6">
            <div className="flex flex-col items-center gap-4">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <h3 className="font-semibold">Connecting...</h3>
                <p className="text-sm text-muted-foreground">
                  Establishing connection to {connection?.host}
                </p>
              </div>
            </div>
          </Card>
        )}

        {!connecting && !error && !connected && !showPasswordPrompt && (
          <Card className="max-w-md p-6">
            <div className="flex flex-col items-center gap-4">
              <Monitor className="h-12 w-12 text-muted-foreground" />
              <div className="text-center">
                <h3 className="font-semibold">Ready to Connect</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Click the button below to connect to {connection?.name}
                </p>
                <Button onClick={() => connectRDP()}>
                  <Power className="h-4 w-4 mr-2" />
                  Connect
                </Button>
              </div>
            </div>
          </Card>
        )}

        {(connected || connecting) && !error && (
          <div
            ref={displayContainerRef}
            className={isFullscreen ? '' : 'border border-border rounded shadow-lg'}
            style={{
              width: isFullscreen ? '100vw' : canvasSize.width,
              height: isFullscreen ? '100vh' : canvasSize.height,
              maxWidth: isFullscreen ? '100vw' : '100%',
              maxHeight: isFullscreen ? '100vh' : 'calc(100vh - 120px)',
              position: 'relative',
              overflow: 'hidden',
              backgroundColor: 'black',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            tabIndex={0}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
      </div>

      {/* Status Bar */}
      {!embedded && connected && (
        <div className="border-t border-border bg-card/30 px-4 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Connected
              </span>
              <span>{canvasSize.width}x{canvasSize.height}</span>
            </div>
            <span>Press F11 or use button for fullscreen</span>
          </div>
        </div>
      )}
    </div>
  );
}
