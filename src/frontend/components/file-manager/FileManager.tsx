import { useState, useEffect, createContext, useContext } from 'react';
import { filesAPI } from '@/frontend/services/api';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { ScrollArea } from '@/frontend/components/ui/scroll-area';
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
  Trash2,
  Search,
  Eye,
  FolderPlus,
  FilePlus,
} from 'lucide-react';
import { FileItem } from '@/types';
import { toast } from 'sonner';
import { WindowManager, useWindowManager } from './components/WindowManager';
import { DraggableWindow } from './components/DraggableWindow';

// Context for file editing
interface FileEditorContextType {
  editingFile: FileItem | null;
  editContent: string;
  isSaving: boolean;
  openFileInEditor: (file: FileItem, content: string) => void;
  updateContent: (content: string) => void;
  saveFile: () => Promise<void>;
  closeEditor: () => void;
}

const FileEditorContext = createContext<FileEditorContextType | null>(null);

export const useFileEditor = () => {
  const context = useContext(FileEditorContext);
  if (!context) {
    throw new Error('useFileEditor must be used within FileEditorProvider');
  }
  return context;
};

interface FileManagerProps {
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

function FileManagerContent({ sessionId, connectionType }: FileManagerProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pathHistory, setPathHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [viewingFile, setViewingFile] = useState<FileItem | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  const { openWindow, closeWindow } = useWindowManager();
  const fileEditor = useFileEditor();

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
    const newHistory = pathHistory.slice(0, historyIndex + 1);
    newHistory.push(path);
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(path);
    setPathInput(path);
  };

  const handlePathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigateTo(pathInput);
    } else if (e.key === 'Escape') {
      setPathInput(currentPath);
    }
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      const newPath = pathHistory[newIndex];
      setCurrentPath(newPath);
      setPathInput(newPath);
    }
  };

  const handleForward = () => {
    if (historyIndex < pathHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      const newPath = pathHistory[newIndex];
      setCurrentPath(newPath);
      setPathInput(newPath);
    }
  };

  const handleFileClick = async (file: FileItem) => {
    if (file.type === 'directory') {
      navigateTo(file.path);
    } else {
      setSelectedFile(file);

      // Check if it's a text file and open in editor
      const textExtensions = [
        'txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'conf', 'config',
        'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs',
        'go', 'rs', 'rb', 'php', 'html', 'css', 'scss', 'sass', 'less',
        'sh', 'bash', 'zsh', 'fish', 'env', 'gitignore', 'dockerfile'
      ];

      const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
      const hasNoExt = !file.name.includes('.');
      const isEnvFile = file.name.startsWith('.env') || file.name === '.gitignore' ||
                        file.name === 'Dockerfile' || file.name === 'Makefile';

      if (textExtensions.includes(ext || '') || hasNoExt || isEnvFile) {
        try {
          const response = await filesAPI.read(sessionId, file.path, connectionType);

          if (response.data.success) {
            const content = response.data.data.content || '';
            fileEditor.openFileInEditor(file, content);
          }
        } catch (error: any) {
          toast.error('Failed to open file: ' + (error.message || 'Unknown error'));
        }
      }
    }
  };

  const handleFileDoubleClick = async (file: FileItem) => {
    if (file.type === 'file') {
      try {
        const response = await filesAPI.read(sessionId, file.path, connectionType);

        if (response.data.success) {
          const content = response.data.data.content || '';

          // Open file in floating window
          const windowId = openWindow({
            title: file.name,
            x: 100,
            y: 100,
            width: 800,
            height: 600,
            isMaximized: false,
            isMinimized: false,
            component: (wId: string) => (
              <DraggableWindow
                title={file.name}
                initialX={100}
                initialY={100}
                initialWidth={800}
                initialHeight={600}
                onClose={() => closeWindow(wId)}
                onMaximize={() => {}}
              >
                <div className="h-full flex flex-col bg-background">
                  <div className="flex-1 overflow-auto p-4">
                    <pre className="text-sm font-mono whitespace-pre-wrap">
                      {content}
                    </pre>
                  </div>
                  <div className="border-t p-2 flex gap-2">
                    <Button
                      onClick={() => handleDownload(file)}
                      size="sm"
                      variant="outline"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              </DraggableWindow>
            ),
          });
        }
      } catch (error: any) {
        toast.error('Failed to open file: ' + (error.message || 'Unknown error'));
      }
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
      const response = await filesAPI.read(sessionId, file.path, connectionType);

      if (response.data.success) {
        const content = response.data.data.content || '';

        // Detect MIME type based on file extension
        let mimeType = 'application/octet-stream';
        const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';

        if (['txt', 'log', 'md'].includes(ext || '')) {
          mimeType = 'text/plain';
        } else if (['json'].includes(ext || '')) {
          mimeType = 'application/json';
        } else if (['html', 'htm'].includes(ext || '')) {
          mimeType = 'text/html';
        } else if (['css'].includes(ext || '')) {
          mimeType = 'text/css';
        } else if (['js'].includes(ext || '')) {
          mimeType = 'text/javascript';
        }

        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name; // Use original filename with extension
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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const targetPath = currentPath.endsWith('/')
        ? `${currentPath}${file.name}`
        : `${currentPath}/${file.name}`;

      const response = await filesAPI.write(sessionId, targetPath, content, connectionType);

      if (response.data.success) {
        toast.success(`Uploaded ${file.name}`);
        loadFiles(currentPath);
      } else {
        toast.error('Failed to upload: ' + (response.data.error || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Failed to upload:', error);
      toast.error('Failed to upload: ' + (error.message || 'Unknown error'));
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
            title="Go up"
          >
            ↑
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

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <label className="cursor-pointer">
            <div className="inline-flex items-center justify-center h-8 px-3 rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
              <Upload className="h-4 w-4 mr-1" />
              Upload
            </div>
            <input
              type="file"
              className="hidden"
              onChange={handleUpload}
            />
          </label>
        </div>
      </div>

      {/* Path bar */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <span className="text-xs text-muted-foreground">Path:</span>
        <Input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={handlePathKeyDown}
          className="h-7 text-xs font-mono"
          placeholder="/path/to/directory"
          title="Press Enter to navigate"
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
                      {file.permissions && <span>{file.permissions}</span>}
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

// FileEditorProvider component
interface FileEditorProviderProps {
  children: React.ReactNode;
  sessionId: string;
  connectionType: 'ssh' | 'ftp';
}

export function FileEditorProvider({ children, sessionId, connectionType }: FileEditorProviderProps) {
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const openFileInEditor = (file: FileItem, content: string) => {
    setEditingFile(file);
    setEditContent(content);
  };

  const updateContent = (content: string) => {
    setEditContent(content);
  };

  const saveFile = async () => {
    if (!editingFile) return;

    try {
      setIsSaving(true);
      const response = await filesAPI.write(sessionId, editingFile.path, editContent, connectionType);

      if (response.data.success) {
        toast.success(`Saved ${editingFile.name}`);
      } else {
        toast.error('Failed to save: ' + (response.data.error || 'Unknown error'));
      }
    } catch (error: any) {
      console.error('Failed to save:', error);
      toast.error('Failed to save: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSaving(false);
    }
  };

  const closeEditor = () => {
    setEditingFile(null);
    setEditContent('');
  };

  const value: FileEditorContextType = {
    editingFile,
    editContent,
    isSaving,
    openFileInEditor,
    updateContent,
    saveFile,
    closeEditor,
  };

  return (
    <FileEditorContext.Provider value={value}>
      {children}
    </FileEditorContext.Provider>
  );
}

export function FileManager(props: FileManagerProps) {
  return (
    <WindowManager>
      <FileManagerContent {...props} />
    </WindowManager>
  );
}
