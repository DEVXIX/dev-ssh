import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { connectionsAPI } from '../services/api';
import { Activity, Terminal, Info } from 'lucide-react';
import type { Connection } from '../../types';

export default function Dashboard() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const response = await connectionsAPI.getAll();
      if (response.data.success) {
        setConnections(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load connections:', error);
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    total: connections.length,
    ssh: connections.filter(c => c.type === 'ssh').length,
    ftp: connections.filter(c => c.type === 'ftp').length,
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-dark-lighter border border-dark-border rounded-lg p-6">
          <h3 className="text-gray-400 text-sm font-medium mb-2">Total Connections</h3>
          <p className="text-3xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="bg-dark-lighter border border-dark-border rounded-lg p-6">
          <h3 className="text-gray-400 text-sm font-medium mb-2">SSH Connections</h3>
          <p className="text-3xl font-bold text-blue-400">{stats.ssh}</p>
        </div>
        <div className="bg-dark-lighter border border-dark-border rounded-lg p-6">
          <h3 className="text-gray-400 text-sm font-medium mb-2">FTP Connections</h3>
          <p className="text-3xl font-bold text-green-400">{stats.ftp}</p>
        </div>
      </div>

      {/* Server Stats Info */}
      <div className="bg-gradient-to-r from-primary/10 to-success/10 border border-primary/20 rounded-lg p-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-primary/20 p-3">
            <Activity className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
              <Info className="h-5 w-5" />
              How to View Server Stats
            </h3>
            <p className="text-gray-300 mb-3">
              Monitor real-time server metrics including CPU, memory, disk usage, and network information.
            </p>
            <ol className="space-y-2 text-sm text-gray-400">
              <li className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold">1</span>
                <span>Click <strong className="text-white">"Open Terminal"</strong> on any SSH connection below</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold">2</span>
                <span>Wait for the SSH connection to establish</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold">3</span>
                <span>Click the <strong className="text-white">"Server Stats"</strong> button in the terminal header</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold">4</span>
                <span>View live metrics updated every 5 seconds via WebSocket</span>
              </li>
            </ol>
            <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
              <Terminal className="h-4 w-4" />
              <span>Stats are collected from the remote server via SSH commands</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Connections */}
      <div className="bg-dark-lighter border border-dark-border rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Recent Connections</h2>
          <Link
            to="/connections"
            className="text-primary hover:text-primary-dark transition"
          >
            View All →
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">Loading...</div>
        ) : connections.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">No connections yet</p>
            <Link
              to="/connections"
              className="inline-block px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded transition"
            >
              Add Connection
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {connections.slice(0, 5).map((conn) => (
              <div
                key={conn.id}
                className="flex items-center justify-between p-4 rounded hover:bg-dark transition"
              >
                <div>
                  <h3 className="text-white font-medium">{conn.name}</h3>
                  <p className="text-sm text-gray-400">
                    {conn.type.toUpperCase()} • {conn.username}@{conn.host}:{conn.port}
                  </p>
                </div>
                <div className="flex gap-2">
                  {conn.enableTerminal && conn.type === 'ssh' && (
                    <Link
                      to={`/terminal/${conn.id}`}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition"
                    >
                      Terminal
                    </Link>
                  )}
                  {conn.enableFileManager && (
                    <Link
                      to={`/files/${conn.id}`}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition"
                    >
                      Files
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
