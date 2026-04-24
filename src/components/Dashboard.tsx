import { useState } from 'react';
import { User, ActiveView } from '../types';
import Header from './Header';
import AgentDashboard from './agent_dashboard/AgentDashboard';
import AgentSidebar from './agent_dashboard/AgentSidebar';
import ManagerDashboard from './manager_dashboard/ManagerDashboard';
import ManagerSidebar from './manager_dashboard/ManagerSidebar';
import AgentCallHistory from './agent_dashboard/AgentCallHistory';
import ManagerCallHistory from './manager_dashboard/ManagerCallHistory';
import ManagerAgents from './manager_dashboard/ManagerAgents';
import ManagerAnalytics from './manager_dashboard/ManagerAnalytics';

interface DashboardProps {
  user: User;
  onLogout: () => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

export default function Dashboard({ user, onLogout, isDarkMode, toggleDarkMode }: DashboardProps) {
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const getRoleView = () => {
    return user.role === 'agent' ? 'agent' : 'manager';
  };

  const roleView = getRoleView();

  const renderContent = () => {
    if (roleView === 'agent') {
      switch (activeView) {
        case 'home':
          return <AgentDashboard user={user} isDarkMode={isDarkMode} />;
        case 'call-history':
          return <AgentCallHistory user={user} isDarkMode={isDarkMode} />;
        case 'settings':
          return (
            <div className={`rounded-xl shadow-sm border p-8 ${
              isDarkMode 
                ? 'bg-gray-800 border-gray-700 text-white' 
                : 'bg-white border-gray-100 text-gray-600'
            }`}>
              <div className="text-center py-12">
                {activeView.charAt(0).toUpperCase() + activeView.slice(1)} view coming soon
              </div>
            </div>
          );
        default:
          return <AgentDashboard user={user} isDarkMode={isDarkMode} />;
      }
    } else {
      // Manager views (similar pattern)
      switch (activeView) {
        case 'home':
          return <ManagerDashboard user={user} isDarkMode={isDarkMode} />;
        case 'call-history':
          return <ManagerCallHistory setActiveView={setActiveView} user={user} isDarkMode={isDarkMode} />;
        case 'agents':
          return <ManagerAgents user={user} isDarkMode={isDarkMode} />;
        case 'analytics':
          return <ManagerAnalytics user={user} isDarkMode={isDarkMode}/>;
        case 'settings':
          return (
            <div className={`rounded-xl shadow-sm border p-8 ${
              isDarkMode 
                ? 'bg-gray-800 border-gray-700 text-white' 
                : 'bg-white border-gray-100 text-gray-600'
            }`}>
              <div className="text-center py-12">
                {activeView.charAt(0).toUpperCase() + activeView.slice(1)} view coming soon
              </div>
            </div>
          );
        default:
          return <ManagerDashboard user={user} isDarkMode={isDarkMode} />;
      }
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'
    }`}>
      <Header user={user} setSidebarOpen={setSidebarOpen} isDarkMode={isDarkMode} />
      <div className="flex">
        {roleView === 'agent' ? (
          <AgentSidebar
            activeView={activeView}
            setActiveView={setActiveView}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            onLogout={onLogout}
            isDarkMode={isDarkMode}
            toggleDarkMode={toggleDarkMode}
          />
        ) : (
          <ManagerSidebar
            activeView={activeView}
            setActiveView={setActiveView}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            onLogout={onLogout}
            isDarkMode={isDarkMode} // Pass isDarkMode here
            toggleDarkMode={toggleDarkMode} // Pass toggleDarkMode here
          />
        )}

        <main 
          id="dashboard-container" 
          className={`flex-1 p-6 lg:p-8 overflow-y-auto transition-opacity duration-300 ${
            isDarkMode ? 'bg-gray-900' : 'bg-gray-50'
          }`}
        >
          {renderContent()}
        </main>
      </div>
    </div>
  );
}