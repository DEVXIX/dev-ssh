import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Activity, Info } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ServerMetrics } from '../components/ServerMetrics';
import { SystemInfo } from '../components/SystemInfo';
import { NetworkInterfaces } from '../components/NetworkInterfaces';
import { UptimeDisplay } from '../components/UptimeDisplay';
import { statsAPI, connectionsAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { ServerStats } from '../../types';
import { Input } from '../components/ui/input';

export default function ServerDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useAuthStore();
  
  // Determine if we're viewing via sessionId (live) or connectionId (saved/fetch)
  const sessionId = location.state?.sessionId;
  const connectionId = sessionId ? null : Number(id);
  const isLiveMode = !!sessionId;

  const [stats, setStats] = useState<ServerStats | null>(null);
  const [connectionDetails, setConnectionDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(isLiveMode);
  const [wsConnected, setWsConnected] = useState(false);
  const [fetchingFresh, setFetchingFresh] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connectWebSocket = () => {
    if (!sessionId || !token) return;

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.hostname}:5000/ws/stats?token=${token}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Stats WebSocket connected');
        setError(null);
        setWsConnected(true);
        
        // Start stats streaming
        ws.send(JSON.stringify({
          type: 'start',
          data: { sessionId, interval: 5000 }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case 'stats':
              setStats(message.data);
              setLoading(false);
              break;

            case 'error':
              setError(message.data);
              setLoading(false);
              break;

            case 'started':
              console.log('Stats streaming started');
              break;
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('Stats WebSocket error:', err);
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        console.log('Stats WebSocket closed');
        setWsConnected(false);
        
        // Auto-reconnect if auto-refresh is enabled
        if (autoRefresh) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('Reconnecting stats WebSocket...');
            connectWebSocket();
          }, 3000);
        }
      };
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      setError('Failed to establish WebSocket connection');
    }
  };

  const disconnectWebSocket = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      // Send stop message before closing
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const fetchStats = async () => {
    if (isLiveMode && sessionId) {
      // Live mode: fetch from active session
      try {
        setError(null);
        const response = await statsAPI.getStats(sessionId);
        setStats(response.data);
      } catch (err: any) {
        console.error('Failed to fetch server stats:', err);
        setError(err.response?.data?.error || 'Failed to fetch server statistics');
      } finally {
        setLoading(false);
      }
    } else if (connectionId) {
      // Saved mode: fetch latest saved stats
      try {
        setError(null);
        const response = await statsAPI.getLatestStats(connectionId);
        setStats(response.data.data);
      } catch (err: any) {
        console.error('Failed to fetch saved stats:', err);
        if (err.response?.status === 404) {
          setError('No saved stats available. Fetch fresh stats to view server information.');
        } else {
          setError(err.response?.data?.error || 'Failed to fetch server statistics');
        }
      } finally {
        setLoading(false);
      }
    }
  };

  const fetchFreshStats = async () => {
    if (!connectionId) return;
    
    setFetchingFresh(true);
    setError(null);
    setNeedsPassword(false);

    try {
      const response = await statsAPI.fetchFreshStats(connectionId, password || undefined);
      setStats(response.data.data);
      setPassword(''); // Clear password after successful fetch
    } catch (err: any) {
      console.error('Failed to fetch fresh stats:', err);
      if (err.response?.data?.needsPassword) {
        setNeedsPassword(true);
        setError('This server requires a password. Please enter it below.');
      } else {
        setError(err.response?.data?.error || 'Failed to fetch server statistics');
      }
    } finally {
      setFetchingFresh(false);
    }
  };

  // Fetch connection details
  useEffect(() => {
    const loadConnectionDetails = async () => {
      if (connectionId) {
        try {
          const response = await connectionsAPI.getOne(connectionId);
          setConnectionDetails(response.data);
        } catch (err) {
          console.error('Failed to fetch connection details:', err);
        }
      }
    };
    loadConnectionDetails();
  }, [connectionId]);

  useEffect(() => {
    if (isLiveMode && autoRefresh) {
      connectWebSocket();
    } else if (isLiveMode && !autoRefresh) {
      disconnectWebSocket();
      fetchStats();
    } else {
      // Not live mode, just fetch saved stats
      fetchStats();
    }

    return () => {
      disconnectWebSocket();
    };
  }, [sessionId, connectionId, autoRefresh]);

  const handleRefresh = () => {
    if (autoRefresh && wsRef.current?.readyState === WebSocket.OPEN) {
      // Request immediate refresh via WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'refresh',
        data: { sessionId }
      }));
    } else {
      // Fallback to HTTP fetch
      setLoading(true);
      fetchStats();
    }
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-card/50 backdrop-blur-sm border-b border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              <div>
                <h1 className="text-xl font-semibold">Server Details</h1>
                {connectionDetails && (
                  <p className="text-xs text-muted-foreground">
                    {connectionDetails.username}@{connectionDetails.host}:{connectionDetails.port}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isLiveMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchFreshStats}
                disabled={fetchingFresh}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${fetchingFresh ? 'animate-spin' : ''}`} />
                Fetch Fresh Stats
              </Button>
            )}
            {isLiveMode && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={loading}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button
                  variant={autoRefresh ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleAutoRefresh}
                >
                  <Activity className="w-4 h-4 mr-2" />
                  {autoRefresh ? 'Live (WebSocket)' : 'Manual'}
                </Button>
                {autoRefresh && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
                    <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-success animate-pulse' : 'bg-warning'}`} />
                    <span className="text-xs font-medium">
                      {wsConnected ? 'Connected' : 'Connecting...'}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Info Banner for Saved Stats Mode */}
        {!isLiveMode && !stats && !loading && (
          <div className="mb-6 bg-gradient-to-r from-primary/10 to-info/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/20 p-2">
                <Info className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                  Viewing Saved Statistics
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {connectionDetails?.password 
                    ? 'Click "Fetch Fresh Stats" to connect and get real-time data'
                    : 'No saved stats available yet. Connect via Terminal to collect server stats.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Password Input for Fresh Fetch */}
        {needsPassword && (
          <div className="mb-6 bg-warning/10 border border-warning/20 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-3">
                <p className="text-sm font-medium text-foreground">Password Required</p>
                <p className="text-xs text-muted-foreground">
                  This connection requires a password to fetch fresh stats.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="Enter password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && fetchFreshStats()}
                    className="flex-1"
                  />
                  <Button onClick={fetchFreshStats} disabled={!password || fetchingFresh}>
                    {fetchingFresh ? 'Connecting...' : 'Connect'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && !needsPassword ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-destructive mb-4">{error}</p>
              {!isLiveMode && connectionDetails?.password && (
                <Button onClick={fetchFreshStats} disabled={fetchingFresh}>
                  {fetchingFresh ? 'Fetching...' : 'Fetch Fresh Stats'}
                </Button>
              )}
              {isLiveMode && (
                <Button onClick={handleRefresh}>Try Again</Button>
              )}
            </div>
          </div>
        ) : stats ? (
          <div className="space-y-6 max-w-7xl mx-auto">
            {/* Show data age for saved stats */}
            {!isLiveMode && stats.timestamp && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Activity className="w-4 h-4" />
                Last updated: {new Date(stats.timestamp).toLocaleString()}
              </div>
            )}

            {/* Metrics */}
            <ServerMetrics stats={stats} />

            {/* System Info & Uptime */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SystemInfo stats={stats} />
              <UptimeDisplay stats={stats} />
            </div>

            {/* Network Interfaces */}
            <NetworkInterfaces stats={stats} />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Loading server statistics...</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
