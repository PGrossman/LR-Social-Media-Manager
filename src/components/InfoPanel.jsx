import React, { useState, useEffect } from 'react';
import { MapPin, Tag, AlignLeft, Type, Image as ImageIcon, Camera } from 'lucide-react';

export default function InfoPanel({ photo }) {
    const [meta, setMeta] = useState(null);
    const [highResSrc, setHighResSrc] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!photo) return;
        
        let isMounted = true;
        setLoading(true);

        const loadData = async () => {
            // Fetch High-Res Preview (requesting at least 1024px)
            const thumbResult = await window.electronAPI.getThumbnail(photo.image_id, 1024);
            if (isMounted) {
                if (thumbResult?.ok && thumbResult.sourcePath) {
                    setHighResSrc(thumbResult.sourceType === 'base64' ? thumbResult.sourcePath : `lr-media://${thumbResult.sourcePath}`);
                } else {
                    const extMatch = photo.file_name.match(/\.([^.]+)$/);
                    const ext = extMatch ? extMatch[1].toLowerCase() : '';
                    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
                        setHighResSrc(`lr-media://${photo.full_file_path}`);
                    } else {
                        setHighResSrc(null);
                    }
                }
            }

            // Fetch Metadata
            const metaResult = await window.electronAPI.getPhotoMetadata(photo.image_id);
            if (isMounted) setMeta(metaResult);
            if (isMounted) setLoading(false);
        };

        loadData();
        return () => { isMounted = false; };
    }, [photo]);

    if (!photo) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6 text-center">
                <ImageIcon size={48} className="mb-4 opacity-20" />
                <p className="text-sm">Select an image to view details and metadata.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-y-auto custom-scrollbar bg-gray-50 dark:bg-gray-800/50 border-l border-gray-200 dark:border-gray-700 w-80 shrink-0">
            {/* High-Res Image Preview */}
            <div className="w-full bg-gray-100 dark:bg-gray-900 aspect-square flex items-center justify-center overflow-hidden shrink-0 border-b border-gray-200 dark:border-gray-700 p-4">
                {loading ? (
                    <div className="animate-pulse w-full h-full bg-gray-200 dark:bg-gray-800" />
                ) : highResSrc ? (
                    <img src={highResSrc} alt={photo.file_name} className="w-full h-full object-contain" />
                ) : (
                    <span className="text-xs text-gray-400">No Preview</span>
                )}
            </div>

            {/* File Name */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-gray-200 truncate" title={photo.file_name}>{photo.file_name}</h3>
                <p className="text-xs text-gray-500 mt-1 truncate" title={photo.folder_path}>/{photo.folder_path}</p>
            </div>

            {/* Metadata Sections */}
            {meta && (
                <div className="p-4 space-y-6">
                    {/* Title, Caption & Description */}
                    <div className="space-y-4">
                        {/* 1. Title */}
                        <div>
                            <div className="flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                <Type size={12} className="mr-1.5" /> Title
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{meta.title || '--'}</p>
                        </div>
                        
                        {/* 2. Caption (Short) */}
                        <div>
                            <div className="flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                <AlignLeft size={12} className="mr-1.5" /> Caption
                            </div>
                            <p className="text-sm text-gray-800 dark:text-gray-200 italic">{meta.caption || '--'}</p>
                        </div>

                        {/* 3. Description (Long) */}
                        <div>
                            <div className="flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                <AlignLeft size={12} className="mr-1.5" /> Description
                            </div>
                            <p className="text-sm text-gray-700 dark:text-gray-300 text-pretty leading-relaxed">{meta.description || '--'}</p>
                        </div>
                    </div>

                    {/* Keywords */}
                    <div>
                        <div className="flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                            <Tag size={12} className="mr-1.5" /> Keywords
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {meta.keywords.length > 0 ? meta.keywords.map((kw, i) => (
                                <span key={i} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
                                    {kw}
                                </span>
                            )) : <span className="text-sm text-gray-400">--</span>}
                        </div>
                    </div>

                    {/* Location Data */}
                    <div>
                        <div className="flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                            <MapPin size={12} className="mr-1.5" /> Location
                        </div>
                        <div className="space-y-1.5 text-sm text-gray-800 dark:text-gray-200">
                            {meta.location && <p><span className="text-gray-500">Loc:</span> {meta.location}</p>}
                            {meta.city && <p><span className="text-gray-500">City:</span> {meta.city}</p>}
                            {meta.state && <p><span className="text-gray-500">State:</span> {meta.state}</p>}
                            {meta.country && <p><span className="text-gray-500">Country:</span> {meta.country}</p>}
                            {meta.gps && <p className="font-mono text-xs text-blue-600 dark:text-blue-400 mt-1"><span className="text-gray-500 font-sans">GPS:</span> {meta.gps}</p>}
                            {(!meta.location && !meta.city && !meta.state && !meta.country && !meta.gps) && <span className="text-gray-400">--</span>}
                        </div>
                    </div>

                    {/* Camera Settings */}
                    <div>
                        <div className="flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                            <Camera size={12} className="mr-1.5" /> Camera EXIF
                        </div>
                        <div className="space-y-1.5 text-sm text-gray-800 dark:text-gray-200">
                            {meta.camera && <p><span className="text-gray-500">Body:</span> {meta.camera}</p>}
                            {meta.lens && <p><span className="text-gray-500">Lens:</span> {meta.lens}</p>}
                            
                            {/* Group the shooting settings into one line if they exist */}
                            {(meta.focalLength || meta.aperture || meta.iso) && (
                                <p className="font-mono text-xs mt-1 text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-900/50 p-2 rounded">
                                    {meta.focalLength && <span>{meta.focalLength} </span>}
                                    {meta.aperture && <span>&bull; {meta.aperture} </span>}
                                    {meta.iso && <span>&bull; {meta.iso}</span>}
                                </p>
                            )}
                            {(!meta.camera && !meta.lens && !meta.focalLength) && <span className="text-gray-400">--</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
