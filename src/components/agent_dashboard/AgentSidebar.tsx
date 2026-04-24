import {
  Home,
  Phone,
  Settings,
  LogOut,
  Moon,
  Menu,
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { ActiveView } from '../../types';

interface AgentSidebarProps {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const agentMenu = [
  { id: 'home' as ActiveView, label: 'Home', icon: Home, color: 'text-blue-600' },
  { id: 'call-history' as ActiveView, label: 'Call History', icon: Phone, color: 'text-green-600' },
  { id: 'settings' as ActiveView, label: 'Settings', icon: Settings, color: 'text-gray-600' },
];

export default function AgentSidebar({
  activeView,
  setActiveView,
  sidebarOpen,
  setSidebarOpen,
  onLogout,
  isDarkMode,
  toggleDarkMode,
}: AgentSidebarProps) {
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettingsDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [sidebarOpen]);

  const handleMenuItemClick = (id: ActiveView) => {
    if (id === 'settings') {
      setShowSettingsDropdown(!showSettingsDropdown);
      return;
    }
    setActiveView(id);
    setSidebarOpen(false);
    setShowSettingsDropdown(false);
  };

  const handleLogoutClick = () => {
    setShowSettingsDropdown(false);
    onLogout(); // Directly logs out the user
  };

  const handleDarkModeClick = () => {
    toggleDarkMode();
    setShowSettingsDropdown(false);
  };

  return (
    <>
      {/* Sidebar overlay (mobile only) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile sidebar toggle button */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed lg:hidden bottom-4 right-4 z-30 p-3 rounded-full bg-blue-600 text-white shadow-lg"
      >
        <Menu className="h-6 w-6" />
      </button>

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className={`fixed lg:relative inset-y-0 left-0 z-40 w-72 shadow-md border-r flex flex-col h-screen transform transition-transform duration-300 ease-in-out
          ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-r'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <div
          className={`hidden lg:flex items-center justify-center p-6 border-b ${
            isDarkMode ? 'border-gray-700' : 'border-b'
          }`}
        >
          <h1
            className={`text-xl font-bold ${
              isDarkMode ? 'text-blue-400' : 'text-blue-600'
            }`}
          >
            Agent Dashboard
          </h1>
        </div>

        <nav className="flex-1 p-6 space-y-2 overflow-y-auto">
          {agentMenu.map(({ id, label, icon: Icon, color }) => {
            const isActive = activeView === id;

            return (
              <div
                key={id}
                className="relative"
                ref={id === 'settings' ? settingsRef : null}
              >
                <button
                  onClick={() => handleMenuItemClick(id)}
                  className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors duration-200
                    ${
                      isActive
                        ? `${
                            isDarkMode
                              ? 'bg-gray-700 text-white font-medium'
                              : 'bg-blue-50 border border-blue-200 text-blue-700 font-medium'
                          }`
                        : `${
                            isDarkMode
                              ? 'text-gray-300 hover:bg-gray-700'
                              : 'hover:bg-gray-50 text-gray-700'
                          }`
                    }`}
                >
                  <Icon
                    className={`h-5 w-5 ${
                      isActive
                        ? isDarkMode
                          ? 'text-blue-400'
                          : 'text-blue-600'
                        : color
                    }`}
                  />
                  <span className="ml-3">{label}</span>
                </button>
                {showSettingsDropdown && id === 'settings' && (
                  <div
                    className={`absolute top-full mt-2 left-0 w-full rounded-xl shadow-lg border z-50 animate-fade-in-down ${
                      isDarkMode
                        ? 'bg-gray-700 border-gray-600'
                        : 'bg-white border-gray-200'
                    }`}
                  >
                    <button
                      onClick={handleDarkModeClick}
                      className={`w-full text-left flex items-center px-4 py-3 transition-colors rounded-t-xl ${
                        isDarkMode
                          ? 'text-gray-300 hover:bg-gray-600'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <Moon
                        className={`h-4 w-4 mr-3 ${
                          isDarkMode ? 'text-purple-300' : 'text-purple-600'
                        }`}
                      />
                      <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>
                    <button
                      onClick={handleLogoutClick}
                      className={`w-full text-left flex items-center px-4 py-3 text-red-600 font-medium transition-colors rounded-b-xl ${
                        isDarkMode
                          ? 'hover:bg-red-900/40'
                          : 'hover:bg-red-50'
                      }`}
                    >
                      <LogOut className="h-4 w-4 mr-3" />
                      <span>Logout</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </>
  );
}