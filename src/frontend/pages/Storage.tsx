import { useState, useEffect, useRef } from 'react';
import { storageAPI } from '../services/api';
import { StorageConnection, StorageBucket, StorageObject } from '../../types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { ConfirmModal } from '../components/ui/confirm-modal';
import { toast } from 'sonner';
import {
  HardDrive,
  Plus,
  Trash2,
  Upload,
  Download,
  Search,
  FolderOpen,
  FolderPlus,
  File,
  Settings,
  RefreshCw,
  Database,
  Copy,
  ArrowLeft,
  Grid3x3,
  List as ListIcon,
  Eye,
  ChevronLeft,
  ChevronRight,
  FileText
} from 'lucide-react';
import { cn } from '../lib/utils';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface StorageProps {
  storageConnectionIdOverride?: number;
  embedded?: boolean;
}

export default function Storage({ storageConnectionIdOverride, embedded = false }: StorageProps = {}) {
  const [connections, setConnections] = useState<StorageConnection[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<StorageConnection | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<StorageBucket[]>([]);
  const [currentBucket, setCurrentBucket] = useState<string | null>(null);
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(false);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showCreateBucketModal, setShowCreateBucketModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
  const [previewObject, setPreviewObject] = useState<StorageObject | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    object?: StorageObject;
    type: 'object' | 'background';
  } | null>(null);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [clipboard, setClipboard] = useState<{
    object: StorageObject;
    operation: 'copy' | 'cut';
  } | null>(null);
  const [imageBlobUrls, setImageBlobUrls] = useState<Map<string, string>>(new Map());
  const blobUrlsRef = useRef<Map<string, string>>(new Map());
  const [pdfThumbnails, setPdfThumbnails] = useState<Map<string, string>>(new Map());
  const pdfThumbnailsRef = useRef<Map<string, string>>(new Map());
  const [videoThumbnails, setVideoThumbnails] = useState<Map<string, string>>(new Map());
  const videoThumbnailsRef = useRef<Map<string, string>>(new Map());
  const [docContent, setDocContent] = useState<string>('');
  const [excelData, setExcelData] = useState<any[][]>([]);
  const [draggedItem, setDraggedItem] = useState<StorageObject | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, obj: StorageObject) => {
    setDraggedItem(obj);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverFolder(null);
  };

  const handleDragOver = (e: React.DragEvent, targetFolder: StorageObject | null) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem || !targetFolder || targetFolder.type !== 'folder') return;

    // Don't allow dragging folder into itself
    if (draggedItem.path === targetFolder.path) return;

    // Don't allow dragging folder into its own children
    if (draggedItem.type === 'folder' && targetFolder.path.startsWith(draggedItem.path)) return;

    e.dataTransfer.dropEffect = 'move';
    setDragOverFolder(targetFolder.path);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverFolder(null);
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: StorageObject) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem || !sessionId || !currentBucket || targetFolder.type !== 'folder') {
      setDraggedItem(null);
      setDragOverFolder(null);
      return;
    }

    // Don't allow dropping on itself
    if (draggedItem.path === targetFolder.path) {
      setDraggedItem(null);
      setDragOverFolder(null);
      return;
    }

    // Don't allow dropping folder into its own children
    if (draggedItem.type === 'folder' && targetFolder.path.startsWith(draggedItem.path)) {
      toast.error('Cannot move a folder into itself');
      setDraggedItem(null);
      setDragOverFolder(null);
      return;
    }

    try {
      const itemName = draggedItem.name;
      const destPath = targetFolder.path + itemName;

      console.log('[DRAG-DROP] Moving:', draggedItem.path, '->', destPath);

      if (draggedItem.type === 'folder') {
        // Move folder and all its contents
        const folderPrefix = draggedItem.path;
        const allObjects = await storageAPI.listObjects(sessionId, currentBucket, folderPrefix, true);

        for (const obj of allObjects.data.data) {
          const relativePath = obj.path.substring(folderPrefix.length);
          const newPath = (destPath.endsWith('/') ? destPath : destPath + '/') + relativePath;

          await storageAPI.copyObject(
            sessionId,
            currentBucket,
            obj.path,
            currentBucket,
            newPath
          );
        }

        // Copy folder placeholder
        const folderDestPath = destPath.endsWith('/') ? destPath : destPath + '/';
        await storageAPI.copyObject(
          sessionId,
          currentBucket,
          folderPrefix,
          currentBucket,
          folderDestPath
        );

        // Delete original folder
        await storageAPI.deleteFolder(sessionId, currentBucket, folderPrefix);

        toast.success(`Moved folder ${itemName}`);
      } else {
        // Move file
        await storageAPI.copyObject(
          sessionId,
          currentBucket,
          draggedItem.path,
          currentBucket,
          destPath
        );
        await storageAPI.deleteObject(sessionId, currentBucket, draggedItem.path);
        toast.success(`Moved ${itemName}`);
      }

      await loadObjects(currentBucket, currentPath);
    } catch (error: any) {
      console.error('[DRAG-DROP] Error:', error);
      toast.error(error.response?.data?.error || 'Failed to move item');
    } finally {
      setDraggedItem(null);
      setDragOverFolder(null);
    }
  };
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info' | 'success';
  }>({
    isOpen: false,
    title: '',
    onConfirm: () => {},
  });

  // Load connections on mount
  useEffect(() => {
    loadConnections();
  }, []);

  // Auto-connect when storageConnectionIdOverride is provided (for embedded mode)
  useEffect(() => {
    if (storageConnectionIdOverride && connections.length > 0 && !sessionId) {
      const connection = connections.find(c => c.id === storageConnectionIdOverride);
      if (connection) {
        handleConnect(connection);
      }
    }
  }, [storageConnectionIdOverride, connections, sessionId]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const loadConnections = async () => {
    try {
      const response = await storageAPI.getAllConnections();
      setConnections(response.data.data || []);
    } catch (error: any) {
      toast.error('Failed to load storage connections');
      console.error(error);
    }
  };

  const handleConnect = async (connection: StorageConnection) => {
    setLoading(true);
    try {
      const response = await storageAPI.connect(connection.id);
      const newSessionId = response.data.data.sessionId;
      setSessionId(newSessionId);
      setSelectedConnection(connection);
      toast.success(`Connected to ${connection.name}`);

      // Load buckets
      await loadBuckets(newSessionId);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to connect to storage');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!sessionId) return;

    try {
      await storageAPI.disconnect(sessionId);
      setSessionId(null);
      setSelectedConnection(null);
      setBuckets([]);
      setCurrentBucket(null);
      setObjects([]);
      setCurrentPath('');
      toast.success('Disconnected from storage');
    } catch (error: any) {
      toast.error('Failed to disconnect');
      console.error(error);
    }
  };

  const loadBuckets = async (sid: string) => {
    setLoading(true);
    try {
      const response = await storageAPI.listBuckets(sid);
      setBuckets(response.data.data || []);
    } catch (error: any) {
      toast.error('Failed to load buckets');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBucket = async (bucketName: string) => {
    if (!sessionId) return;

    setCurrentBucket(bucketName);
    setCurrentPath('');
    await loadObjects(bucketName, '');
  };

  const loadObjects = async (bucketName: string, prefix: string) => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const response = await storageAPI.listObjects(sessionId, bucketName, prefix, false);
      const objectsList = response.data.data || [];
      setObjects(objectsList);

      // Load media (images, videos, PDFs) with authentication - always reload for current view
      const newBlobUrls = new Map<string, string>();
      const newPdfThumbnails = new Map<string, string>();
      const newVideoThumbnails = new Map<string, string>();

      // Load all media files in the current folder
      const mediaLoadPromises = objectsList
        .filter(obj => obj.type === 'file' && (isImage(obj.name) || isVideo(obj.name) || isPDF(obj.name)))
        .map(async (obj) => {
          try {
            // Check if we already have this blob URL cached in ref
            if (blobUrlsRef.current.has(obj.path)) {
              newBlobUrls.set(obj.path, blobUrlsRef.current.get(obj.path)!);

              // For PDFs, also check if we have a cached thumbnail
              if (isPDF(obj.name) && pdfThumbnailsRef.current.has(obj.path)) {
                newPdfThumbnails.set(obj.path, pdfThumbnailsRef.current.get(obj.path)!);
              }

              // For videos, also check if we have a cached thumbnail
              if (isVideo(obj.name) && videoThumbnailsRef.current.has(obj.path)) {
                newVideoThumbnails.set(obj.path, videoThumbnailsRef.current.get(obj.path)!);
              }
            } else {
              const mediaResponse = await storageAPI.downloadObject(sessionId, bucketName, obj.path);
              const blobUrl = URL.createObjectURL(mediaResponse.data);
              newBlobUrls.set(obj.path, blobUrl);
              blobUrlsRef.current.set(obj.path, blobUrl);

              // Generate PDF thumbnail
              if (isPDF(obj.name)) {
                const thumbnailUrl = await generatePdfThumbnail(mediaResponse.data);
                if (thumbnailUrl) {
                  newPdfThumbnails.set(obj.path, thumbnailUrl);
                  pdfThumbnailsRef.current.set(obj.path, thumbnailUrl);
                }
              }

              // Generate video thumbnail
              if (isVideo(obj.name)) {
                const thumbnailUrl = await generateVideoThumbnail(mediaResponse.data);
                if (thumbnailUrl) {
                  newVideoThumbnails.set(obj.path, thumbnailUrl);
                  videoThumbnailsRef.current.set(obj.path, thumbnailUrl);
                }
              }
            }
          } catch (error) {
            console.error(`Failed to load media file for ${obj.name}:`, error);
          }
        });

      await Promise.all(mediaLoadPromises);

      // Update state with new blob URLs - create new Map to trigger React update
      setImageBlobUrls(new Map(newBlobUrls));
      setPdfThumbnails(new Map(newPdfThumbnails));
      setVideoThumbnails(new Map(newVideoThumbnails));
    } catch (error: any) {
      // Check if session expired (404 or 500 with "Session not found" message)
      if (error.response?.status === 500 && error.response?.data?.error?.includes('Session not found')) {
        console.log('[STORAGE] Session expired');
        toast.error('Session expired. Please reconnect.');

        // Clear session state
        setSessionId(null);
        setBuckets([]);
        setCurrentBucket(null);
        setObjects([]);
        setCurrentPath('');
      } else {
        toast.error('Failed to load objects');
      }
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Cleanup blob URLs when component unmounts
  useEffect(() => {
    return () => {
      // Only cleanup on unmount, not on every state change
      // In embedded mode, we should be more careful about cleanup
      if (!embedded) {
        blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        blobUrlsRef.current.clear();
      }
    };
  }, [embedded]); // Include embedded in dependency array

  const handleNavigateToFolder = async (folderPath: string) => {
    if (!sessionId || !currentBucket) return;

    setCurrentPath(folderPath);
    await loadObjects(currentBucket, folderPath);
  };

  const handleUpload = async () => {
    if (!uploadFiles || !sessionId || !currentBucket) return;

    setLoading(true);
    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        const objectName = currentPath ? `${currentPath}${file.name}` : file.name;
        await storageAPI.uploadObject(sessionId, currentBucket, objectName, file);
      }

      toast.success(`Uploaded ${uploadFiles.length} file(s)`);
      setUploadFiles(null);
      await loadObjects(currentBucket, currentPath);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to upload files');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (objectName: string) => {
    if (!sessionId || !currentBucket) return;

    try {
      const response = await storageAPI.downloadObject(sessionId, currentBucket, objectName);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', objectName.split('/').pop() || objectName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Download started');
    } catch (error: any) {
      toast.error('Failed to download file');
      console.error(error);
    }
  };

  const handleDelete = (objectPath: string, isFolder: boolean = false) => {
    if (!sessionId || !currentBucket) return;

    const itemName = objectPath.split('/').filter(Boolean).pop() || objectPath;
    const itemType = isFolder ? 'folder' : 'file';

    setConfirmModal({
      isOpen: true,
      title: `Delete ${itemType}: ${itemName}?`,
      description: isFolder
        ? 'This will permanently delete the folder and all files inside it. This action cannot be undone.'
        : 'This will permanently delete this file. This action cannot be undone.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          if (isFolder) {
            await storageAPI.deleteFolder(sessionId, currentBucket, objectPath);
            toast.success('Folder deleted');
          } else {
            await storageAPI.deleteObject(sessionId, currentBucket, objectPath);
            toast.success('Object deleted');
          }
          await loadObjects(currentBucket, currentPath);
        } catch (error: any) {
          toast.error(`Failed to delete ${itemType}`);
          console.error(error);
        }
      },
    });
  };

  const handleDeleteSelected = () => {
    if (!sessionId || !currentBucket || selectedFiles.size === 0) return;

    setConfirmModal({
      isOpen: true,
      title: `Delete ${selectedFiles.size} item(s)?`,
      description: 'This will permanently delete the selected items. This action cannot be undone.',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await storageAPI.deleteObjects(sessionId, currentBucket, Array.from(selectedFiles));
          toast.success(`Deleted ${selectedFiles.size} item(s)`);
          setSelectedFiles(new Set());
          await loadObjects(currentBucket, currentPath);
        } catch (error: any) {
          toast.error('Failed to delete objects');
          console.error(error);
        }
      },
    });
  };

  const handleCreateBucket = async (bucketName: string) => {
    if (!sessionId) return;

    try {
      await storageAPI.createBucket(sessionId, bucketName);
      toast.success(`Bucket "${bucketName}" created`);
      setShowCreateBucketModal(false);
      await loadBuckets(sessionId);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create bucket');
      console.error(error);
    }
  };

  const handleCreateFolder = async () => {
    if (!sessionId || !currentBucket || !newFolderName.trim()) return;

    try {
      const folderPath = currentPath + newFolderName.trim() + '/';
      await storageAPI.createFolder(sessionId, currentBucket, folderPath);
      toast.success(`Folder "${newFolderName}" created`);
      setShowCreateFolderModal(false);
      setNewFolderName('');
      await loadObjects(currentBucket, currentPath);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create folder');
      console.error(error);
    }
  };

  const filteredObjects = objects
    .filter(obj => obj.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      // Folders first, then files
      if (a.type === 'folder' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'folder') return 1;
      // Within same type, sort alphabetically by name
      return a.name.localeCompare(b.name);
    });

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const isImage = (filename: string): boolean => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
    return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const isVideo = (filename: string): boolean => {
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'];
    return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const isPDF = (filename: string): boolean => {
    return filename.toLowerCase().endsWith('.pdf');
  };

  const isWord = (filename: string): boolean => {
    return filename.toLowerCase().endsWith('.docx') || filename.toLowerCase().endsWith('.doc');
  };

  const isExcel = (filename: string): boolean => {
    const excelExtensions = ['.xlsx', '.xls', '.csv'];
    return excelExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  };

  const getMediaUrl = (objectPath: string): string => {
    return imageBlobUrls.get(objectPath) || '';
  };

  const getPdfThumbnail = (objectPath: string): string => {
    return pdfThumbnails.get(objectPath) || '';
  };

  const getVideoThumbnail = (objectPath: string): string => {
    return videoThumbnails.get(objectPath) || '';
  };

  const generateVideoThumbnail = async (videoBlob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        resolve('');
        return;
      }

      const blobUrl = URL.createObjectURL(videoBlob);
      video.src = blobUrl;
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;

      video.addEventListener('loadeddata', () => {
        // Seek to 1 second or 10% of video duration, whichever is smaller
        video.currentTime = Math.min(1, video.duration * 0.1);
      });

      video.addEventListener('seeked', () => {
        try {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
          URL.revokeObjectURL(blobUrl);
          resolve(thumbnailUrl);
        } catch (error) {
          console.error('Failed to generate video thumbnail:', error);
          URL.revokeObjectURL(blobUrl);
          resolve('');
        }
      });

      video.addEventListener('error', () => {
        URL.revokeObjectURL(blobUrl);
        resolve('');
      });

      video.load();
    });
  };

  const generatePdfThumbnail = async (pdfBlob: Blob): Promise<string> => {
    try {
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale: 0.5 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) return '';

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      return canvas.toDataURL();
    } catch (error) {
      console.error('Failed to generate PDF thumbnail:', error);
      return '';
    }
  };

  const handlePreview = async (obj: StorageObject) => {
    if (!sessionId || !currentBucket) return;

    console.log('[PREVIEW] File:', obj.name, 'Type checks - Image:', isImage(obj.name), 'Video:', isVideo(obj.name), 'PDF:', isPDF(obj.name), 'Word:', isWord(obj.name), 'Excel:', isExcel(obj.name));

    if (isImage(obj.name) || isVideo(obj.name) || isPDF(obj.name)) {
      setPreviewObject(obj);
      const blobUrl = getMediaUrl(obj.path);
      console.log('[PREVIEW] Preview URL for', obj.name, ':', blobUrl);
      console.log('[PREVIEW] Has blob URL:', !!blobUrl);
      setPreviewUrl(blobUrl);
      setDocContent('');
      setExcelData([]);
    } else if (isWord(obj.name)) {
      // Handle Word documents
      try {
        const response = await storageAPI.downloadObject(sessionId, currentBucket, obj.path);
        const arrayBuffer = await response.data.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setDocContent(result.value);
        setPreviewObject(obj);
        setPreviewUrl('');
        setExcelData([]);
      } catch (error) {
        console.error('[PREVIEW] Failed to load Word document:', error);
        toast.error('Failed to preview Word document');
      }
    } else if (isExcel(obj.name)) {
      // Handle Excel documents
      try {
        const response = await storageAPI.downloadObject(sessionId, currentBucket, obj.path);
        const arrayBuffer = await response.data.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        setExcelData(data as any[][]);
        setPreviewObject(obj);
        setPreviewUrl('');
        setDocContent('');
      } catch (error) {
        console.error('[PREVIEW] Failed to load Excel document:', error);
        toast.error('Failed to preview Excel document');
      }
    } else {
      // For other files, just download
      console.log('[PREVIEW] Not a previewable file, downloading...');
      handleDownload(obj.path);
    }
  };

  const navigateMedia = (direction: 'prev' | 'next') => {
    if (!previewObject) return;

    const mediaObjects = objects.filter(obj =>
      obj.type === 'file' && (isImage(obj.name) || isVideo(obj.name) || isPDF(obj.name) || isWord(obj.name) || isExcel(obj.name))
    );
    const currentIndex = mediaObjects.findIndex(obj => obj.path === previewObject.path);

    let newIndex: number;
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % mediaObjects.length;
    } else {
      newIndex = (currentIndex - 1 + mediaObjects.length) % mediaObjects.length;
    }

    const newObject = mediaObjects[newIndex];
    handlePreview(newObject);
  };

  const closePreview = () => {
    setPreviewObject(null);
    setPreviewUrl(null);
    setDocContent('');
    setExcelData([]);
  };

  // Keyboard navigation for media preview
  useEffect(() => {
    if (!previewObject) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        navigateMedia('prev');
      } else if (e.key === 'ArrowRight') {
        navigateMedia('next');
      } else if (e.key === 'Escape') {
        closePreview();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [previewObject, objects]);

  const handleContextMenu = (e: React.MouseEvent, obj?: StorageObject) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      object: obj,
      type: obj ? 'object' : 'background',
    });
  };

  const handleBackgroundContextMenu = (e: React.MouseEvent) => {
    // Check if we're clicking on the background or empty state (not on an object card)
    const target = e.target as HTMLElement;
    const isObjectCard = target.closest('[data-object-card]');

    if (!isObjectCard) {
      handleContextMenu(e);
    }
  };

  const handleCopy = (obj: StorageObject) => {
    setClipboard({ object: obj, operation: 'copy' });
    toast.success(`Copied ${obj.name}`);
    setContextMenu(null);
  };

  const handleCut = (obj: StorageObject) => {
    setClipboard({ object: obj, operation: 'cut' });
    toast.success(`Cut ${obj.name}`);
    setContextMenu(null);
  };

  const handlePaste = async () => {
    if (!clipboard || !sessionId || !currentBucket) return;

    try {
      // Extract just the filename/foldername from the clipboard object
      const itemName = clipboard.object.name;

      // Build the destination path (current folder + item name)
      // Ensure proper path construction without double slashes
      const destPath = currentPath + itemName;

      console.log('[PASTE] Source path:', clipboard.object.path);
      console.log('[PASTE] Destination path:', destPath);
      console.log('[PASTE] Current path:', currentPath);
      console.log('[PASTE] Item name:', itemName);
      console.log('[PASTE] Item type:', clipboard.object.type);

      // Check if trying to paste in the same location
      if (clipboard.object.path === destPath ||
          (clipboard.object.type === 'folder' && clipboard.object.path === destPath + '/')) {
        toast.error('Cannot paste in the same location');
        setContextMenu(null);
        return;
      }

      if (clipboard.operation === 'copy') {
        if (clipboard.object.type === 'folder') {
          // For folders, we need to copy all objects with that prefix
          const folderPrefix = clipboard.object.path;
          const allObjects = await storageAPI.listObjects(sessionId, currentBucket, folderPrefix, true);

          console.log('[PASTE] Folder objects to copy:', allObjects.data.data.length);

          // Copy each object to the new location
          for (const obj of allObjects.data.data) {
            const relativePath = obj.path.substring(folderPrefix.length);
            // Clean up path - avoid double slashes
            const newPath = (destPath.endsWith('/') ? destPath : destPath + '/') + relativePath;

            console.log('[PASTE] Copying object:', obj.path, '->', newPath);

            await storageAPI.copyObject(
              sessionId,
              currentBucket,
              obj.path,
              currentBucket,
              newPath
            );
          }

          // Also copy the folder placeholder
          const folderDestPath = destPath.endsWith('/') ? destPath : destPath + '/';
          console.log('[PASTE] Copying folder placeholder:', folderPrefix, '->', folderDestPath);

          await storageAPI.copyObject(
            sessionId,
            currentBucket,
            folderPrefix,
            currentBucket,
            folderDestPath
          );

          toast.success(`Copied folder ${itemName}`);
        } else {
          // For files, simple copy
          console.log('[PASTE] Copying file:', clipboard.object.path, '->', destPath);

          await storageAPI.copyObject(
            sessionId,
            currentBucket,
            clipboard.object.path,
            currentBucket,
            destPath
          );
          toast.success(`Copied ${itemName}`);
        }
      } else {
        // For cut operation
        if (clipboard.object.type === 'folder') {
          // Copy folder contents
          const folderPrefix = clipboard.object.path;
          const allObjects = await storageAPI.listObjects(sessionId, currentBucket, folderPrefix, true);

          for (const obj of allObjects.data.data) {
            const relativePath = obj.path.substring(folderPrefix.length);
            const newPath = (destPath.endsWith('/') ? destPath : destPath + '/') + relativePath;

            await storageAPI.copyObject(
              sessionId,
              currentBucket,
              obj.path,
              currentBucket,
              newPath
            );
          }

          // Copy folder placeholder
          const folderDestPath = destPath.endsWith('/') ? destPath : destPath + '/';

          await storageAPI.copyObject(
            sessionId,
            currentBucket,
            folderPrefix,
            currentBucket,
            folderDestPath
          );

          // Delete original folder
          await storageAPI.deleteFolder(sessionId, currentBucket, folderPrefix);

          toast.success(`Moved folder ${itemName}`);
        } else {
          // For files
          await storageAPI.copyObject(
            sessionId,
            currentBucket,
            clipboard.object.path,
            currentBucket,
            destPath
          );
          await storageAPI.deleteObject(sessionId, currentBucket, clipboard.object.path);
          toast.success(`Moved ${itemName}`);
        }
        setClipboard(null);
      }

      await loadObjects(currentBucket, currentPath);
    } catch (error: any) {
      console.error('[PASTE] Error details:', error);
      toast.error(error.response?.data?.error || 'Failed to paste');
      console.error(error);
    }
    setContextMenu(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header - only show when not embedded */}
      {!embedded && (
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Storage Manager</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage your MinIO, S3, and other object storage
              </p>
            </div>
            <Button onClick={() => setShowConnectionModal(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Connection
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Left Sidebar - Connections & Buckets */}
        <div className={cn(
          "border-r border-border bg-card flex flex-col",
          embedded ? "w-48" : "w-80"
        )}>
          {/* Connections List - only show when not embedded */}
          {!embedded && (
            <div className="p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground mb-3">Storage Connections</h3>
              <div className="space-y-2">
                {connections.map(conn => (
                  <div
                    key={conn.id}
                    className={cn(
                      "p-3 rounded-lg border cursor-pointer transition-colors",
                      selectedConnection?.id === conn.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => handleConnect(conn)}
                  >
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-primary" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{conn.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{conn.endpoint}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {connections.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No connections yet
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Buckets List */}
          {sessionId && (
            <div className="flex-1 overflow-y-auto p-3">
              {/* Show connection info in embedded mode */}
              {embedded && selectedConnection && (
                <div className="mb-3 p-2 bg-muted/50 rounded-md">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-3 w-3 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{selectedConnection.name}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-foreground">Buckets</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowCreateBucketModal(true)}
                  className="h-6 w-6 p-0"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <div className="space-y-1">
                {buckets.map(bucket => (
                  <div
                    key={bucket.name}
                    className={cn(
                      "rounded-md cursor-pointer transition-colors flex items-center gap-2",
                      embedded ? "p-1.5" : "p-2",
                      currentBucket === bucket.name
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-foreground"
                    )}
                    onClick={() => handleSelectBucket(bucket.name)}
                  >
                    <Database className={embedded ? "h-3 w-3" : "h-4 w-4"} />
                    <span className={cn("truncate", embedded ? "text-xs" : "text-sm")}>{bucket.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main Content - File Browser */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {currentBucket ? (
            <>
              {/* Toolbar */}
              <div className={cn("border-b border-border bg-card/50", embedded ? "p-2" : "p-4")}>
                <div className={cn("flex items-center gap-2", embedded ? "mb-2" : "gap-3 mb-3")}>
                  {currentPath && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const newPath = currentPath.split('/').slice(0, -2).join('/');
                        handleNavigateToFolder(newPath ? newPath + '/' : '');
                      }}
                      className={embedded ? "h-6 w-6 p-0" : ""}
                    >
                      <ArrowLeft className={embedded ? "h-3 w-3" : "h-4 w-4"} />
                    </Button>
                  )}
                  <div className={cn("flex items-center gap-2 text-muted-foreground", embedded ? "text-xs" : "text-sm")}>
                    <Database className={embedded ? "h-3 w-3" : "h-4 w-4"} />
                    <span>{currentBucket}</span>
                    {currentPath && (
                      <>
                        <span>/</span>
                        <span className="text-foreground">{currentPath}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className={cn("flex items-center", embedded ? "gap-2" : "gap-3")}>
                  <div className="flex-1 relative">
                    <Search className={cn("absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground", embedded ? "h-3 w-3" : "h-4 w-4")} />
                    <Input
                      placeholder="Search files..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={cn("pl-10", embedded ? "h-7 text-xs" : "")}
                    />
                  </div>

                  <input
                    type="file"
                    multiple
                    onChange={(e) => setUploadFiles(e.target.files)}
                    className="hidden"
                    id="file-upload"
                  />
                  <Button
                    size="sm"
                    onClick={() => document.getElementById('file-upload')?.click()}
                    className={embedded ? "h-7 text-xs px-2" : ""}
                  >
                    <Upload className={cn(embedded ? "h-3 w-3 mr-1" : "h-4 w-4 mr-2")} />
                    {!embedded && "Upload"}
                  </Button>

                  {uploadFiles && uploadFiles.length > 0 && (
                    <Button size="sm" onClick={handleUpload} disabled={loading} className={embedded ? "h-7 text-xs px-2" : ""}>
                      Upload {uploadFiles.length} file(s)
                    </Button>
                  )}

                  {selectedFiles.size > 0 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleDeleteSelected}
                      className={embedded ? "h-7 text-xs px-2" : ""}
                    >
                      <Trash2 className={cn(embedded ? "h-3 w-3 mr-1" : "h-4 w-4 mr-2")} />
                      {embedded ? `(${selectedFiles.size})` : `Delete (${selectedFiles.size})`}
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                    className={embedded ? "h-7 w-7 p-0" : ""}
                  >
                    {viewMode === 'grid' ? <ListIcon className={embedded ? "h-3 w-3" : "h-4 w-4"} /> : <Grid3x3 className={embedded ? "h-3 w-3" : "h-4 w-4"} />}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => loadObjects(currentBucket, currentPath)}
                    disabled={loading}
                  >
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                  </Button>
                </div>
              </div>

              {/* File Grid/List */}
              <div
                className={cn("flex-1 overflow-y-auto", embedded ? "p-2" : "p-4")}
                onContextMenu={handleBackgroundContextMenu}
              >
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <RefreshCw className={cn("animate-spin text-muted-foreground", embedded ? "h-5 w-5" : "h-8 w-8")} />
                  </div>
                ) : viewMode === 'grid' ? (
                  <div
                    className={cn(
                      "grid gap-3",
                      embedded
                        ? "grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2"
                        : "grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8"
                    )}
                    onContextMenu={handleBackgroundContextMenu}
                  >
                    {filteredObjects.map(obj => (
                      <Card
                        key={obj.path}
                        data-object-card
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, obj)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => obj.type === 'folder' ? handleDragOver(e, obj) : e.preventDefault()}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => obj.type === 'folder' ? handleDrop(e, obj) : undefined}
                        className={cn(
                          "cursor-pointer transition-all hover:shadow-md",
                          selectedFiles.has(obj.path) && "ring-2 ring-primary",
                          clipboard?.object.path === obj.path && clipboard.operation === 'cut' && "opacity-50",
                          draggedItem?.path === obj.path && "opacity-30",
                          dragOverFolder === obj.path && obj.type === 'folder' && "ring-2 ring-blue-500 bg-blue-500/10"
                        )}
                        onClick={() => {
                          if (obj.type === 'folder') {
                            handleNavigateToFolder(obj.path);
                          }
                        }}
                        onContextMenu={(e) => handleContextMenu(e, obj)}
                      >
                        <CardContent className={embedded ? "p-1.5" : "p-3"}>
                          <div
                            className={cn("flex flex-col items-center", embedded ? "gap-1" : "gap-2")}
                            onClick={(e) => {
                              if (obj.type === 'file') {
                                e.stopPropagation();
                                handlePreview(obj);
                              }
                            }}
                          >
                            {obj.type === 'folder' ? (
                              <div className={cn(
                                "w-full rounded overflow-hidden bg-muted flex items-center justify-center",
                                embedded ? "h-14" : "h-24"
                              )}>
                                <FolderOpen className={cn("text-blue-500", embedded ? "h-6 w-6" : "h-12 w-12")} />
                              </div>
                            ) : isImage(obj.name) ? (
                              <div className={cn(
                                "w-full rounded overflow-hidden bg-muted flex items-center justify-center",
                                embedded ? "h-14" : "h-24"
                              )}>
                                <img
                                  src={getMediaUrl(obj.path)}
                                  alt={obj.name}
                                  className="max-w-full max-h-full object-contain"
                                  loading="lazy"
                                />
                              </div>
                            ) : isVideo(obj.name) ? (
                              <div className={cn(
                                "w-full rounded overflow-hidden bg-muted flex items-center justify-center",
                                embedded ? "h-14" : "h-24"
                              )}>
                                {getVideoThumbnail(obj.path) ? (
                                  <img
                                    src={getVideoThumbnail(obj.path)}
                                    alt={obj.name}
                                    className="max-w-full max-h-full object-contain"
                                    loading="lazy"
                                  />
                                ) : (
                                  <img
                                    src={getMediaUrl(obj.path)}
                                    alt={obj.name}
                                    className="max-w-full max-h-full object-contain"
                                    loading="lazy"
                                  />
                                )}
                              </div>
                            ) : isPDF(obj.name) ? (
                              <div className={cn(
                                "w-full rounded overflow-hidden bg-muted flex items-center justify-center relative",
                                embedded ? "h-14" : "h-24"
                              )}>
                                {getPdfThumbnail(obj.path) ? (
                                  <img
                                    src={getPdfThumbnail(obj.path)}
                                    alt={obj.name}
                                    className="w-full h-full object-contain"
                                  />
                                ) : (
                                  <>
                                    <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 to-red-950/40" />
                                    <FileText className={cn("text-red-400 relative z-10", embedded ? "h-6 w-6" : "h-12 w-12")} />
                                    {!embedded && (
                                      <div className="absolute bottom-1 right-1 text-[10px] font-bold text-red-300/80 z-10">
                                        PDF
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            ) : isWord(obj.name) ? (
                              <div className={cn(
                                "w-full rounded overflow-hidden bg-muted flex items-center justify-center relative",
                                embedded ? "h-14" : "h-24"
                              )}>
                                <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-blue-950/40" />
                                <FileText className={cn("text-blue-400 relative z-10", embedded ? "h-6 w-6" : "h-12 w-12")} />
                                {!embedded && (
                                  <div className="absolute bottom-1 right-1 text-[10px] font-bold text-blue-300/80 z-10">
                                    DOCX
                                  </div>
                                )}
                              </div>
                            ) : isExcel(obj.name) ? (
                              <div className={cn(
                                "w-full rounded overflow-hidden bg-muted flex items-center justify-center relative",
                                embedded ? "h-14" : "h-24"
                              )}>
                                <div className="absolute inset-0 bg-gradient-to-br from-green-900/20 to-green-950/40" />
                                <FileText className={cn("text-green-400 relative z-10", embedded ? "h-6 w-6" : "h-12 w-12")} />
                                {!embedded && (
                                  <div className="absolute bottom-1 right-1 text-[10px] font-bold text-green-300/80 z-10">
                                    {obj.name.toLowerCase().endsWith('.csv') ? 'CSV' : 'XLSX'}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className={cn(
                                "w-full rounded overflow-hidden bg-muted flex items-center justify-center relative",
                                embedded ? "h-14" : "h-24"
                              )}>
                                <div className="absolute inset-0 bg-gradient-to-br from-gray-900/20 to-gray-950/40" />
                                <File className={cn("text-gray-400 relative z-10", embedded ? "h-6 w-6" : "h-12 w-12")} />
                              </div>
                            )}
                            <div className="w-full text-center">
                              <p className={cn("font-medium truncate leading-tight", embedded ? "text-[10px]" : "text-xs")}>{obj.name}</p>
                              {obj.type === 'file' && !embedded && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  {formatFileSize(obj.size)}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div
                    className="space-y-1"
                    onContextMenu={handleBackgroundContextMenu}
                  >
                    {filteredObjects.map(obj => (
                      <div
                        key={obj.path}
                        data-object-card
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, obj)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => obj.type === 'folder' ? handleDragOver(e, obj) : e.preventDefault()}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => obj.type === 'folder' ? handleDrop(e, obj) : undefined}
                        className={cn(
                          "flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer",
                          selectedFiles.has(obj.path) && "bg-primary/10",
                          clipboard?.object.path === obj.path && clipboard.operation === 'cut' && "opacity-50",
                          draggedItem?.path === obj.path && "opacity-30",
                          dragOverFolder === obj.path && obj.type === 'folder' && "ring-2 ring-blue-500 bg-blue-500/10"
                        )}
                        onClick={() => {
                          if (obj.type === 'folder') {
                            handleNavigateToFolder(obj.path);
                          } else {
                            handlePreview(obj);
                          }
                        }}
                        onContextMenu={(e) => handleContextMenu(e, obj)}
                      >
                        {obj.type === 'folder' ? (
                          <FolderOpen className="h-4 w-4 text-blue-500" />
                        ) : isImage(obj.name) ? (
                          <div className="w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                            <img
                              src={getMediaUrl(obj.path)}
                              alt={obj.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : isVideo(obj.name) ? (
                          <div className="w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                            {getVideoThumbnail(obj.path) ? (
                              <img
                                src={getVideoThumbnail(obj.path)}
                                alt={obj.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <img
                                src={getMediaUrl(obj.path)}
                                alt={obj.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            )}
                          </div>
                        ) : isPDF(obj.name) ? (
                          <div className="w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0 relative">
                            {getPdfThumbnail(obj.path) ? (
                              <img
                                src={getPdfThumbnail(obj.path)}
                                alt={obj.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <>
                                <div className="absolute inset-0 bg-gradient-to-br from-red-900/20 to-red-950/40" />
                                <FileText className="h-4 w-4 text-red-400" />
                              </>
                            )}
                          </div>
                        ) : isWord(obj.name) ? (
                          <div className="w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-blue-950/40" />
                            <FileText className="h-4 w-4 text-blue-400" />
                          </div>
                        ) : isExcel(obj.name) ? (
                          <div className="w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-green-900/20 to-green-950/40" />
                            <FileText className="h-4 w-4 text-green-400" />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0 relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-gray-900/20 to-gray-950/40" />
                            <File className="h-4 w-4 text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{obj.name}</p>
                          {obj.type === 'file' && (
                            <p className="text-[10px] text-muted-foreground">
                              {formatFileSize(obj.size)} • {new Date(obj.lastModified).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {filteredObjects.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <FolderOpen className="h-16 w-16 mb-4" />
                    <p>No files in this bucket</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <HardDrive className="h-16 w-16 mx-auto mb-4" />
                <p className="text-lg">Select a bucket to view files</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Connection Modal */}
      {showConnectionModal && (
        <ConnectionModal
          onClose={() => setShowConnectionModal(false)}
          onSave={() => {
            setShowConnectionModal(false);
            loadConnections();
          }}
        />
      )}

      {/* Create Bucket Modal */}
      {showCreateBucketModal && (
        <CreateBucketModal
          onClose={() => setShowCreateBucketModal(false)}
          onCreate={handleCreateBucket}
        />
      )}

      {/* Create Folder Modal */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md bg-card border-2 border-primary/30">
            <CardHeader>
              <CardTitle>Create Folder</CardTitle>
              <CardDescription>Enter a name for your new folder</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreateFolder();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="text-sm font-medium">Folder Name</label>
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="my-folder"
                    required
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateFolderModal(false);
                      setNewFolderName('');
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1">Create</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Media Preview Modal */}
      {previewObject && (
        <div
          className="fixed inset-0 bg-black/90 z-50"
          onClick={closePreview}
        >
          <div className="relative w-full h-full flex" onClick={(e) => e.stopPropagation()}>
            {/* Main Content Area */}
            <div className="flex-1 flex flex-col">
              {/* Media Area with Navigation */}
              <div className="flex-1 flex items-center justify-center relative">
                {/* Previous Button */}
                {objects.filter(obj => obj.type === 'file' && (isImage(obj.name) || isVideo(obj.name) || isPDF(obj.name) || isWord(obj.name) || isExcel(obj.name))).length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateMedia('prev');
                    }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 hover:bg-black/70 border border-primary/50 flex items-center justify-center transition-all z-10"
                  >
                    <ChevronLeft className="h-6 w-6 text-white" />
                  </button>
                )}

                {/* Media Content */}
                <div className="flex-1 flex items-center justify-center p-8" style={{ maxHeight: 'calc(100vh - 112px)' }}>
                  {isImage(previewObject.name) && previewUrl && (
                    <img
                      src={previewUrl}
                      alt={previewObject.name}
                      className="object-contain"
                      style={{
                        maxWidth: 'calc(100vw - 320px - 64px)',
                        maxHeight: 'calc(100vh - 112px - 64px)',
                        width: 'auto',
                        height: 'auto'
                      }}
                    />
                  )}
                  {isVideo(previewObject.name) && previewUrl && (
                    <video
                      src={previewUrl}
                      controls
                      className="object-contain"
                      style={{
                        maxWidth: 'calc(100vw - 320px - 64px)',
                        maxHeight: 'calc(100vh - 112px - 64px)',
                        width: 'auto',
                        height: 'auto'
                      }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  )}
                  {isPDF(previewObject.name) && previewUrl && (
                    <div className="w-full h-full flex items-center justify-center">
                      <iframe
                        src={previewUrl}
                        className="border-0 rounded shadow-lg"
                        style={{
                          width: 'calc(100vw - 320px - 64px)',
                          height: 'calc(100vh - 112px - 64px)',
                          minWidth: '800px',
                          minHeight: '600px',
                        }}
                        title={previewObject.name}
                      />
                    </div>
                  )}
                  {isWord(previewObject.name) && docContent && (
                    <div
                      className="w-full h-full overflow-auto bg-white p-8 text-black rounded"
                      style={{
                        maxWidth: 'calc(100vw - 320px - 64px)',
                        maxHeight: 'calc(100vh - 112px - 64px)',
                      }}
                      dangerouslySetInnerHTML={{ __html: docContent }}
                    />
                  )}
                  {isExcel(previewObject.name) && excelData.length > 0 && (
                    <div className="w-full h-full overflow-auto rounded" style={{
                      maxWidth: 'calc(100vw - 320px - 64px)',
                      maxHeight: 'calc(100vh - 112px - 64px)',
                    }}>
                      <table className="border-collapse border border-gray-600 text-white text-sm">
                        <tbody>
                          {excelData.map((row, i) => (
                            <tr key={i} className={i === 0 ? 'bg-primary/20' : ''}>
                              {row.map((cell, j) => (
                                <td key={j} className="border border-gray-600 px-3 py-2">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Next Button */}
                {objects.filter(obj => obj.type === 'file' && (isImage(obj.name) || isVideo(obj.name) || isPDF(obj.name) || isWord(obj.name) || isExcel(obj.name))).length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateMedia('next');
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 hover:bg-black/70 border border-primary/50 flex items-center justify-center transition-all z-10"
                  >
                    <ChevronRight className="h-6 w-6 text-white" />
                  </button>
                )}
              </div>

              {/* Thumbnail Gallery */}
              {objects.filter(obj => obj.type === 'file' && (isImage(obj.name) || isVideo(obj.name) || isPDF(obj.name) || isWord(obj.name) || isExcel(obj.name))).length > 1 && (
                <div
                  className="h-28 border-t-2 border-primary/50 flex items-center gap-2 px-4 overflow-x-auto overflow-y-hidden storage-thumbnail-gallery"
                  style={{ backgroundColor: 'hsl(0 0% 10%)' }}
                >
                  {objects
                    .filter(obj => obj.type === 'file' && (isImage(obj.name) || isVideo(obj.name) || isPDF(obj.name) || isWord(obj.name) || isExcel(obj.name)))
                    .map((obj) => {
                      const isCurrentImage = isImage(obj.name);
                      const isCurrentVideo = isVideo(obj.name);
                      const isCurrentPDF = isPDF(obj.name);
                      const isCurrentWord = isWord(obj.name);
                      const isCurrentExcel = isExcel(obj.name);

                      return (
                        <button
                          key={obj.path}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePreview(obj);
                          }}
                          className={cn(
                            "flex-shrink-0 rounded-md overflow-hidden border-2 transition-all flex items-center justify-center",
                            previewObject.path === obj.path
                              ? "border-primary ring-2 ring-primary/50"
                              : "border-transparent hover:border-primary/30"
                          )}
                          style={{ width: '80px', height: '80px', minWidth: '80px', minHeight: '80px', backgroundColor: 'hsl(0 0% 15%)' }}
                        >
                          {isCurrentImage && (
                            <img
                              src={getMediaUrl(obj.path)}
                              alt={obj.name}
                              className="object-cover"
                              style={{ width: '80px', height: '80px' }}
                            />
                          )}
                          {isCurrentVideo && (
                            getVideoThumbnail(obj.path) ? (
                              <img
                                src={getVideoThumbnail(obj.path)}
                                alt={obj.name}
                                className="object-cover"
                                style={{ width: '80px', height: '80px' }}
                              />
                            ) : (
                              <img
                                src={getMediaUrl(obj.path)}
                                alt={obj.name}
                                className="object-cover"
                                style={{ width: '80px', height: '80px' }}
                              />
                            )
                          )}
                          {isCurrentPDF && (
                            <div className="relative w-full h-full flex items-center justify-center">
                              {getPdfThumbnail(obj.path) ? (
                                <img
                                  src={getPdfThumbnail(obj.path)}
                                  alt={obj.name}
                                  className="object-cover"
                                  style={{ width: '80px', height: '80px' }}
                                />
                              ) : (
                                <FileText className="h-8 w-8 text-primary" />
                              )}
                            </div>
                          )}
                          {isCurrentWord && (
                            <FileText className="h-8 w-8 text-blue-500" />
                          )}
                          {isCurrentExcel && (
                            <FileText className="h-8 w-8 text-green-500" />
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Side Panel */}
            <div
              className="w-80 border-l-2 border-primary/50 flex flex-col"
              style={{ backgroundColor: 'hsl(0 0% 15%)' }}
            >
              {/* Header */}
              <div className="p-4 border-b border-border">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <File className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {previewObject.name}
                    </h3>
                  </div>
                  <button
                    onClick={closePreview}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="text-xl">&times;</span>
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="p-4">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Actions:</h4>
                <div className="space-y-1">
                  <button
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors flex items-center gap-3 text-foreground text-sm"
                    onClick={() => {
                      handleDownload(previewObject.path);
                    }}
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </button>
                  <button
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors flex items-center gap-3 text-foreground text-sm"
                    onClick={() => {
                      handleCopy(previewObject);
                      closePreview();
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </button>
                  <button
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors flex items-center gap-3 text-foreground text-sm"
                    onClick={() => {
                      handleCut(previewObject);
                      closePreview();
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    Cut
                  </button>
                  {clipboard && (
                    <button
                      className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors flex items-center gap-3 text-foreground text-sm"
                      onClick={() => {
                        handlePaste();
                        closePreview();
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      Paste
                    </button>
                  )}
                  <div className="border-t border-border my-2" />
                  <button
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-destructive/20 transition-colors flex items-center gap-3 text-destructive text-sm"
                    onClick={() => {
                      handleDelete(previewObject.path, previewObject.type === 'folder');
                      closePreview();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>

              {/* Object Info */}
              <div className="p-4 border-t border-border mt-auto">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">Object Info</h4>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Name:</p>
                    <p className="text-sm text-foreground break-all">{previewObject.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Size:</p>
                    <p className="text-sm text-foreground">{formatFileSize(previewObject.size)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Last Modified:</p>
                    <p className="text-sm text-foreground">
                      {new Date(previewObject.lastModified).toLocaleString()}
                    </p>
                  </div>
                  {previewObject.etag && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">ETAG:</p>
                      <p className="text-xs text-foreground font-mono break-all">{previewObject.etag}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed border-2 border-primary/50 rounded-lg shadow-2xl py-1 z-50 min-w-[180px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            backgroundColor: 'hsl(0 0% 20%)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'object' && contextMenu.object ? (
            <>
              {(isImage(contextMenu.object.name) || isVideo(contextMenu.object.name) || isPDF(contextMenu.object.name) || isWord(contextMenu.object.name) || isExcel(contextMenu.object.name)) && (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                  onClick={() => {
                    handlePreview(contextMenu.object!);
                    setContextMenu(null);
                  }}
                >
                  <Eye className="h-4 w-4" />
                  Preview
                </button>
              )}
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                onClick={() => {
                  handleDownload(contextMenu.object!.path);
                  setContextMenu(null);
                }}
              >
                <Download className="h-4 w-4" />
                Download
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                onClick={() => handleCopy(contextMenu.object!)}
              >
                <Copy className="h-4 w-4" />
                Copy
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                onClick={() => handleCut(contextMenu.object!)}
              >
                <Copy className="h-4 w-4" />
                Cut
              </button>
              {clipboard && (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                  onClick={handlePaste}
                >
                  <Copy className="h-4 w-4" />
                  Paste
                </button>
              )}
              <div className="border-t border-border my-1" />
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-destructive hover:text-destructive-foreground flex items-center gap-2 text-destructive"
                onClick={() => {
                  handleDelete(contextMenu.object!.path, contextMenu.object!.type === 'folder');
                  setContextMenu(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                onClick={() => {
                  setShowCreateFolderModal(true);
                  setContextMenu(null);
                }}
              >
                <FolderPlus className="h-4 w-4" />
                New Folder
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                onClick={() => {
                  document.getElementById('file-upload')?.click();
                  setContextMenu(null);
                }}
              >
                <Upload className="h-4 w-4" />
                Upload Files
              </button>
              {clipboard && (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2 text-foreground"
                  onClick={handlePaste}
                >
                  <Copy className="h-4 w-4" />
                  Paste
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        description={confirmModal.description}
        variant={confirmModal.variant}
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}

// Connection Modal Component
function ConnectionModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'minio' as 'minio' | 's3' | 'azure' | 'gcs',
    endpoint: '',
    port: 9000,
    accessKey: '',
    secretKey: '',
    region: '',
    useSsl: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await storageAPI.createConnection(formData);
      toast.success('Storage connection created');
      onSave();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create connection');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md bg-card border-2 border-primary/30">
        <CardHeader>
          <CardTitle>New Storage Connection</CardTitle>
          <CardDescription>Connect to MinIO, S3, or other object storage</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My MinIO Server"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium">Type</label>
              <select
                className="w-full p-2 border rounded-md bg-card text-foreground"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
              >
                <option value="minio" className="bg-card text-foreground">MinIO</option>
                <option value="s3" className="bg-card text-foreground">Amazon S3</option>
                <option value="azure" className="bg-card text-foreground">Azure Blob</option>
                <option value="gcs" className="bg-card text-foreground">Google Cloud Storage</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">Endpoint</label>
              <Input
                value={formData.endpoint}
                onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                placeholder="localhost"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium">Port</label>
              <Input
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                placeholder="9000"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Access Key</label>
              <Input
                value={formData.accessKey}
                onChange={(e) => setFormData({ ...formData, accessKey: e.target.value })}
                placeholder="minioadmin"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium">Secret Key</label>
              <Input
                type="password"
                value={formData.secretKey}
                onChange={(e) => setFormData({ ...formData, secretKey: e.target.value })}
                placeholder="minioadmin"
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.useSsl}
                onChange={(e) => setFormData({ ...formData, useSsl: e.target.checked })}
                id="use-ssl"
              />
              <label htmlFor="use-ssl" className="text-sm">Use SSL</label>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" className="flex-1">Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// Create Bucket Modal Component
function CreateBucketModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [bucketName, setBucketName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(bucketName);
    setBucketName('');
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <Card className="w-full max-w-md bg-card border-2 border-primary/30">
        <CardHeader>
          <CardTitle>Create Bucket</CardTitle>
          <CardDescription>Enter a name for your new bucket</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Bucket Name</label>
              <Input
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value)}
                placeholder="my-bucket"
                required
                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                title="Bucket name must be lowercase letters, numbers, and hyphens"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Only lowercase letters, numbers, and hyphens
              </p>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" className="flex-1">Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
