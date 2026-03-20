import { useState, useEffect, useCallback } from 'react';
import { EyeOff, RefreshCw, AlertCircle, Image as ImageIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import FolderTree from './FolderTree';
import { buildFolderTree } from '../utils/treeBuilder';

function ThumbnailImage({ photo }) {
    const [imgSrc, setImgSrc] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        
        const fetchThumb = async () => {
            const result = await window.electronAPI.getThumbnail(photo.image_id);
            
            if (isMounted) {
                if (result?.ok && result.cachedPath) {
                    setImgSrc(`local-img://${result.cachedPath}`);
                } else {
                    const ext = photo.file_name.toLowerCase();
                    if (ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp')) {
                        setImgSrc(`local-img://${photo.full_file_path}`);
                    } else {
                        if (!result?.ok) {
                            console.warn('[LR-PREVIEW] thumbnail unavailable', {
                                imageId: photo.image_id,
                                fileName: photo.file_name,
                                reason: result?.reason,
                                debug: result?.debug
                            });
                        }
                    }
                }
                setLoading(false);
            }
        };
        
        fetchThumb();
        return () => { isMounted = false; };
    }, [photo.image_id, photo.full_file_path, photo.file_name]);

    if (loading) {
        return (
            <div className="w-full h-full bg-gray-200 dark:bg-gray-800 animate-pulse flex items-center justify-center">
                <ImageIcon size={24} className="text-gray-400 opacity-50" />
            </div>
        );
    }

    if (!imgSrc) {
        return (
            <div className="w-full h-full bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center text-gray-400">
                <ImageIcon size={24} className="mb-2 opacity-30" />
                <span className="text-[10px] uppercase tracking-wider font-semibold">No Preview</span>
            </div>
        );
    }

    return (
        <img 
            src={imgSrc} 
            alt={photo.file_name} 
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
           
           // Fetch both photos and folder tree in parallel
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

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleHideFolder = async (folderPath) => {
        if (!folderPath) return; // Ignore if missing path
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
               className={`transition-all duration-300 ease-in-out border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex flex-col ${sidebarOpen ? 'w-72 shrink-0 opacity-100' : 'w-0 opacity-0 overflow-hidden'}`}
           >
               <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0 h-[73px]">
                   <h3 className="font-semibold text-gray-700 dark:text-gray-300">Folders</h3>
                   {selectedFolderPath && (
                       <button 
                          onClick={() => {
                              setSelectedFolderPath(null);
                              setSelectedFolderIds(null);
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

           {/* Main Content - Grid */}
           <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
               {/* Header */}
               <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0 h-[73px]">
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
                         <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Showing {photos.length} photos</p>
                       </div>
                   </div>
                   <button 
                       onClick={loadData} 
                       className="flex items-center space-x-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 rounded-lg shadow-sm hover:shadow dark:hover:bg-gray-700 transition-all active:scale-95 group"
                   >
                       <RefreshCw size={14} className={`group-hover:rotate-180 transition-transform duration-500 ${loading ? 'animate-spin' : ''}`} />
                       <span>Reload</span>
                   </button>
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
                              <div key={photo.image_id} className="group relative bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border border-transparent dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-900/50 flex flex-col">
                                  <div className="aspect-[4/3] bg-gray-100 dark:bg-gray-900 relative overflow-hidden">
                                     <ThumbnailImage photo={photo} />
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
        </div>
    );
}
