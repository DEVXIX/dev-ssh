import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspacesAPI, connectionsAPI, storageAPI } from '../services/api';
import type { Workspace, WorkspacePane, WorkspaceLayoutType, Connection, StorageConnection } from '../../types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Card } from '../components/ui/card';
import {
  LayoutGrid,
  Plus,
  Edit2,
  Trash2,
  Play,
  Save,
  X,
  Boxes,
  MonitorPlay,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Grid2x2,
  Columns,
  Rows
} from 'lucide-react';

export default function Workspaces() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [storageConnections, setStorageConnections] = useState<StorageConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');

  // Builder state
  const [builderData, setBuilderData] = useState<{
    name: string;
    description: string;
    layout: WorkspaceLayoutType;
    panes: WorkspacePane[];
  }>({
    name: '',
    description: '',
    layout: 'grid-4',
    panes: [],
  });

  useEffect(() => {
    loadWorkspaces();
    loadConnections();
    loadStorageConnections();
  }, []);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const response = await workspacesAPI.getAll();
      if (response.data.success) {
        setWorkspaces(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadConnections = async () => {
    try {
      const response = await connectionsAPI.getAll();
      if (response.data.success) {
        setConnections(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load connections:', error);
    }
  };

  const loadStorageConnections = async () => {
    try {
      const response = await storageAPI.getAllConnections();
      if (response.data.success) {
        setStorageConnections(response.data.data);
      }
    } catch (error) {
      console.error('Failed to load storage connections:', error);
    }
  };

  const getLayoutPaneCount = (layout: WorkspaceLayoutType): number => {
    switch (layout) {
      case 'single': return 1;
      case 'horizontal-2':
      case 'vertical-2': return 2;
      case 'main-vertical':
      case 'main-horizontal': return 3;
      case 'grid-4': return 4;
      default: return 1;
    }
  };

  const initializePanes = (layout: WorkspaceLayoutType): WorkspacePane[] => {
    const count = getLayoutPaneCount(layout);
    return Array.from({ length: count }, (_, i) => ({
      id: `pane_${Date.now()}_${i}`,
      connectionId: null,
      storageConnectionId: null,
      paneType: 'terminal' as const,
      name: `Pane ${i + 1}`,
      commands: [],
      defaultPath: '/',
    }));
  };

  const handleLayoutChange = (layout: WorkspaceLayoutType) => {
    setBuilderData({
      ...builderData,
      layout,
      panes: initializePanes(layout),
    });
  };

  const openBuilder = (workspace?: Workspace) => {
    if (workspace) {
      setEditingWorkspace(workspace);
      setBuilderData({
        name: workspace.name,
        description: workspace.description || '',
        layout: workspace.layout,
        panes: workspace.panes,
      });
    } else {
      setEditingWorkspace(null);
      setBuilderData({
        name: '',
        description: '',
        layout: 'grid-4',
        panes: initializePanes('grid-4'),
      });
    }
    setShowBuilder(true);
  };

  const closeBuilder = () => {
    setShowBuilder(false);
    setEditingWorkspace(null);
    setError('');
  };

  const handleSaveWorkspace = async () => {
    try {
      if (!builderData.name) {
        setError('Workspace name is required');
        return;
      }

      const data = {
        name: builderData.name,
        description: builderData.description,
        layout: builderData.layout,
        panes: builderData.panes,
      };

      if (editingWorkspace) {
        await workspacesAPI.update(editingWorkspace.id, data);
      } else {
        await workspacesAPI.create(data);
      }

      await loadWorkspaces();
      closeBuilder();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save workspace');
    }
  };

  const handleDeleteWorkspace = async (id: number) => {
    if (!confirm('Are you sure you want to delete this workspace?')) return;

    try {
      await workspacesAPI.delete(id);
      await loadWorkspaces();
    } catch (error) {
      console.error('Failed to delete workspace:', error);
    }
  };

  const handleLaunchWorkspace = (workspace: Workspace) => {
    // Navigate to a new workspace launcher route with workspace data
    navigate(`/workspace/${workspace.id}`);
  };

  const updatePane = (paneId: string, updates: Partial<WorkspacePane>) => {
    setBuilderData({
      ...builderData,
      panes: builderData.panes.map(p =>
        p.id === paneId ? { ...p, ...updates } : p
      ),
    });
  };

  const getLayoutIcon = (layout: WorkspaceLayoutType) => {
    switch (layout) {
      case 'single': return <MonitorPlay className="h-5 w-5" />;
      case 'horizontal-2': return <SplitSquareHorizontal className="h-5 w-5" />;
      case 'vertical-2': return <SplitSquareVertical className="h-5 w-5" />;
      case 'main-vertical': return <Columns className="h-5 w-5" />;
      case 'main-horizontal': return <Rows className="h-5 w-5" />;
      case 'grid-4': return <Grid2x2 className="h-5 w-5" />;
    }
  };

  const getLayoutName = (layout: WorkspaceLayoutType) => {
    switch (layout) {
      case 'single': return 'Single Pane';
      case 'horizontal-2': return '2 Panes (Horizontal)';
      case 'vertical-2': return '2 Panes (Vertical)';
      case 'main-vertical': return 'Main + 2 Side';
      case 'main-horizontal': return 'Main + 2 Bottom';
      case 'grid-4': return '4 Panes (Grid)';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Workspaces</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Create and manage multi-server layouts
              </p>
            </div>
            <Button onClick={() => openBuilder()} className="gap-2">
              <Plus className="h-4 w-4" />
              New Workspace
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-6">
        {/* Workspace Builder Modal */}
        {showBuilder && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <Card className="max-w-4xl w-full max-h-[90vh] overflow-y-auto border-border shadow-2xl">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-semibold text-foreground">
                    {editingWorkspace ? 'Edit Workspace' : 'Create Workspace'}
                  </h2>
                  <Button variant="ghost" size="icon" onClick={closeBuilder}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {error && (
                  <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-lg mb-4 text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-6">
                  {/* Workspace Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Workspace Name *</Label>
                      <Input
                        id="name"
                        required
                        value={builderData.name}
                        onChange={(e) => setBuilderData({ ...builderData, name: e.target.value })}
                        placeholder="DevOps Dashboard"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Input
                        id="description"
                        value={builderData.description}
                        onChange={(e) => setBuilderData({ ...builderData, description: e.target.value })}
                        placeholder="Production monitoring setup"
                      />
                    </div>
                  </div>

                  {/* Layout Selection */}
                  <div className="space-y-3">
                    <Label>Layout Template</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {(['single', 'horizontal-2', 'vertical-2', 'main-vertical', 'main-horizontal', 'grid-4'] as WorkspaceLayoutType[]).map((layout) => (
                        <button
                          key={layout}
                          type="button"
                          onClick={() => handleLayoutChange(layout)}
                          className={`p-4 rounded-lg border-2 transition-all ${
                            builderData.layout === layout
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="flex flex-col items-center gap-2">
                            {getLayoutIcon(layout)}
                            <span className="text-xs font-medium">{getLayoutName(layout)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Pane Configuration */}
                  <div className="space-y-3">
                    <Label>Configure Panes</Label>
                    <div className="grid grid-cols-2 gap-4">
                      {builderData.panes.map((pane, index) => (
                        <Card key={pane.id} className="p-4 bg-card/50">
                          <h3 className="text-sm font-semibold mb-3">Pane {index + 1}</h3>
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label className="text-xs">Pane Name</Label>
                              <Input
                                value={pane.name}
                                onChange={(e) => updatePane(pane.id, { name: e.target.value })}
                                className="h-8 text-sm"
                                placeholder="Production Server"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Pane Type</Label>
                              <Select
                                value={pane.paneType || 'terminal'}
                                onValueChange={(val: 'terminal' | 'database' | 'storage') => {
                                  updatePane(pane.id, {
                                    paneType: val,
                                    connectionId: null,
                                    storageConnectionId: null
                                  });
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="terminal">Terminal</SelectItem>
                                  <SelectItem value="database">Database</SelectItem>
                                  <SelectItem value="storage">Storage</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {pane.paneType === 'storage' ? (
                              <div className="space-y-2">
                                <Label className="text-xs">Storage Connection</Label>
                                <Select
                                  value={pane.storageConnectionId?.toString() || 'none'}
                                  onValueChange={(val) => updatePane(pane.id, { storageConnectionId: val === 'none' ? null : parseInt(val) })}
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue placeholder="Select storage..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No storage</SelectItem>
                                    {storageConnections.map(conn => (
                                      <SelectItem key={conn.id} value={conn.id.toString()}>
                                        {conn.name} ({conn.endpoint})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <Label className="text-xs">Server Connection</Label>
                                <Select
                                  value={pane.connectionId?.toString() || 'none'}
                                  onValueChange={(val) => updatePane(pane.id, { connectionId: val === 'none' ? null : parseInt(val) })}
                                >
                                  <SelectTrigger className="h-8 text-sm">
                                    <SelectValue placeholder="Select server..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No connection</SelectItem>
                                    {connections.map(conn => (
                                      <SelectItem key={conn.id} value={conn.id.toString()}>
                                        {conn.name} ({conn.host})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label className="text-xs">Auto Commands (one per line)</Label>
                              <textarea
                                value={(pane.commands || []).join('\n')}
                                onChange={(e) => updatePane(pane.id, { commands: e.target.value.split('\n').filter(c => c.trim()) })}
                                className="w-full min-h-[60px] px-3 py-2 bg-background border border-input rounded-md text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                                placeholder="htop&#10;cd /var/log&#10;tail -f app.log"
                              />
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <Button type="button" variant="outline" onClick={closeBuilder}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveWorkspace} className="gap-2">
                      <Save className="h-4 w-4" />
                      {editingWorkspace ? 'Update Workspace' : 'Create Workspace'}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Workspaces List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">Loading workspaces...</p>
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="rounded-full bg-muted p-4 mb-4">
              <Boxes className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">No workspaces yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm text-center">
              Create your first workspace to manage multiple server sessions
            </p>
            <Button onClick={() => openBuilder()} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Your First Workspace
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workspaces.map((workspace) => (
              <Card key={workspace.id} className="p-5 hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-primary/10">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg p-2.5 bg-primary/10">
                      {getLayoutIcon(workspace.layout)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{workspace.name}</h3>
                      {workspace.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{workspace.description}</p>
                      )}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary">
                    {workspace.panes.length} {workspace.panes.length === 1 ? 'Pane' : 'Panes'}
                  </span>
                </div>

                {/* Panes Preview */}
                <div className="space-y-2 mb-4">
                  <p className="text-xs font-medium text-muted-foreground">{getLayoutName(workspace.layout)}</p>
                  <div className="flex flex-col gap-1">
                    {workspace.panes.slice(0, 3).map((pane, index) => {
                      const conn = connections.find(c => c.id === pane.connectionId);
                      const storageConn = storageConnections.find(c => c.id === pane.storageConnectionId);
                      const displayConn = pane.paneType === 'storage' ? storageConn : conn;
                      return (
                        <div key={pane.id} className="text-xs px-2 py-1 bg-muted rounded flex items-center justify-between">
                          <span className="font-medium">{pane.name} <span className="text-muted-foreground">({pane.paneType})</span></span>
                          {displayConn && (
                            <span className="text-muted-foreground">→ {displayConn.name}</span>
                          )}
                        </div>
                      );
                    })}
                    {workspace.panes.length > 3 && (
                      <span className="text-xs text-muted-foreground px-2">+{workspace.panes.length - 3} more</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <Button
                    onClick={() => handleLaunchWorkspace(workspace)}
                    className="w-full gap-2 bg-primary hover:bg-primary/90"
                    size="sm"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Launch Workspace
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => openBuilder(workspace)}
                      variant="outline"
                      size="sm"
                      className="gap-2"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      onClick={() => handleDeleteWorkspace(workspace.id)}
                      variant="outline"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
