import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, MoreVertical, EyeOff } from 'lucide-react';

function FolderNode({ node, depth, onSelectFolder, selectedFolderPath, onHideFolder }) {
    // Auto-expand if the selected folder is at or below this node
    const shouldBeOpen = selectedFolderPath && node.pathFromRoot && selectedFolderPath.startsWith(node.pathFromRoot);
    const [isOpen, setIsOpen] = useState(shouldBeOpen || false);
    const [menuOpen, setMenuOpen] = useState(false);
    
    const hasChildren = node.children && node.children.length > 0;
    const isSelected = selectedFolderPath === node.pathFromRoot && node.pathFromRoot;

    const handleToggle = (e) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    const handleClick = () => {
        onSelectFolder(node);
        if (hasChildren) {
            setIsOpen(!isOpen);
        }
    };

    const handleHide = (e) => {
        e.stopPropagation();
        setMenuOpen(false);
        onHideFolder(node.pathFromRoot);
    };

    return (
        <div>
            <div 
                className={`group relative flex items-center py-1.5 px-2 cursor-pointer select-none rounded-md transition-colors ${
                    isSelected ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                }`}
                style={{ paddingLeft: `${(depth * 1) + 0.5}rem` }}
                onClick={handleClick}
                onMouseLeave={() => setMenuOpen(false)}
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
                
                <span className={`text-sm truncate font-medium flex-1 ${isSelected ? 'font-semibold' : ''}`} title={node.name}>
                    {node.name || 'Root'}
                </span>

                {/* Action Menu Trigger */}
                <div className={`transition-opacity flex items-center shrink-0 ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                        className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        title="Folder Actions"
                    >
                        <MoreVertical size={14} />
                    </button>
                    
                    {/* Context Menu Dropdown */}
                    {menuOpen && (
                        <div className="absolute right-2 top-8 z-50 bg-white dark:bg-gray-800 shadow-xl border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden min-w-[160px] animate-in fade-in zoom-in-95 duration-200">
                            <button 
                                onClick={handleHide}
                                className="w-full text-left px-4 py-2.5 text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 flex items-center gap-2 transition-colors font-medium"
                            >
                                <EyeOff size={14} />
                                Hide folder
                            </button>
                        </div>
                    )}
                </div>
            </div>
            
            {isOpen && hasChildren && (
                <div>
                    {node.children.map((child, index) => (
                        <FolderNode 
                            key={`${child.id || index}-${child.name}`} 
                            node={child} 
                            depth={depth + 1} 
                            onSelectFolder={onSelectFolder}
                            selectedFolderPath={selectedFolderPath}
                            onHideFolder={onHideFolder}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function FolderTree({ data, onSelectFolder, selectedFolderPath, onHideFolder }) {
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
                    selectedFolderPath={selectedFolderPath}
                    onHideFolder={onHideFolder}
                />
            ))}
        </div>
    );
}
