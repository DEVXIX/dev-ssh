import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectionsAPI } from '../services/api';
import type { Connection } from '../../types';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Label } from '@/frontend/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/frontend/components/ui/select';
import { Card } from '@/frontend/components/ui/card';
import { Checkbox } from '@/frontend/components/ui/checkbox';
import { Server, Terminal, FolderOpen, Cable, Edit2, Trash2, Plus, Search, X, Activity, Info, Monitor } from 'lucide-react';

export default function Connections() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    type: 'ssh' as 'ssh' | 'ftp' | 'database' | 'rdp',
    host: '',
    port: 22,
    username: '',
    authType: 'password' as 'password' | 'key' | 'none',
    password: '',
    privateKey: '',
    passphrase: '',
    enableTerminal: true,
    enableFileManager: true,
    enableTunneling: true,
    defaultPath: '/',
    tags: [] as string[],
    folder: '',
    databaseType: 'mysql' as 'mysql' | 'postgresql' | 'sqlite' | 'mariadb' | 'mssql' | 'oracle',
    database: '',
    ssl: false,
    // RDP-specific fields
    domain: '',
    rdpSecurity: 'any' as 'any' | 'nla' | 'tls' | 'rdp',
    rdpWidth: 1280,
    rdpHeight: 720,
    rdpColorDepth: 24 as 15 | 16 | 24 | 32,
    rdpAudio: false,
    rdpClipboard: true,
    rdpDrives: false,
  });

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      setLoading(true);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (editingConnection) {
        await connectionsAPI.update(editingConnection.id, formData);
      } else {
        await connectionsAPI.create(formData);
      }
      
      await loadConnections();
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save connection');
    }
  };

  const handleEdit = (connection: Connection) => {
    setEditingConnection(connection);
    setFormData({
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.authType,
      password: connection.password || '',
      privateKey: connection.privateKey || '',
      passphrase: connection.passphrase || '',
      enableTerminal: connection.enableTerminal || true,
      enableFileManager: connection.enableFileManager || true,
      enableTunneling: connection.enableTunneling || true,
      defaultPath: connection.defaultPath || '/',
      tags: connection.tags || [],
      folder: connection.folder || '',
      databaseType: connection.databaseType || 'mysql',
      database: connection.database || '',
      ssl: connection.ssl || false,
      // RDP fields
      domain: connection.domain || '',
      rdpSecurity: connection.rdpSecurity || 'any',
      rdpWidth: connection.rdpWidth || 1280,
      rdpHeight: connection.rdpHeight || 720,
      rdpColorDepth: connection.rdpColorDepth || 24,
      rdpAudio: connection.rdpAudio || false,
      rdpClipboard: connection.rdpClipboard !== false,
      rdpDrives: connection.rdpDrives || false,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this connection?')) {
      return;
    }

    try {
      await connectionsAPI.delete(id);
      await loadConnections();
    } catch (error) {
      console.error('Failed to delete connection:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'ssh',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKey: '',
      passphrase: '',
      enableTerminal: true,
      enableFileManager: true,
      enableTunneling: true,
      defaultPath: '/',
      tags: [],
      folder: '',
      databaseType: 'mysql',
      database: '',
      ssl: false,
      // RDP fields
      domain: '',
      rdpSecurity: 'any',
      rdpWidth: 1280,
      rdpHeight: 720,
      rdpColorDepth: 24,
      rdpAudio: false,
      rdpClipboard: true,
      rdpDrives: false,
    });
    setEditingConnection(null);
    setError('');
  };

  const handleTypeChange = (type: 'ssh' | 'ftp' | 'database' | 'rdp') => {
    const defaultPorts = {
      ssh: 22,
      ftp: 21,
      database: 3306, // MySQL default
      rdp: 3389,
    };

    setFormData({
      ...formData,
      type,
      port: defaultPorts[type],
      enableTerminal: type === 'ssh',
      enableTunneling: type === 'ssh',
      enableFileManager: type !== 'database' && type !== 'rdp',
    });
  };

  const handleDatabaseTypeChange = (databaseType: 'mysql' | 'postgresql' | 'sqlite' | 'mariadb' | 'mssql' | 'oracle') => {
    const defaultPorts = {
      mysql: 3306,
      mariadb: 3306,
      postgresql: 5432,
      sqlite: 0,
      mssql: 1433,
      oracle: 1521,
    };

    setFormData({
      ...formData,
      databaseType,
      port: defaultPorts[databaseType],
    });
  };

  const filteredConnections = connections.filter(
    (conn) =>
      conn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conn.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conn.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Connection Manager</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage your SSH, FTP, and Database connections</p>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Connection
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-6">
        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search connections..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Server Stats Info Banner */}
        {filteredConnections.length > 0 && (
          <div className="mb-6 bg-gradient-to-r from-primary/10 to-success/10 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/20 p-2">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  View Real-Time Server Stats
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Connect via <strong>Terminal</strong>, then click <strong>"Server Stats"</strong> to monitor CPU, memory, disk, and network in real-time
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Connection Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto border-border shadow-2xl">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-foreground">
                    {editingConnection ? 'Edit Connection' : 'New Connection'}
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setShowForm(false);
                      resetForm();
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {error && (
                  <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Basic Info */}
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Connection Name</Label>
                        <Input
                          id="name"
                          required
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          placeholder="Production Server"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="type">Connection Type</Label>
                        <Select value={formData.type} onValueChange={(val) => handleTypeChange(val as 'ssh' | 'ftp' | 'database' | 'rdp')}>
                          <SelectTrigger id="type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ssh">SSH</SelectItem>
                            <SelectItem value="ftp">FTP</SelectItem>
                            <SelectItem value="database">Database</SelectItem>
                            <SelectItem value="rdp">RDP (Remote Desktop)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Database Type Selector (only for database connections) */}
                      {formData.type === 'database' && (
                        <div className="space-y-2">
                          <Label htmlFor="databaseType">Database Type</Label>
                          <Select value={formData.databaseType} onValueChange={(val) => handleDatabaseTypeChange(val as any)}>
                            <SelectTrigger id="databaseType">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="mysql">MySQL</SelectItem>
                              <SelectItem value="mariadb">MariaDB</SelectItem>
                              <SelectItem value="postgresql">PostgreSQL</SelectItem>
                              <SelectItem value="sqlite">SQLite</SelectItem>
                              <SelectItem value="mssql">Microsoft SQL Server</SelectItem>
                              <SelectItem value="oracle">Oracle</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="host">Host</Label>
                        <Input
                          id="host"
                          required
                          value={formData.host}
                          onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                          placeholder="example.com or 192.168.1.100"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="port">Port</Label>
                        <Input
                          id="port"
                          type="number"
                          required
                          value={formData.port}
                          onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="username">Username</Label>
                      <Input
                        id="username"
                        required
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        placeholder="root"
                      />
                    </div>
                  </div>

                  {/* Authentication */}
                  <div className="space-y-4 pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-foreground">Authentication</h3>

                    <div className="space-y-2">
                      <Label htmlFor="authType">Authentication Method</Label>
                      <Select
                        value={formData.authType}
                        onValueChange={(val) => setFormData({ ...formData, authType: val as any })}
                      >
                        <SelectTrigger id="authType">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="password">Password</SelectItem>
                          {formData.type === 'ssh' && <SelectItem value="key">SSH Key</SelectItem>}
                          {formData.type === 'ssh' && <SelectItem value="none">Prompt on Connect</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>

                    {formData.authType === 'password' && (
                      <div className="space-y-2">
                        <Label htmlFor="password">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                          placeholder="Leave blank to prompt on connect"
                        />
                      </div>
                    )}

                    {formData.authType === 'key' && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="privateKey">Private Key</Label>
                          <textarea
                            id="privateKey"
                            value={formData.privateKey}
                            onChange={(e) => setFormData({ ...formData, privateKey: e.target.value })}
                            className="w-full min-h-[120px] px-3 py-2 bg-background border border-input rounded-md text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="-----BEGIN RSA PRIVATE KEY-----"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="passphrase">Passphrase (optional)</Label>
                          <Input
                            id="passphrase"
                            type="password"
                            value={formData.passphrase}
                            onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Database-specific fields */}
                  {formData.type === 'database' && (
                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-medium text-foreground">Database Settings</h3>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="database">Database Name {formData.databaseType !== 'sqlite' && <span className="text-muted-foreground">(Optional)</span>}</Label>
                          <Input
                            id="database"
                            value={formData.database}
                            onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                            placeholder={formData.databaseType === 'sqlite' ? 'Path to .db file or :memory:' : 'Database name to connect to'}
                          />
                        </div>

                        {formData.databaseType !== 'sqlite' && (
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="ssl"
                              checked={formData.ssl}
                              onCheckedChange={(checked) => setFormData({ ...formData, ssl: !!checked })}
                            />
                            <Label htmlFor="ssl" className="font-normal cursor-pointer">
                              Use SSL/TLS Connection
                            </Label>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* RDP-specific fields */}
                  {formData.type === 'rdp' && (
                    <div className="space-y-4 pt-4 border-t border-border">
                      <h3 className="text-sm font-medium text-foreground">RDP Settings</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="domain">Domain (Optional)</Label>
                          <Input
                            id="domain"
                            value={formData.domain}
                            onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                            placeholder="WORKGROUP"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rdpSecurity">Security Protocol</Label>
                          <Select value={formData.rdpSecurity} onValueChange={(val) => setFormData({ ...formData, rdpSecurity: val as any })}>
                            <SelectTrigger id="rdpSecurity">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Auto-detect</SelectItem>
                              <SelectItem value="nla">NLA (Network Level Auth)</SelectItem>
                              <SelectItem value="tls">TLS</SelectItem>
                              <SelectItem value="rdp">RDP Security</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="rdpWidth">Width</Label>
                          <Input
                            id="rdpWidth"
                            type="number"
                            value={formData.rdpWidth}
                            onChange={(e) => setFormData({ ...formData, rdpWidth: parseInt(e.target.value) || 1280 })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rdpHeight">Height</Label>
                          <Input
                            id="rdpHeight"
                            type="number"
                            value={formData.rdpHeight}
                            onChange={(e) => setFormData({ ...formData, rdpHeight: parseInt(e.target.value) || 720 })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="rdpColorDepth">Color Depth</Label>
                          <Select value={formData.rdpColorDepth.toString()} onValueChange={(val) => setFormData({ ...formData, rdpColorDepth: parseInt(val) as any })}>
                            <SelectTrigger id="rdpColorDepth">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="15">15-bit</SelectItem>
                              <SelectItem value="16">16-bit</SelectItem>
                              <SelectItem value="24">24-bit</SelectItem>
                              <SelectItem value="32">32-bit</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="rdpClipboard"
                            checked={formData.rdpClipboard}
                            onCheckedChange={(checked) => setFormData({ ...formData, rdpClipboard: !!checked })}
                          />
                          <Label htmlFor="rdpClipboard" className="font-normal cursor-pointer">
                            Enable Clipboard Sharing
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="rdpAudio"
                            checked={formData.rdpAudio}
                            onCheckedChange={(checked) => setFormData({ ...formData, rdpAudio: !!checked })}
                          />
                          <Label htmlFor="rdpAudio" className="font-normal cursor-pointer">
                            Enable Audio Redirection
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="rdpDrives"
                            checked={formData.rdpDrives}
                            onCheckedChange={(checked) => setFormData({ ...formData, rdpDrives: !!checked })}
                          />
                          <Label htmlFor="rdpDrives" className="font-normal cursor-pointer">
                            Enable Drive Redirection
                          </Label>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Features */}
                  {formData.type !== 'rdp' && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-foreground">Enabled Features</h3>
                    <div className="space-y-3">
                      {formData.type === 'ssh' && (
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="enableTerminal"
                            checked={formData.enableTerminal}
                            onCheckedChange={(checked) => setFormData({ ...formData, enableTerminal: !!checked })}
                          />
                          <Label htmlFor="enableTerminal" className="font-normal cursor-pointer">
                            SSH Terminal Access
                          </Label>
                        </div>
                      )}
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="enableFileManager"
                          checked={formData.enableFileManager}
                          onCheckedChange={(checked) => setFormData({ ...formData, enableFileManager: !!checked })}
                        />
                        <Label htmlFor="enableFileManager" className="font-normal cursor-pointer">
                          File Manager
                        </Label>
                      </div>
                      {formData.type === 'ssh' && (
                        <div className="flex items-center space-x-2">
                          <Checkbox
                            id="enableTunneling"
                            checked={formData.enableTunneling}
                            onCheckedChange={(checked) => setFormData({ ...formData, enableTunneling: !!checked })}
                          />
                          <Label htmlFor="enableTunneling" className="font-normal cursor-pointer">
                            SSH Tunneling
                          </Label>
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="defaultPath">Default Path</Label>
                    <Input
                      id="defaultPath"
                      value={formData.defaultPath}
                      onChange={(e) => setFormData({ ...formData, defaultPath: e.target.value })}
                      placeholder="/"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowForm(false);
                        resetForm();
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit">{editingConnection ? 'Update Connection' : 'Create Connection'}</Button>
                  </div>
                </form>
              </div>
            </Card>
          </div>
        )}

        {/* Connections Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">Loading connections...</p>
          </div>
        ) : filteredConnections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {searchQuery ? 'No connections found' : 'No connections yet'}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm text-center">
              {searchQuery ? 'Try adjusting your search query' : 'Get started by adding your first server connection'}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => {
                  resetForm();
                  setShowForm(true);
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Your First Connection
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredConnections.map((connection) => {
              const enableTerminal = connection.enableTerminal ?? true;
              const enableFileManager = connection.enableFileManager ?? true;
              const enableTunneling = connection.enableTunneling ?? true;

              return (
                <Card key={connection.id} className="p-5 hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-primary/10">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`rounded-lg p-2.5 ${
                          connection.type === 'ssh' ? 'bg-blue-500/10' :
                          connection.type === 'rdp' ? 'bg-purple-500/10' :
                          'bg-green-500/10'
                        }`}
                      >
                        {connection.type === 'rdp' ? (
                          <Monitor className={`h-5 w-5 text-purple-500`} />
                        ) : (
                          <Server
                            className={`h-5 w-5 ${connection.type === 'ssh' ? 'text-blue-500' : 'text-green-500'}`}
                          />
                        )}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">{connection.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {connection.username}@{connection.host}:{connection.port}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                        connection.type === 'ssh' ? 'bg-blue-500/10 text-blue-400' :
                        connection.type === 'rdp' ? 'bg-purple-500/10 text-purple-400' :
                        'bg-green-500/10 text-green-400'
                      }`}
                    >
                      {connection.type.toUpperCase()}
                    </span>
                  </div>

                  {/* Feature badges */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {enableTerminal && connection.type === 'ssh' && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
                        <Terminal className="h-3 w-3" />
                        Terminal
                      </span>
                    )}
                    {connection.type === 'rdp' && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
                        <Monitor className="h-3 w-3" />
                        Remote Desktop
                      </span>
                    )}
                    {enableFileManager && connection.type !== 'rdp' && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
                        <FolderOpen className="h-3 w-3" />
                        Files
                      </span>
                    )}
                    {enableTunneling && connection.type === 'ssh' && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
                        <Cable className="h-3 w-3" />
                        Tunnels
                      </span>
                    )}
                  </div>

                  {/* Connect Actions */}
                  <div className="space-y-2 mb-3">
                    {enableTerminal && connection.type === 'ssh' && (
                      <Button
                        onClick={() => navigate(`/terminal/${connection.id}`)}
                        className="w-full gap-2 bg-blue-600 hover:bg-blue-700"
                        size="sm"
                      >
                        <Terminal className="h-3.5 w-3.5" />
                        Open Terminal
                      </Button>
                    )}
                    {connection.type === 'database' && (
                      <Button
                        onClick={() => navigate(`/database/${connection.id}`)}
                        className="w-full gap-2 bg-green-600 hover:bg-green-700"
                        size="sm"
                      >
                        <Server className="h-3.5 w-3.5" />
                        Open Database
                      </Button>
                    )}
                    {connection.type === 'rdp' && (
                      <Button
                        onClick={() => navigate(`/rdp/${connection.id}`)}
                        className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
                        size="sm"
                      >
                        <Monitor className="h-3.5 w-3.5" />
                        Open Remote Desktop
                      </Button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {enableFileManager && connection.type !== 'rdp' && (
                        <Button
                          onClick={() => navigate(`/files/${connection.id}`)}
                          variant="outline"
                          className="gap-2"
                          size="sm"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          Files
                        </Button>
                      )}
                      {enableTunneling && connection.type === 'ssh' && (
                        <Button
                          onClick={() => navigate(`/tunnels/${connection.id}`)}
                          variant="outline"
                          className="gap-2"
                          size="sm"
                        >
                          <Cable className="h-3.5 w-3.5" />
                          Tunnels
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Management Actions */}
                  <div className="flex gap-2 pt-3 border-t border-border">
                    <Button
                      onClick={() => navigate(`/server/${connection.id}`)}
                      variant="ghost"
                      size="sm"
                      className="flex-1 gap-2 text-xs"
                    >
                      <Activity className="h-3 w-3" />
                      Stats
                    </Button>
                    <Button
                      onClick={() => handleEdit(connection)}
                      variant="ghost"
                      size="sm"
                      className="flex-1 gap-2 text-xs"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      onClick={() => handleDelete(connection.id)}
                      variant="ghost"
                      size="sm"
                      className="flex-1 gap-2 text-xs text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
