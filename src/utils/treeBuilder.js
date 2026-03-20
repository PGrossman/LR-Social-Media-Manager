export function buildFolderTree(foldersArray) {
    const root = { children: [] };
    
    // Sort logic to ensure parents come before children
    const sortedFolders = [...foldersArray].sort((a, b) => 
        (a.pathFromRoot || '').localeCompare(b.pathFromRoot || '')
    );

    sortedFolders.forEach(folder => {
        if (!folder.pathFromRoot) return;
        
        // Split by '/' and remove empty parts (e.g., from trailing slashes)
        const parts = folder.pathFromRoot.split('/').filter(p => p !== '');
        if (parts.length === 0) return;
        
        let currentNode = root;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            
            let childNode = currentNode.children.find(c => c.name === part);
            
            if (!childNode) {
                childNode = {
                    name: part,
                    children: [],
                    // Only assign id if it's the exact folder path
                    id: isLast ? folder.id_local : null 
                };
                currentNode.children.push(childNode);
            } else if (isLast) {
                // If it already exists (from a child's path), assign the true ID now
                childNode.id = folder.id_local;
            }
            
            currentNode = childNode;
        }
    });

    return root.children;
}
