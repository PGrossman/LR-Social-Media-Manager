import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';

function FolderNode({ node, depth, onSelectFolder, selectedFolderId }) {
    const [isOpen, setIsOpen] = useState(false);
    
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedFolderId === node.id && node.id !== null;

    const handleToggle = (e) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    const handleClick = () => {
        if (node.id !== null) {
            onSelectFolder(node.id);
        } else if (hasChildren) {
            setIsOpen(!isOpen);
        }
    };

    return (
        <div>
            <div 
                className={`flex items-center py-1.5 px-2 cursor-pointer select-none rounded-md transition-colors ${
                    isSelected ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
                style={{ paddingLeft: `${(depth * 1) + 0.5}rem` }}
                onClick={handleClick}
            >
                <div 
                    className="w-5 h-5 flex items-center justify-center shrink-0 mr-1 opacity-70 hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                    onClick={hasChildren ? handleToggle : undefined}
                >
                    {hasChildren ? (
                        isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                    ) : (
                        <div className="w-4" /> // Spacer
                    )}
                </div>
                
                <div className="mr-2 opacity-80 shrink-0">
                    {isOpen && hasChildren ? <FolderOpen size={16} className="text-blue-500" /> : <Folder size={16} className={hasChildren ? 'text-blue-500' : 'text-gray-400'} />}
                </div>
                
                <span className={`text-sm truncate font-medium ${isSelected ? 'font-semibold' : ''}`} title={node.name}>
                    {node.name || 'Root'}
                </span>
            </div>
            
            {isOpen && hasChildren && (
                <div>
                    {node.children.map((child, index) => (
                        <FolderNode 
                            key={`${child.id || index}-${child.name}`} 
                            node={child} 
                            depth={depth + 1} 
                            onSelectFolder={onSelectFolder}
                            selectedFolderId={selectedFolderId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function FolderTree({ data, onSelectFolder, selectedFolderId }) {
    if (!data || data.length === 0) {
        return <div className="p-4 text-sm text-gray-500 italic text-center">No folders found.</div>;
    }

    return (
        <div className="w-full h-full overflow-y-auto custom-scrollbar pr-2 pb-8">
            {data.map((node, index) => (
                <FolderNode 
                    key={`${node.id || index}-${node.name}`} 
                    node={node} 
                    depth={0} 
                    onSelectFolder={onSelectFolder}
                    selectedFolderId={selectedFolderId}
                />
            ))}
        </div>
    );
}
