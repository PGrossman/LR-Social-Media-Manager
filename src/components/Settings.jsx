import { useState, useEffect } from 'react';
import { Save, FolderX, Moon, Sun, Key, Database, RefreshCw, EyeOff } from 'lucide-react';

export default function Settings() {
  const [settings, setSettings] = useState({
    lrDbPath: '',
    geminiApiToken: '',
    theme: 'dark',
    thumbnailSize: 200,
    excludedFolderPaths: []
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings);
  }, []);

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    const newSettings = await window.electronAPI.saveSettings(settings);
    setSettings(newSettings);
    
    // Apply theme immediately
    if (newSettings.theme === 'dark') {
       document.documentElement.classList.add('dark');
    } else {
       document.documentElement.classList.remove('dark');
    }
    
    setTimeout(() => setSaving(false), 500);
  };

  const removeExcludedFolder = async (folderPath) => {
     await window.electronAPI.setFolderVisibility(folderPath, true);
     const updatedSettings = await window.electronAPI.getSettings();
     setSettings(updatedSettings);
  };

  const handleBrowse = async () => {
    const filePath = await window.electronAPI.selectLrcatFile();
    if (filePath) {
      handleChange('lrDbPath', filePath);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8 pb-20 fade-in">
      <h2 className="text-3xl font-extrabold mb-8 tracking-tight text-gray-900 dark:text-gray-50">Application Settings</h2>
      
      <div className="space-y-8 bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50">
        
        {/* LR DB Path */}
        <div className="group">
          <label className="flex items-center space-x-2 text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">
            <Database size={18} className="text-blue-500" />
            <span>Lightroom Catalog Path (.lrcat)</span>
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={settings.lrDbPath}
              onChange={(e) => handleChange('lrDbPath', e.target.value)}
              placeholder="/Users/name/Pictures/Lightroom/Lightroom Catalog.lrcat"
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900/50 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all duration-200"
            />
            <button
              onClick={handleBrowse}
              className="px-6 py-3 shrink-0 rounded-xl bg-transparent border border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:text-blue-400 font-medium transition-colors cursor-pointer"
            >
              Browse...
            </button>
          </div>
        </div>

        {/* Gemini API Key */}
        <div className="group">
          <label className="flex items-center space-x-2 text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">
            <Key size={18} className="text-purple-500" />
            <span>Gemini API Token</span>
          </label>
          <input
            type="password"
            value={settings.geminiApiToken}
            onChange={(e) => handleChange('geminiApiToken', e.target.value)}
            placeholder="AIzaSy..."
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-900/50 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none transition-all duration-200 font-mono text-sm"
          />
        </div>

        {/* Theme Toggle */}
        <div className="flex items-center justify-between py-4 border-y border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center space-x-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <div className="p-2 rounded-lg bg-yellow-100 dark:bg-indigo-900/50 text-yellow-600 dark:text-indigo-400">
               {settings.theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            </div>
            <span>Application Theme</span>
          </div>
          <button
            onClick={() => handleChange('theme', settings.theme === 'dark' ? 'light' : 'dark')}
            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${settings.theme === 'dark' ? 'bg-indigo-500' : 'bg-gray-300'}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-300 ease-in-out ${settings.theme === 'dark' ? 'translate-x-8' : 'translate-x-1'}`}
            />
          </button>
        </div>

        {/* Thumbnail Size */}
        <div className="py-2">
           <label className="flex items-center justify-between text-sm font-semibold mb-4 text-gray-700 dark:text-gray-300">
             <span>Default Thumbnail Size</span>
             <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-md text-blue-600 dark:text-blue-400">{settings.thumbnailSize}px</span>
           </label>
           <input 
              type="range"
              min="100"
              max="600"
              step="10"
              value={settings.thumbnailSize}
              onChange={(e) => handleChange('thumbnailSize', parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-600 transition-all"
           />
           <div className="flex justify-between text-xs text-gray-400 mt-2 px-1">
             <span>Small (100px)</span>
             <span>Large (600px)</span>
           </div>
        </div>

        {/* Save Button */}
        <div className="pt-6 flex justify-end">
           <button
             onClick={handleSave}
             disabled={saving}
             className={`flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium rounded-xl shadow-md transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none`}
           >
             <Save size={18} className={saving ? 'animate-pulse' : ''} />
             <span>{saving ? 'Saved successfully!' : 'Save Settings'}</span>
           </button>
        </div>
      </div>

      <h3 className="text-xl font-bold mt-12 mb-6 flex items-center space-x-3 text-gray-900 dark:text-gray-100">
        <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/30 text-rose-500">
           <FolderX size={20} />
        </div>
        <span>Excluded Folders</span>
      </h3>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700/50 overflow-hidden text-sm transition-all duration-200 p-6">
        <div className="space-y-3">
           {!settings.excludedFolderPaths || settings.excludedFolderPaths.length === 0 ? (
              <p className="text-sm text-gray-500 italic bg-gray-50 dark:bg-gray-900/50 rounded-xl px-4 py-3 border border-gray-100 dark:border-gray-800">
                 No folders are currently hidden. You can hide folders using the context menu in the Catalog tab.
              </p>
           ) : (
              settings.excludedFolderPaths.map(folderPath => (
                 <div key={folderPath} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl">
                    <span className="text-sm font-mono text-gray-600 dark:text-gray-400 truncate pr-4">/{folderPath}</span>
                    <button 
                       onClick={() => removeExcludedFolder(folderPath)}
                       className="flex items-center space-x-1 text-xs font-semibold px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors shrink-0"
                    >
                       <RefreshCw size={14} />
                       <span>Restore</span>
                    </button>
                 </div>
              ))
           )}
        </div>
      </div>

    </div>
  );
}
