import { Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider } from './contexts/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Focus from './pages/Focus'
import Morning from './pages/Morning'
import Add from './pages/Add'
import Analytics from './pages/Analytics'
import Landscape from './pages/Landscape'
import AiCalls from './pages/AiCalls'
import DashRiver from './pages/DashRiver'
import Streams from './pages/Streams'
import StreamDetail from './pages/StreamDetail'
import ItemDetail from './pages/ItemDetail'
import Meetings from './pages/Meetings'
import MeetingDetail from './pages/MeetingDetail'
import Proposals from './pages/Proposals'
import FollowUps from './pages/FollowUps'
import Commitments from './pages/Commitments'
import Pursuits from './pages/Pursuits'
import PursuitDetail from './pages/PursuitDetail'
import Goals from './pages/Goals'
import GoalDetail from './pages/GoalDetail'
import Ideas from './pages/Ideas'
import Themes from './pages/Themes'
import People from './pages/People'
import PersonDetail from './pages/PersonDetail'
import Companies from './pages/Companies'
import CompanyDetail from './pages/CompanyDetail'
import ProposalAnalytics from './pages/ProposalAnalytics'
import Settings from './pages/Settings'
import MicrosoftCallback from './pages/MicrosoftCallback'
import BundleLayout from './components/BundleLayout'
import Events from './pages/Events'
import EventDetail from './pages/EventDetail'
import PreBriefs from './pages/utility/PreBriefs'
import Momentum from './pages/utility/Momentum'
import Quiet from './pages/utility/Quiet'
import Similar from './pages/utility/Similar'

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="morning" element={<Morning />} />
              <Route path="focus" element={<Focus />} />
              <Route path="add" element={<Add />} />
              <Route path="river" element={<DashRiver />} />
              <Route path="streams" element={<Streams />} />
              <Route path="stream/:id" element={<StreamDetail />} />
              <Route path="items/:id" element={<ItemDetail />} />
              <Route path="meetings" element={<Meetings />} />
              <Route path="meetings/:id" element={<MeetingDetail />} />
              <Route path="proposals" element={<Proposals />} />
              <Route path="proposals/analytics" element={<ProposalAnalytics />} />
              <Route path="follow-ups" element={<FollowUps />} />
              <Route path="commitments" element={<Commitments />} />
              <Route path="pursuits" element={<Pursuits />} />
              <Route path="pursuits/:id" element={<PursuitDetail />} />
              <Route path="goals" element={<Goals />} />
              <Route path="goals/:id" element={<GoalDetail />} />
              <Route path="ideas" element={<Ideas />} />
              <Route path="themes" element={<Themes />} />
              <Route path="utility/prebriefs" element={<PreBriefs />} />
              <Route path="utility/momentum" element={<Momentum />} />
              <Route path="utility/quiet" element={<Quiet />} />
              <Route path="utility/similar" element={<Similar />} />
              <Route path="people" element={<People />} />
              <Route path="people/:id" element={<PersonDetail />} />
              <Route path="companies" element={<Companies />} />
              <Route path="companies/:id" element={<CompanyDetail />} />
              <Route path="settings" element={<Settings />} />
              <Route path="settings/analytics" element={<Analytics />} />
              <Route path="settings/analytics/landscape" element={<Landscape />} />
              <Route path="settings/analytics/ai-calls" element={<AiCalls />} />
              <Route path="auth/microsoft/callback" element={<MicrosoftCallback />} />
            </Route>
            {/* Bundle routes — no sidebar, full viewport */}
            <Route element={<BundleLayout />}>
              <Route path="events" element={<Events />} />
              <Route path="events/:id" element={<EventDetail />} />
            </Route>
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
