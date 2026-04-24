import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import { User } from './types';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Load user from localStorage on first render
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const handleLogin = (loginData: {
    email: string;
    role: 'agent' | 'manager';
    name: string;
    profilePic?: string;
  }) => {
    const newUser: User = {
      uid: Date.now().toString(),
      ...loginData,
    };
    setUser(newUser);
    localStorage.setItem('user', JSON.stringify(newUser)); // persist user
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user'); // clear on logout
  };

  const toggleDarkMode = () => setIsDarkMode((prev) => !prev);

  return (
    <Routes>
      {/* Root route: login or redirect if already logged in */}
      <Route
        path="/"
        element={
          user ? (
            <Navigate
              to={user.role === 'agent' ? '/agent-dashboard' : '/manager-dashboard'}
              replace
            />
          ) : (
            <LoginPage onLogin={handleLogin} />
          )
        }
      />

      {/* Agent dashboard */}
      <Route
        path="/agent-dashboard"
        element={
          user?.role === 'agent' ? (
            <Dashboard
              user={user}
              onLogout={handleLogout}
              isDarkMode={isDarkMode}
              toggleDarkMode={toggleDarkMode}
            />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />

      {/* Manager dashboard */}
      <Route
        path="/manager-dashboard"
        element={
          user?.role === 'manager' ? (
            <Dashboard
              user={user}
              onLogout={handleLogout}
              isDarkMode={isDarkMode}
              toggleDarkMode={toggleDarkMode}
            />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />

      {/* Catch-all route */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;