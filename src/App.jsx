import { useState, useEffect } from 'react';
import Settings from './components/Settings';
import Catalog from './components/Catalog';
import { Settings as SettingsIcon, Image } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState('catalog');
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    // Load initial theme from settings
    window.electronAPI.getSettings().then(settings => {
      setTheme(settings.theme || 'dark');
      if (settings.theme === 'dark') {
         document.documentElement.classList.add('dark');
      } else {
         document.documentElement.classList.remove('dark');
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col font-sans transition-colors duration-200">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 shrink-0 flex items-center justify-between shadow-sm z-10">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">LR Social Media Catalog</h1>
        <div className="flex bg-gray-100 dark:bg-gray-900 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('catalog')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-all duration-200 ${activeTab === 'catalog' ? 'bg-white dark:bg-gray-700 shadow flex-1 text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            <Image size={18} />
            <span className="font-medium">Catalog</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-md transition-all duration-200 ${activeTab === 'settings' ? 'bg-white dark:bg-gray-700 shadow flex-1 text-purple-600 dark:text-purple-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            <SettingsIcon size={18} />
            <span className="font-medium">Settings</span>
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-auto relative">
        <div className="absolute inset-0">
          {activeTab === 'catalog' ? <Catalog /> : <Settings />}
        </div>
      </main>
    </div>
  );
}

export default App;
