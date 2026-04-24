import { Menu, User as UserIcon } from 'lucide-react';

interface HeaderProps {
  user: {
    name: string;
    role: "agent" | "manager";
    profilePic?: string;
  };
  setSidebarOpen: (open: boolean) => void;
  isDarkMode: boolean; // Add the new prop here
}

export default function Header({ user, setSidebarOpen, isDarkMode }: HeaderProps) {
  return (
    <header className={`backdrop-blur-sm border-b shadow-lg relative ${isDarkMode ? 'bg-gray-800/95 border-gray-700' : 'bg-white/95 border-slate-200/60'}`}>
      <div className={`absolute inset-0 pointer-events-none ${isDarkMode ? 'bg-gradient-to-r from-blue-900/30 via-indigo-900/20 to-purple-900/30' : 'bg-gradient-to-r from-blue-50/30 via-indigo-50/20 to-purple-50/30'}`}></div>
      <div className="relative flex justify-between items-center px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
        {/* Left - Logo */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          <button
            className={`lg:hidden p-2 rounded-xl active:bg-slate-200/80 transition-all duration-200 hover:scale-105 ${isDarkMode ? 'hover:bg-gray-700/80' : 'hover:bg-slate-100/80'}`}
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar menu"
          >
            <Menu className={`h-6 w-6 ${isDarkMode ? 'text-gray-200' : 'text-slate-700'}`} />
          </button>
          <div className="flex items-center space-x-3">
            <div className="relative">
              <img
                src="/prashanti_logo.png"
                alt="Prashanti Sarees Logo"
                className="h-14 sm:h-16 md:h-18 w-auto drop-shadow-sm"
              />
              <div className={`absolute inset-0 rounded-lg blur-lg -z-10 opacity-60 ${isDarkMode ? 'bg-gradient-to-r from-blue-900/20 to-indigo-900/20' : 'bg-gradient-to-r from-blue-400/20 to-indigo-400/20'}`}></div>
            </div>
          </div>
        </div>

        {/* Center - Title */}
        <div className="hidden sm:flex flex-col items-center justify-center flex-1 max-w-md mx-8">
          <h1 className={`text-lg sm:text-xl lg:text-2xl font-bold bg-clip-text text-transparent text-center ${isDarkMode ? 'bg-gradient-to-r from-gray-100 via-blue-200 to-indigo-200' : 'bg-gradient-to-r from-slate-900 via-blue-800 to-indigo-800'}`}>
            Sales Intelligence Dashboard
          </h1>
          <div className="flex items-center space-x-2 mt-1">
            <div className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-pulse"></div>
            <p className={`text-xs lg:text-sm font-medium ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
              Customer Support Call Analysis
            </p>
            <div className="w-2 h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full animate-pulse"></div>
          </div>
        </div>

        {/* Right - User */}
        <div className="flex items-center space-x-2 sm:space-x-4">
          <div className={`flex items-center space-x-2 sm:space-x-3 pl-2 sm:pl-4 border-l ${isDarkMode ? 'border-gray-700' : 'border-slate-200/60'}`}>
            <div className="relative group cursor-pointer">
              <div className="relative w-9 h-9 sm:w-11 sm:h-11">
                <div className={`absolute inset-0 rounded-full p-0.5 group-hover:shadow-lg transition-all duration-300 ${isDarkMode ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600' : 'bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500'}`}>
                  <div className={`w-full h-full rounded-full flex items-center justify-center overflow-hidden ${isDarkMode ? 'bg-gray-800' : 'bg-gradient-to-br from-blue-50 to-indigo-50'}`}>
                    {user.profilePic ? (
                      <img
                        src={user.profilePic}
                        alt={user.name}
                        className="w-full h-full object-cover rounded-full"
                      />
                    ) : (
                      <UserIcon className={`h-5 w-5 sm:h-6 sm:w-6 ${isDarkMode ? 'text-gray-400' : 'text-blue-700'}`} />
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden sm:block">
              <p className={`text-sm font-semibold capitalize leading-tight ${isDarkMode ? 'text-gray-100' : 'text-slate-800'}`}>
                {user.name}
              </p>
              <p className={`text-xs font-medium capitalize ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                {user.role}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Title */}
      <div className="sm:hidden px-4 pb-3">
        <div className="text-center">
          <h1 className={`text-lg font-bold bg-clip-text text-transparent ${isDarkMode ? 'bg-gradient-to-r from-gray-100 to-gray-400' : 'bg-gradient-to-r from-slate-900 via-blue-800 to-indigo-800'}`}>
            Sales Dashboard
          </h1>
          <p className={`text-xs font-medium mt-1 ${isDarkMode ? 'text-gray-400' : 'text-slate-600'}`}>
            Call Analysis
          </p>
        </div>
      </div>
    </header>
  );
}