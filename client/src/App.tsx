import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Delegations from './pages/Delegations';
import Opportunities from './pages/Opportunities';
import Trades from './pages/Trades';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import StrategyPerformance from './pages/StrategyPerformance';
import ConnectWallet from './pages/ConnectWallet';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/connect" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/connect" element={<ConnectWallet />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="delegations" element={<Delegations />} />
          <Route path="opportunities" element={<Opportunities />} />
          <Route path="trades" element={<Trades />} />
          <Route path="performance" element={<StrategyPerformance />} />
          <Route path="admin" element={<Admin />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
