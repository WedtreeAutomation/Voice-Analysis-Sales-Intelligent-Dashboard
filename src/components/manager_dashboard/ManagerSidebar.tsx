import {
  Home,
  Phone,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  Bot,
  Moon,
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { ActiveView } from '../../types';

interface ManagerSidebarProps {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

const managerMenu = [
  { id: 'home' as ActiveView, label: 'Home', icon: Home, color: 'text-blue-600' },
  { id: 'call-history' as ActiveView, label: 'Call History', icon: Phone, color: 'text-green-600' },
  { id: 'agents' as ActiveView, label: 'Agents', icon: Bot, color: 'text-purple-600' },
  { id: 'analytics' as ActiveView, label: 'Analytics', icon: BarChart3, color: 'text-purple-600' },
  { id: 'settings' as ActiveView, label: 'Settings', icon: Settings, color: 'text-gray-600' },
];

export default function ManagerSidebar({
  activeView,
  setActiveView,
  sidebarOpen,
  setSidebarOpen,
  onLogout,
  isDarkMode,
  toggleDarkMode,
}: ManagerSidebarProps) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const dashboardContainer = document.getElementById('dashboard-container');

    if (showLogoutConfirm) {
      if (dashboardContainer) {
        dashboardContainer.classList.add('opacity-50', 'pointer-events-none', 'transition-opacity');
      }
    } else {
      if (dashboardContainer) {
        dashboardContainer.classList.remove('opacity-50', 'pointer-events-none');
      }
    }
  }, [showLogoutConfirm]);

  const handleMenuItemClick = (id: ActiveView) => {
    if (id === 'settings') {
      setShowSettingsDropdown(!showSettingsDropdown);
      return;
    }
    setActiveView(id);
    setSidebarOpen(false);
    setShowSettingsDropdown(false);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    onLogout();
  };

  const handleLogoutClick = () => {
    setShowSettingsDropdown(false);
    onLogout(); // Directly call onLogout without the confirmation step
  };

  const handleDarkModeClick = () => {
    toggleDarkMode();
    setShowSettingsDropdown(false);
  };

  return (
    <>
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className={`rounded-xl p-6 max-w-md w-full shadow-xl ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="flex flex-col space-y-4">
              <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Confirm Logout</h3>
              <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Are you sure you want to log out?</p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className={`px-4 py-2 rounded-lg border transition-colors ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmLogout}
                  className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center space-x-2"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed lg:hidden bottom-4 right-4 z-30 p-3 rounded-full bg-blue-600 text-white shadow-lg"
      >
        <Menu className="h-6 w-6" />
      </button>

      <div
        className={`fixed lg:relative inset-y-0 left-0 z-50 w-72 shadow-md border-r flex flex-col h-screen transform transition-transform duration-300 ease-in-out
          ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-r'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <div className={`hidden lg:flex items-center justify-center p-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-b'}`}>
          <h1 className={`text-xl font-bold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>Manager Dashboard</h1>
        </div>

        <nav className="flex-1 p-6 space-y-2 overflow-y-auto">
          {managerMenu.map(({ id, label, icon: Icon, color }) => {
            const isActive = activeView === id;
            
            return (
              <div key={id} className="relative" ref={id === 'settings' ? settingsRef : null}>
                <button
                  onClick={() => handleMenuItemClick(id)}
                  className={`w-full flex items-center px-4 py-3 rounded-xl transition-colors duration-200
                    ${isActive 
                      ? `${isDarkMode ? 'bg-gray-700 text-white font-medium' : 'bg-blue-50 border border-blue-200 text-blue-700 font-medium'}`
                      : `${isDarkMode ? 'text-gray-300 hover:bg-gray-700' : 'hover:bg-gray-50 text-gray-700'}`
                    }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? (isDarkMode ? 'text-blue-400' : 'text-blue-600') : color}`} />
                  <span className="ml-3">{label}</span>
                </button>
                {showSettingsDropdown && id === 'settings' && (
                  <div className={`absolute top-full mt-2 left-0 w-full rounded-xl shadow-lg border z-50 animate-fade-in-down ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`}>
                    <button
                      onClick={handleDarkModeClick}
                      className={`w-full text-left flex items-center px-4 py-3 transition-colors rounded-t-xl ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
                    >
                      <Moon className={`h-4 w-4 mr-3 ${isDarkMode ? 'text-purple-300' : 'text-purple-600'}`} />
                      <span>{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
                    </button>
                    <button
                      onClick={handleLogoutClick}
                      className={`w-full text-left flex items-center px-4 py-3 text-red-600 font-medium transition-colors rounded-b-xl ${isDarkMode ? 'hover:bg-red-900/40' : 'hover:bg-red-50'}`}
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