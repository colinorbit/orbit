import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import AppLayout from '@/layout/AppLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Donors from '@/pages/Donors';
import Campaigns from '@/pages/Campaigns';
import Analytics from '@/pages/Analytics';
import Agents from '@/pages/Agents';
import Outreach from '@/pages/Outreach';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/donors" element={<Donors />} />
              <Route path="/campaigns" element={<Campaigns />} />
              <Route
                path="/analytics"
                element={
                  <ProtectedRoute requiredRole="manager">
                    <Analytics />
                  </ProtectedRoute>
                }
              />
              <Route path="/agents" element={<Agents />} />
              <Route path="/outreach" element={<Outreach />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
