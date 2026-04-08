import { Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Streams from './pages/Streams'
import StreamDetail from './pages/StreamDetail'
import ItemDetail from './pages/ItemDetail'
import Meetings from './pages/Meetings'
import MeetingDetail from './pages/MeetingDetail'
import Settings from './pages/Settings'

export default function App() {
  return (
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
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  )
}
