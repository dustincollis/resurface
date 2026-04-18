import { Link } from 'react-router-dom'
import { Map } from 'lucide-react'

interface AnalyticsTile {
  to: string
  icon: typeof Map
  title: string
  description: string
}

const tiles: AnalyticsTile[] = [
  {
    to: '/settings/analytics/landscape',
    icon: Map,
    title: 'Landscape',
    description:
      '2D canvas of tasks and commitments plotted on Effort × Urgency, with pursuit hulls and goal territories.',
  },
]

export default function Analytics() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Views across your system for orientation and reflection.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ to, icon: Icon, title, description }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-xl border border-gray-800 bg-gray-900/60 p-5 transition-colors hover:border-gray-700 hover:bg-gray-900"
          >
            <div className="flex items-center gap-2 text-gray-300 group-hover:text-white">
              <Icon size={16} />
              <span className="text-sm font-semibold">{title}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">
              {description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
