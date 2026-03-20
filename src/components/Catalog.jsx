import { useState, useEffect, useCallback } from 'react';
import { EyeOff, RefreshCw, AlertCircle, Image as ImageIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import FolderTree from './FolderTree';
import { buildFolderTree } from '../utils/treeBuilder';
import InfoPanel from './InfoPanel';

function ThumbnailImage({ photo, onLoaded }) {
    const [imgSrc, setImgSrc] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorReason, setErrorReason] = useState(null);
    const [orientation, setOrientation] = useState(null);

    useEffect(() => {
        let isMounted = true;
        
        const fetchThumb = async () => {
            const result = await window.electronAPI.getThumbnail(photo.image_id);
            
            if (isMounted) {
                if (result?.ok && result.sourcePath) {
                    setOrientation(result.orientation);
                    if (result.sourceType === 'base64') {
                        setImgSrc(result.sourcePath);
                    } else {
                        setImgSrc(`lr-media://${result.sourcePath}`);
                    }
                } else {
                    const extMatch = photo.file_name.match(/\.([^.]+)$/);
                    const ext = extMatch ? extMatch[1].toLowerCase() : '';
                    const renderableExts = ['jpg', 'jpeg', 'png', 'webp'];
                    
                    if (renderableExts.includes(ext)) {
                        setImgSrc(`lr-media://${photo.full_file_path}`);
                    } else {
                        setErrorReason(result?.reason || 'Format not renderable natively');
                    }
                }
                setLoading(false);
                if (onLoaded) onLoaded();
            }
        };
        
        fetchThumb();
        return () => { isMounted = false; };
    }, [photo.image_id, photo.full_file_path, photo.file_name]);

    const getRotationStyle = (ori) => {
        if (!ori) return {};
        const strOri = String(ori).toUpperCase();
        if (strOri === '6' || strOri === 'BC') return { transform: 'rotate(90deg)' };
        if (strOri === '3' || strOri === 'CD') return { transform: 'rotate(180deg)' };
        if (strOri === '8' || strOri === 'DA') return { transform: 'rotate(-90deg)' };
        return {};
    };

    if (loading) {
        return (
            <div className="w-full h-full bg-gray-200 dark:bg-gray-800 animate-pulse flex items-center justify-center">
                <ImageIcon size={24} className="text-gray-400 opacity-50" />
            </div>
        );
    }

    if (!imgSrc) {
        return (
            <div className="w-full h-full bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center text-gray-400 p-2 text-center" title={errorReason}>
                <EyeOff size={24} className="mb-2 opacity-30" />
                <span className="text-[10px] uppercase tracking-wider font-semibold">No Preview</span>
            </div>
        );
    }

    return (
        <img 
            src={imgSrc} 
            alt={photo.file_name} 
            style={getRotationStyle(orientation)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy" 
        />
    );
}

export default function Catalog() {
    const [photos, setPhotos] = useState([]);
    const [folderTree, setFolderTree] = useState([]);
    const [selectedFolderIds, setSelectedFolderIds] = useState(null);
    const [selectedFolderPath, setSelectedFolderPath] = useState(null);
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [thumbsLoaded, setThumbsLoaded] = useState(0);
    const [selectedPhoto, setSelectedPhoto] = useState(null);
    const [isRestored, setIsRestored] = useState(false);

    // --- RESIZE LOGIC ---
    const [sidebarWidth, setSidebarWidth] = useState(288);
    const [isResizing, setIsResizing] = useState(false);

    const startResizing = useCallback((e) => {
        setIsResizing(true);
        e.preventDefault();
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((e) => {
        if (isResizing) {
            const newWidth = Math.max(200, Math.min(e.clientX, 600));
            setSidebarWidth(newWidth);
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);
    // --- END RESIZE LOGIC ---

    useEffect(() => {
        setThumbsLoaded(0);
    }, [photos]);

    const handleThumbLoaded = useCallback(() => {
        setThumbsLoaded(prev => prev + 1);
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
           const currentSettings = await window.electronAPI.getSettings();
           setSettings(currentSettings);
           
           if (!currentSettings.lrDbPath) {
               setPhotos([]);
               setFolderTree([]);
               setLoading(false);
               return;
           }

           const excluded = currentSettings.excludedFolderPaths || [];
           
           const [photosData, foldersData] = await Promise.all([
               window.electronAPI.getCatalog(excluded, selectedFolderIds),
               window.electronAPI.getFolderTree(excluded)
           ]);

           setPhotos(photosData);
           setFolderTree(buildFolderTree(foldersData));
           
        } catch (err) {
           setError("Failed to load catalog. Ensure Lightroom path is correct.");
           console.error(err);
        }
        setLoading(false);
    }, [selectedFolderIds]);

    // 1. Initial Mount: Restore saved state from electron-store
    useEffect(() => {
        let isMounted = true;
        window.electronAPI.getSettings().then(currentSettings => {
            if (isMounted) {
                if (currentSettings.lastSelectedFolderPath !== undefined) setSelectedFolderPath(currentSettings.lastSelectedFolderPath);
                if (currentSettings.lastSelectedFolderIds !== undefined) setSelectedFolderIds(currentSettings.lastSelectedFolderIds);
                if (currentSettings.lastSelectedPhoto !== undefined) setSelectedPhoto(currentSettings.lastSelectedPhoto);
                setIsRestored(true);
            }
        });
        return () => { isMounted = false; };
    }, []);

    // 2. Fetch Data whenever selection changes (but only AFTER restore is complete)
    useEffect(() => {
        if (isRestored) {
            loadData();
        }
    }, [isRestored, loadData]);

    // 3. Auto-save State to disk whenever user clicks a folder or photo
    useEffect(() => {
        if (isRestored) {
            window.electronAPI.saveSettings({
                lastSelectedFolderPath: selectedFolderPath,
                lastSelectedFolderIds: selectedFolderIds,
                lastSelectedPhoto: selectedPhoto
            });
        }
    }, [selectedFolderPath, selectedFolderIds, selectedPhoto, isRestored]);

    const handleHideFolder = async (folderPath) => {
        if (!folderPath) return;
        await window.electronAPI.setFolderVisibility(folderPath, false);
        loadData();
    };

    const extractIds = (node) => {
        let ids = [];
        if (node.id !== null) ids.push(node.id);
        if (node.children) {
            node.children.forEach(child => {
                ids = ids.concat(extractIds(child));
            });
        }
        return ids;
    };

    const handleSelectFolder = (node) => {
        setSelectedFolderPath(node.pathFromRoot);
        const ids = extractIds(node);
        setSelectedFolderIds(ids);
    };

    if (error) {
       return (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-rose-500">
             <AlertCircle size={48} className="mb-4 opacity-80" />
             <p className="text-xl font-bold mb-2">Error connecting to database</p>
             <p className="text-rose-400/80 max-w-sm">{error}</p>
          </div>
       );
    }

    const thumbSize = settings?.thumbnailSize || 250;

    return (
        <div className="flex h-full w-full overflow-hidden fade-in">
           {/* Sidebar - Collapsible Folder Tree */}
           <div 
               className={`relative border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col shrink-0 ${isResizing ? '' : 'transition-all duration-300 ease-in-out'} ${sidebarOpen ? 'opacity-100' : 'w-0 opacity-0 overflow-hidden'}`}
               style={{ width: sidebarOpen ? sidebarWidth : 0 }}
           >
               {/* Drag Handle */}
               {sidebarOpen && (
                   <div
                       onMouseDown={startResizing}
                       className="absolute top-0 right-0 bottom-0 w-1.5 cursor-col-resize z-50 hover:bg-blue-500/50 active:bg-blue-500/80 transition-colors"
                       style={{ transform: 'translateX(50%)' }}
                   />
               )}

               <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0 h-[73px]">
                   <h3 className="font-semibold text-gray-700 dark:text-gray-300">Folders</h3>
                   {selectedFolderPath && (
                       <button 
                          onClick={() => {
                              setSelectedFolderPath(null);
                              setSelectedFolderIds(null);
                              setSelectedPhoto(null);
                          }}
                          className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
                       >
                          Clear Selection
                       </button>
                   )}
               </div>
               <div className="flex-1 overflow-hidden">
                   {loading && folderTree.length === 0 ? (
                       <div className="flex justify-center p-6"><RefreshCw size={20} className="animate-spin text-gray-400" /></div>
                   ) : (
                       <FolderTree 
                           data={folderTree} 
                           onSelectFolder={handleSelectFolder} 
                           selectedFolderPath={selectedFolderPath} 
                           onHideFolder={handleHideFolder}
                       />
                   )}
               </div>
           </div>

           {/* Main Content */}
           <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
               {/* Header */}
               <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0 h-[73px] relative">
                   <div className="flex items-center space-x-4">
                       <button 
                           onClick={() => setSidebarOpen(!sidebarOpen)}
                           className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors"
                           title={sidebarOpen ? "Close Sidebar" : "Open Sidebar"}
                       >
                           {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
                       </button>
                       <div>
                         <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                             {selectedFolderPath ? 'Folder Images' : 'Recent Images'}
                         </h2>
                         <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                           Showing {photos.length} photos
                           {photos.length > 0 && thumbsLoaded < photos.length && (
                             <span className="ml-2 text-blue-500 dark:text-blue-400">
                               — Loading {thumbsLoaded}/{photos.length}
                             </span>
                           )}
                         </p>
                       </div>
                   </div>
                   {photos.length > 0 && thumbsLoaded < photos.length && (
                     <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-200 dark:bg-gray-700">
                       <div 
                         className="h-full bg-blue-500 transition-all duration-300 ease-out"
                         style={{ width: `${(thumbsLoaded / photos.length) * 100}%` }}
                       />
                     </div>
                   )}
               </div>
               
               {/* Grid */}
               <div className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
                   {loading && photos.length === 0 && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-500 space-y-4 z-10 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
                         <RefreshCw size={32} className="animate-spin opacity-80" />
                      </div>
                   )}
                   
                   {!loading && photos.length === 0 && !error ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-gray-500 dark:text-gray-400">
                         <div className="p-6 bg-gray-50 dark:bg-gray-800/50 rounded-full mb-6">
                            <ImageIcon size={48} className="opacity-40" />
                         </div>
                         <h3 className="text-xl font-bold mb-2 text-gray-700 dark:text-gray-200">No Photos Found</h3>
                         <p className="text-sm max-w-sm mx-auto leading-relaxed">
                            {selectedFolderPath 
                                ? "There are no images in the selected folder, or they are filtered out."
                                : "Connect your catalog by defining the valid `.lrcat` path in the Settings tab."
                            }
                         </p>
                      </div>
                   ) : (
                       <div 
                          style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`, gap: '1.5rem' }}
                       >
                          {photos.map(photo => (
                              <div key={photo.image_id} onClick={() => setSelectedPhoto(photo)} className="group relative bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-transparent dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-900/50 flex flex-col cursor-pointer">
                                  <div className="aspect-[4/3] bg-gray-100 dark:bg-gray-900 relative overflow-hidden">
                                     <ThumbnailImage photo={photo} onLoaded={handleThumbLoaded} />
                                  </div>
                                  <div className="p-4 flex flex-col border-t border-gray-100 dark:border-gray-700/50">
                                      <p className="text-sm font-semibold truncate text-gray-800 dark:text-gray-200" title={photo.file_name}>
                                          {photo.file_name}
                                      </p>
                                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 truncate font-mono bg-gray-100 w-fit px-2 py-0.5 rounded text-left dark:bg-gray-700/50" title={photo.folder_path}>
                                          /{photo.folder_path}
                                      </p>
                                  </div>
                              </div>
                          ))}
                      </div>
                   )}
               </div>
           </div>
           {/* Right Sidebar - Info Panel */}
           <InfoPanel photo={selectedPhoto} />
        </div>
    );
}
