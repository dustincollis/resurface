import { Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './contexts/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Streams from './pages/Streams'
import StreamDetail from './pages/StreamDetail'
import ItemDetail from './pages/ItemDetail'
import Meetings from './pages/Meetings'
import MeetingDetail from './pages/MeetingDetail'
import Proposals from './pages/Proposals'
import Commitments from './pages/Commitments'
import Pursuits from './pages/Pursuits'
import PursuitDetail from './pages/PursuitDetail'
import Goals from './pages/Goals'
import GoalDetail from './pages/GoalDetail'
import Settings from './pages/Settings'
import MicrosoftCallback from './pages/MicrosoftCallback'

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="streams" element={<Streams />} />
              <Route path="stream/:id" element={<StreamDetail />} />
              <Route path="items/:id" element={<ItemDetail />} />
              <Route path="meetings" element={<Meetings />} />
              <Route path="meetings/:id" element={<MeetingDetail />} />
              <Route path="proposals" element={<Proposals />} />
              <Route path="commitments" element={<Commitments />} />
              <Route path="pursuits" element={<Pursuits />} />
              <Route path="pursuits/:id" element={<PursuitDetail />} />
              <Route path="goals" element={<Goals />} />
              <Route path="goals/:id" element={<GoalDetail />} />
              <Route path="settings" element={<Settings />} />
              <Route path="auth/microsoft/callback" element={<MicrosoftCallback />} />
            </Route>
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
