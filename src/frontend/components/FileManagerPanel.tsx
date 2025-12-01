import { useState, useEffect } from 'react';
import { filesAPI } from '../services/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import {
  Folder,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Home,
  Upload,
  Download,
  Edit2,
  Trash2,
  FolderPlus,
  FilePlus,
  Eye,
  Search,
  MoreVertical,
} from 'lucide-react';
import { FileItem } from '../../types';
import { toast } from 'sonner';

interface FileManagerPanelProps {
  sessionId: string;
  connectionType: 'ssh' | 'ftp';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  } catch {
    return dateString;
  }
}

function getFileIcon(file: FileItem): JSX.Element {
  const iconClass = 'w-4 h-4';

  if (file.type === 'directory') {
    return <Folder className={`${iconClass} text-blue-400`} />;
  }

  const ext = file.name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'txt':
    case 'md':
    case 'log':
      return <FileText className={`${iconClass} text-gray-400`} />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
      return <FileImage className={`${iconClass} text-green-400`} />;
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'mkv':
      return <FileVideo className={`${iconClass} text-purple-400`} />;
    case 'mp3':
    case 'wav':
    case 'flac':
      return <FileAudio className={`${iconClass} text-yellow-400`} />;
    default:
      return <File className={`${iconClass} text-gray-400`} />;
  }
}

export function FileManagerPanel({ sessionId, connectionType }: FileManagerPanelProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath, sessionId]);

  const loadFiles = async (path: string) => {
    try {
      setLoading(true);
      const response = await filesAPI.list(sessionId, path, connectionType);

      if (response.data.success) {
        setFiles(response.data.data || []);
      } else {
        toast.error('Failed to load files: ' + (response.data.error || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Failed to load files:', error);
      toast.error('Failed to load files: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (path: string) => {
    // Add to history
    const newHistory = pathHistory.slice(0, historyIndex + 1);
    newHistory.push(path);
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(path);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentPath(pathHistory[newIndex]);
    }
  };

  const handleForward = () => {
    if (historyIndex < pathHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentPath(pathHistory[newIndex]);
    }
  };

  const handleFileClick = (file: FileItem) => {
    if (file.type === 'directory') {
      navigateTo(file.path);
    } else {
      setSelectedFile(file);
    }
  };

  const handleFileDoubleClick = async (file: FileItem) => {
    if (file.type === 'file') {
      // Open file viewer/editor in a modal or new window
      toast.info(`Opening ${file.name}...`);
      // TODO: Implement file viewer
    }
  };

  const handleRefresh = () => {
    loadFiles(currentPath);
  };

  const handleGoHome = () => {
    navigateTo('/');
  };

  const handleGoUp = () => {
    if (currentPath !== '/') {
      const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
      navigateTo(parentPath);
    }
  };

  const handleDelete = async (file: FileItem) => {
    if (!confirm(`Are you sure you want to delete ${file.name}?`)) {
      return;
    }

    try {
      const response = await filesAPI.delete(
        sessionId,
        file.path,
        file.type === 'directory',
        connectionType
      );

      if (response.data.success) {
        toast.success(`Deleted ${file.name}`);
        loadFiles(currentPath);
      } else {
        toast.error('Failed to delete: ' + (response.data.error || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Failed to delete:', error);
      toast.error('Failed to delete: ' + (error.message || 'Unknown error'));
    }
  };

  const handleDownload = async (file: FileItem) => {
    try {
      // Read the file content
      const response = await filesAPI.read(sessionId, file.path, connectionType);

      if (response.data.success) {
        const content = response.data.data.content || '';

        // Create a blob and download
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toast.success(`Downloaded ${file.name}`);
      } else {
        toast.error('Failed to download: ' + (response.data.error || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Failed to download:', error);
      toast.error('Failed to download: ' + (error.message || 'Unknown error'));
    }
  };

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="flex items-center gap-1">
          <Button
            onClick={handleBack}
            disabled={historyIndex === 0}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleForward}
            disabled={historyIndex >= pathHistory.length - 1}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleGoUp}
            disabled={currentPath === '/'}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <Button
            onClick={handleGoHome}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <Home className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleRefresh}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Path bar */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <span className="text-xs text-muted-foreground">Path:</span>
        <Input
          value={currentPath}
          onChange={(e) => navigateTo(e.target.value)}
          className="h-7 text-xs font-mono"
          placeholder="/path/to/directory"
        />
      </div>

      {/* Search bar */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="h-7 pl-8 text-xs"
          />
        </div>
      </div>

      {/* File list */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Folder className="h-12 w-12 mb-2 opacity-50" />
              <p className="text-sm">
                {searchQuery ? 'No files found' : 'Empty directory'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredFiles.map((file) => (
                <div
                  key={file.path}
                  onClick={() => handleFileClick(file)}
                  onDoubleClick={() => handleFileDoubleClick(file)}
                  className={`
                    flex items-center gap-2 p-2 rounded cursor-pointer text-sm
                    hover:bg-accent transition-colors
                    ${selectedFile?.path === file.path ? 'bg-accent' : ''}
                  `}
                >
                  {getFileIcon(file)}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {file.type !== 'directory' && (
                        <span>{formatFileSize(file.size)}</span>
                      )}
                      <span>{file.permissions}</span>
                    </div>
                  </div>
                  {file.type === 'file' && (
                    <div className="flex items-center gap-1">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(file);
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(file);
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Status bar */}
      <div className="border-t border-border p-2">
        <div className="text-xs text-muted-foreground">
          {filteredFiles.length} {filteredFiles.length === 1 ? 'item' : 'items'}
        </div>
      </div>
    </div>
  );
}
