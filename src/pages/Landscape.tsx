import { useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, Flag, Handshake, Sparkles, X } from 'lucide-react'
import { useLandscape } from '../hooks/useLandscape'
import { computePriority } from '../lib/priorityScore'
import type { Item, Commitment, Pursuit, Goal } from '../lib/types'

// ============================================================
// Coordinate system
// ============================================================
const VIEW_W = 1000
const VIEW_H = 700
const PAD = { left: 70, right: 40, top: 50, bottom: 70 }
const PLOT_W = VIEW_W - PAD.left - PAD.right
const PLOT_H = VIEW_H - PAD.top - PAD.bottom

const toSvgX = (x: number) => PAD.left + (x / 100) * PLOT_W
const toSvgY = (y: number) => PAD.top + (1 - y / 100) * PLOT_H

// ============================================================
// Data-space position functions (0-100 in each axis)
// ============================================================

function daysUntil(dateStr: string): number {
  const parts = dateStr.split('-').map(Number)
  const dueNoon = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0).getTime()
  const now = new Date()
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime()
  return Math.round((dueNoon - todayNoon) / (1000 * 60 * 60 * 24))
}

function urgencyX(item: Item): number {
  if (item.due_date) {
    const days = daysUntil(item.due_date)
    if (days < 0) return 95
    if (days === 0) return 88
    if (days <= 3) return 75
    if (days <= 7) return 62
    if (days <= 14) return 48
    return 38
  }
  const staleness = item.staleness_score ?? 0
  if (staleness >= 60) return 8
  if (staleness >= 40) return 20
  if (staleness >= 20) return 35
  return 50
}

function effortY(item: Item): number {
  const r = item.resistance ?? 3
  return (r - 1) * 22.5 + 5
}

function dotRadius(item: Item): number {
  const s = item.stakes ?? 3
  return 5 + s * 2
}

function freshnessAlpha(lastTouched: string): number {
  const hours = (Date.now() - new Date(lastTouched).getTime()) / (1000 * 60 * 60)
  if (hours < 24) return 1
  if (hours < 24 * 7) return 0.85
  if (hours < 24 * 30) return 0.65
  return 0.45
}

function commitmentX(c: Commitment): number {
  const dueStr = c.do_by ?? c.promised_by
  if (!dueStr) return 45
  const days = daysUntil(dueStr)
  if (days < 0) return 95
  if (days === 0) return 88
  if (days <= 3) return 75
  if (days <= 7) return 62
  if (days <= 14) return 48
  return 38
}

function commitmentY(c: Commitment): number {
  return c.direction === 'outgoing' ? 58 : 32
}

// Deterministic small jitter so identical coordinates don't stack perfectly
function jitter(id: string): { dx: number; dy: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  const dx = (((h & 0xff) / 255 - 0.5) * 2) * 3
  const dy = ((((h >> 8) & 0xff) / 255 - 0.5) * 2) * 3
  return { dx, dy }
}

// ============================================================
// Convex hull (Andrew's monotone chain) with centroid padding
// ============================================================
type Pt = [number, number]

function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return points
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function padHull(hull: Pt[], padding: number): Pt[] {
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
  return hull.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    const d = Math.hypot(dx, dy) || 1
    return [x + (dx / d) * padding, y + (dy / d) * padding] as Pt
  })
}

interface Shape {
  kind: 'polygon' | 'circle'
  points?: Pt[]
  cx?: number
  cy?: number
  r?: number
  centroid: Pt
}

function shapeFromPoints(points: Pt[], padding: number): Shape | null {
  if (points.length === 0) return null
  if (points.length === 1) {
    return { kind: 'circle', cx: points[0][0], cy: points[0][1], r: padding, centroid: points[0] }
  }
  if (points.length === 2) {
    const cx = (points[0][0] + points[1][0]) / 2
    const cy = (points[0][1] + points[1][1]) / 2
    const d = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1])
    return { kind: 'circle', cx, cy, r: d / 2 + padding, centroid: [cx, cy] }
  }
  const hull = convexHull(points)
  const padded = padHull(hull, padding)
  const cx = padded.reduce((s, p) => s + p[0], 0) / padded.length
  const cy = padded.reduce((s, p) => s + p[1], 0) / padded.length
  return { kind: 'polygon', points: padded, centroid: [cx, cy] }
}

// ============================================================
// Quadrant labels, axes, grid
// ============================================================

function QuadrantLabels() {
  const mid = { x: toSvgX(50), y: toSvgY(50) }
  return (
    <g className="pointer-events-none">
      {/* Center cross */}
      <line
        x1={toSvgX(0)}
        y1={mid.y}
        x2={toSvgX(100)}
        y2={mid.y}
        stroke="#1f2937"
        strokeDasharray="2 4"
      />
      <line
        x1={mid.x}
        y1={toSvgY(0)}
        x2={mid.x}
        y2={toSvgY(100)}
        stroke="#1f2937"
        strokeDasharray="2 4"
      />

      {/* Quadrant labels */}
      <g fill="#4b5563" fontSize="11" fontWeight="600" letterSpacing="0.08em">
        <text x={toSvgX(12)} y={toSvgY(92)}>BACKGROUND</text>
        <text x={toSvgX(12)} y={toSvgY(88)} fontSize="10" fontWeight="400" fill="#374151">
          when you have a minute
        </text>

        <text x={toSvgX(76)} y={toSvgY(92)}>HEAVY &amp; URGENT</text>
        <text x={toSvgX(76)} y={toSvgY(88)} fontSize="10" fontWeight="400" fill="#374151">
          block time
        </text>

        <text x={toSvgX(12)} y={toSvgY(12)}>ROT ZONE</text>
        <text x={toSvgX(12)} y={toSvgY(8)} fontSize="10" fontWeight="400" fill="#374151">
          drop or escalate
        </text>

        <text x={toSvgX(80)} y={toSvgY(12)}>QUICK WINS</text>
        <text x={toSvgX(80)} y={toSvgY(8)} fontSize="10" fontWeight="400" fill="#374151">
          do now
        </text>
      </g>

      {/* Axis labels */}
      <g fill="#6b7280" fontSize="10" letterSpacing="0.12em">
        <text x={toSvgX(0) - 6} y={toSvgY(100) - 18}>↑ HEAVY LIFT</text>
        <text x={toSvgX(0) - 6} y={toSvgY(0) + 26}>↓ QUICK</text>
        <text x={toSvgX(100)} y={toSvgY(0) + 46} textAnchor="end">DUE NOW →</text>
        <text x={toSvgX(0) - 6} y={toSvgY(0) + 46}>← STALE / IGNORED</text>
        <text x={toSvgX(50)} y={toSvgY(0) + 46} textAnchor="middle" fill="#4b5563" fontSize="10" fontWeight="600">
          URGENCY
        </text>
        <text
          x={toSvgX(0) - 34}
          y={toSvgY(50)}
          transform={`rotate(-90 ${toSvgX(0) - 34} ${toSvgY(50)})`}
          textAnchor="middle"
          fill="#4b5563"
          fontSize="10"
          fontWeight="600"
        >
          EFFORT
        </text>
      </g>
    </g>
  )
}

// ============================================================
// Page
// ============================================================

type Hovered =
  | { kind: 'item'; item: Item; x: number; y: number }
  | { kind: 'commitment'; c: Commitment; x: number; y: number }
  | null

export default function Landscape() {
  const { data, isLoading } = useLandscape()
  const navigate = useNavigate()
  const [focusOnly, setFocusOnly] = useState(false)
  const [showPursuits, setShowPursuits] = useState(true)
  const [showGoals, setShowGoals] = useState(true)
  const [showCommitments, setShowCommitments] = useState(true)
  const [selectedPursuit, setSelectedPursuit] = useState<Pursuit | null>(null)
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null)
  const [hovered, setHovered] = useState<Hovered>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const layout = useMemo(() => {
    if (!data) return null

    // Position each item
    const itemPositions = new Map<string, { x: number; y: number; item: Item }>()
    for (const item of data.items) {
      const j = jitter(item.id)
      itemPositions.set(item.id, {
        x: urgencyX(item) + j.dx,
        y: effortY(item) + j.dy,
        item,
      })
    }

    // Position each commitment
    const commitmentPositions = new Map<string, { x: number; y: number; c: Commitment }>()
    for (const c of data.commitments) {
      const j = jitter(c.id)
      commitmentPositions.set(c.id, {
        x: commitmentX(c) + j.dx,
        y: commitmentY(c) + j.dy,
        c,
      })
    }

    // Pursuit → member map (items + commitments only; meetings not plotted)
    const pursuitToItems = new Map<string, string[]>()
    const pursuitToCommitments = new Map<string, string[]>()
    const itemToPursuit = new Map<string, string>()
    const commitmentToPursuit = new Map<string, string>()
    for (const m of data.pursuitMembers) {
      if (m.member_type === 'item') {
        if (!pursuitToItems.has(m.pursuit_id)) pursuitToItems.set(m.pursuit_id, [])
        pursuitToItems.get(m.pursuit_id)!.push(m.member_id)
        itemToPursuit.set(m.member_id, m.pursuit_id)
      } else if (m.member_type === 'commitment') {
        if (!pursuitToCommitments.has(m.pursuit_id)) pursuitToCommitments.set(m.pursuit_id, [])
        pursuitToCommitments.get(m.pursuit_id)!.push(m.member_id)
        commitmentToPursuit.set(m.member_id, m.pursuit_id)
      }
    }

    // Goal → linked entities via goal_tasks.condition_type + linked_entity_id
    const goalToItems = new Map<string, string[]>()
    const goalToCommitments = new Map<string, string[]>()
    const goalToPursuits = new Map<string, string[]>()
    for (const gt of data.goalTasks) {
      if (!gt.linked_entity_id) continue
      if (gt.condition_type === 'item') {
        if (!goalToItems.has(gt.goal_id)) goalToItems.set(gt.goal_id, [])
        goalToItems.get(gt.goal_id)!.push(gt.linked_entity_id)
      } else if (gt.condition_type === 'commitment') {
        if (!goalToCommitments.has(gt.goal_id)) goalToCommitments.set(gt.goal_id, [])
        goalToCommitments.get(gt.goal_id)!.push(gt.linked_entity_id)
      } else if (gt.condition_type === 'pursuit') {
        if (!goalToPursuits.has(gt.goal_id)) goalToPursuits.set(gt.goal_id, [])
        goalToPursuits.get(gt.goal_id)!.push(gt.linked_entity_id)
      }
    }

    // Pursuit shapes (svg-space points, inward padding 22)
    const pursuitShapes = new Map<string, Shape>()
    for (const p of data.pursuits) {
      const points: Pt[] = []
      for (const id of pursuitToItems.get(p.id) ?? []) {
        const pos = itemPositions.get(id)
        if (pos) points.push([toSvgX(pos.x), toSvgY(pos.y)])
      }
      for (const id of pursuitToCommitments.get(p.id) ?? []) {
        const pos = commitmentPositions.get(id)
        if (pos) points.push([toSvgX(pos.x), toSvgY(pos.y)])
      }
      const shape = shapeFromPoints(points, 22)
      if (shape) pursuitShapes.set(p.id, shape)
    }

    // Goal shapes — aggregate direct items + commitments + all members of linked pursuits
    const goalShapes = new Map<string, Shape>()
    for (const g of data.goals) {
      const points: Pt[] = []
      for (const id of goalToItems.get(g.id) ?? []) {
        const pos = itemPositions.get(id)
        if (pos) points.push([toSvgX(pos.x), toSvgY(pos.y)])
      }
      for (const id of goalToCommitments.get(g.id) ?? []) {
        const pos = commitmentPositions.get(id)
        if (pos) points.push([toSvgX(pos.x), toSvgY(pos.y)])
      }
      for (const pid of goalToPursuits.get(g.id) ?? []) {
        for (const iid of pursuitToItems.get(pid) ?? []) {
          const pos = itemPositions.get(iid)
          if (pos) points.push([toSvgX(pos.x), toSvgY(pos.y)])
        }
        for (const cid of pursuitToCommitments.get(pid) ?? []) {
          const pos = commitmentPositions.get(cid)
          if (pos) points.push([toSvgX(pos.x), toSvgY(pos.y)])
        }
      }
      const shape = shapeFromPoints(points, 48)
      if (shape) goalShapes.set(g.id, shape)
    }

    // Focus-10 set (pinned + top 10 by priority)
    const sorted = [...data.items].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return computePriority(b) - computePriority(a)
    })
    const pinned = sorted.filter((i) => i.pinned)
    const remainingSlots = Math.max(10 - pinned.length, 0)
    const focusSet = new Set([
      ...pinned.map((i) => i.id),
      ...sorted.filter((i) => !i.pinned).slice(0, remainingSlots).map((i) => i.id),
    ])

    return {
      itemPositions,
      commitmentPositions,
      pursuitShapes,
      goalShapes,
      itemToPursuit,
      commitmentToPursuit,
      pursuitToItems,
      pursuitToCommitments,
      goalToItems,
      goalToCommitments,
      goalToPursuits,
      focusSet,
    }
  }, [data])

  const pursuitColorById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of data?.pursuits ?? []) m.set(p.id, p.color)
    return m
  }, [data])

  // For selection filtering — which ids should stay visible at full opacity
  const activeFilter = useMemo(() => {
    if (!layout || !data) return null
    if (selectedPursuit) {
      const items = new Set(layout.pursuitToItems.get(selectedPursuit.id) ?? [])
      const commits = new Set(layout.pursuitToCommitments.get(selectedPursuit.id) ?? [])
      return { items, commits }
    }
    if (selectedGoal) {
      const items = new Set<string>(layout.goalToItems.get(selectedGoal.id) ?? [])
      const commits = new Set<string>(layout.goalToCommitments.get(selectedGoal.id) ?? [])
      for (const pid of layout.goalToPursuits.get(selectedGoal.id) ?? []) {
        for (const iid of layout.pursuitToItems.get(pid) ?? []) items.add(iid)
        for (const cid of layout.pursuitToCommitments.get(pid) ?? []) commits.add(cid)
      }
      return { items, commits }
    }
    return null
  }, [layout, data, selectedPursuit, selectedGoal])

  // Mouse → SVG viewBox coords (for tooltip positioning)
  const clientToViewBox = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * VIEW_W
    const y = ((clientY - rect.top) / rect.height) * VIEW_H
    return { x, y }
  }

  if (isLoading || !data || !layout) {
    return <div className="text-sm text-gray-500">Loading landscape...</div>
  }

  const itemCount = data.items.length
  const commitmentCount = data.commitments.length
  const visibleItemCount = focusOnly
    ? [...layout.itemPositions.values()].filter((p) => layout.focusSet.has(p.item.id)).length
    : itemCount

  return (
    <div className="mx-auto max-w-[1400px]">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">The Landscape</h1>
          <p className="text-sm text-gray-500">
            {visibleItemCount} tasks · {showCommitments ? commitmentCount : 0} commitments ·{' '}
            {data.pursuits.length} pursuits · {data.goals.length} goals
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFocusOnly(!focusOnly)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              focusOnly
                ? 'border-blue-600 bg-blue-900/40 text-blue-200'
                : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
            }`}
          >
            <Sparkles size={12} />
            Focus 10 only
          </button>
          <ToggleChip
            active={showPursuits}
            onClick={() => setShowPursuits(!showPursuits)}
            icon={Target}
            label="Pursuits"
          />
          <ToggleChip
            active={showGoals}
            onClick={() => setShowGoals(!showGoals)}
            icon={Flag}
            label="Goals"
          />
          <ToggleChip
            active={showCommitments}
            onClick={() => setShowCommitments(!showCommitments)}
            icon={Handshake}
            label="Commitments"
          />
        </div>
      </div>

      {/* Selected context chip */}
      {(selectedPursuit || selectedGoal) && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            Filtered to
          </span>
          <span
            className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
            style={{
              borderColor: selectedPursuit ? selectedPursuit.color : '#6b7280',
              color: selectedPursuit ? selectedPursuit.color : '#9ca3af',
              backgroundColor: selectedPursuit ? `${selectedPursuit.color}22` : '#1f2937',
            }}
          >
            {selectedPursuit ? <Target size={11} /> : <Flag size={11} />}
            {selectedPursuit?.name ?? selectedGoal?.name}
            <button
              onClick={() => {
                setSelectedPursuit(null)
                setSelectedGoal(null)
              }}
              className="ml-1 rounded hover:bg-gray-800"
            >
              <X size={11} />
            </button>
          </span>
        </div>
      )}

      {/* Canvas */}
      <div className="relative rounded-xl border border-gray-800 bg-gray-950/80">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-[720px] w-full"
          onMouseLeave={() => setHovered(null)}
        >
          {/* Goal territories (back layer) */}
          {showGoals && data.goals.map((g) => {
            const shape = layout.goalShapes.get(g.id)
            if (!shape) return null
            const isSelected = selectedGoal?.id === g.id
            const dim = selectedPursuit || (selectedGoal && !isSelected)
            return (
              <g
                key={g.id}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedPursuit(null)
                  setSelectedGoal(isSelected ? null : g)
                }}
                opacity={dim ? 0.25 : 1}
              >
                {shape.kind === 'polygon' ? (
                  <polygon
                    points={shape.points!.map((p) => p.join(',')).join(' ')}
                    fill="#6366f1"
                    fillOpacity={isSelected ? 0.18 : 0.08}
                    stroke="#6366f1"
                    strokeOpacity={isSelected ? 0.6 : 0.25}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeDasharray="4 4"
                  />
                ) : (
                  <circle
                    cx={shape.cx}
                    cy={shape.cy}
                    r={shape.r}
                    fill="#6366f1"
                    fillOpacity={isSelected ? 0.18 : 0.08}
                    stroke="#6366f1"
                    strokeOpacity={isSelected ? 0.6 : 0.25}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeDasharray="4 4"
                  />
                )}
                <text
                  x={shape.centroid[0]}
                  y={shape.centroid[1] - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="#a5b4fc"
                  className="pointer-events-none"
                  letterSpacing="0.06em"
                >
                  {g.name.toUpperCase()}
                </text>
              </g>
            )
          })}

          {/* Quadrant grid + labels */}
          <QuadrantLabels />

          {/* Pursuit hulls (mid layer) */}
          {showPursuits && data.pursuits.map((p) => {
            const shape = layout.pursuitShapes.get(p.id)
            if (!shape) return null
            const isSelected = selectedPursuit?.id === p.id
            const dim = selectedGoal || (selectedPursuit && !isSelected)
            return (
              <g
                key={p.id}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedGoal(null)
                  setSelectedPursuit(isSelected ? null : p)
                }}
                opacity={dim ? 0.35 : 1}
              >
                {shape.kind === 'polygon' ? (
                  <polygon
                    points={shape.points!.map((pt) => pt.join(',')).join(' ')}
                    fill={p.color}
                    fillOpacity={isSelected ? 0.18 : 0.09}
                    stroke={p.color}
                    strokeOpacity={isSelected ? 0.8 : 0.4}
                    strokeWidth={isSelected ? 2 : 1.25}
                  />
                ) : (
                  <circle
                    cx={shape.cx}
                    cy={shape.cy}
                    r={shape.r}
                    fill={p.color}
                    fillOpacity={isSelected ? 0.18 : 0.09}
                    stroke={p.color}
                    strokeOpacity={isSelected ? 0.8 : 0.4}
                    strokeWidth={isSelected ? 2 : 1.25}
                  />
                )}
                <text
                  x={shape.centroid[0]}
                  y={shape.centroid[1] + 3}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="600"
                  fill={p.color}
                  className="pointer-events-none"
                  opacity={0.85}
                >
                  {p.name}
                </text>
              </g>
            )
          })}

          {/* Items (front layer) */}
          {[...layout.itemPositions.values()].map(({ x, y, item }) => {
            const isFocus = layout.focusSet.has(item.id)
            if (focusOnly && !isFocus) return null
            const pursuitId = layout.itemToPursuit.get(item.id)
            const color = pursuitId ? pursuitColorById.get(pursuitId) ?? '#64748b' : '#64748b'
            const alpha = freshnessAlpha(item.last_touched_at)
            const r = dotRadius(item)
            const cx = toSvgX(x)
            const cy = toSvgY(y)
            const dim = activeFilter ? !activeFilter.items.has(item.id) : false

            return (
              <g
                key={item.id}
                className="cursor-pointer"
                opacity={dim ? 0.12 : 1}
                onMouseEnter={(e) => {
                  const pt = clientToViewBox(e.clientX, e.clientY)
                  setHovered({ kind: 'item', item, x: pt.x, y: pt.y })
                }}
                onMouseMove={(e) => {
                  const pt = clientToViewBox(e.clientX, e.clientY)
                  setHovered({ kind: 'item', item, x: pt.x, y: pt.y })
                }}
                onClick={() => navigate(`/items/${item.id}`)}
              >
                {/* Focus pulsing ring */}
                {isFocus && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r + 5}
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                    opacity={0.7}
                  >
                    <animate
                      attributeName="r"
                      values={`${r + 4};${r + 8};${r + 4}`}
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.8;0.2;0.8"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                {item.pinned && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r + 2}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth={1.5}
                    opacity={0.85}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={color}
                  fillOpacity={alpha}
                  stroke="#0f172a"
                  strokeWidth={1}
                />
              </g>
            )
          })}

          {/* Commitments (front layer, diamond shape) */}
          {showCommitments && [...layout.commitmentPositions.values()].map(({ x, y, c }) => {
            const pursuitId = layout.commitmentToPursuit.get(c.id)
            const color = pursuitId ? pursuitColorById.get(pursuitId) ?? '#a78bfa' : '#a78bfa'
            const cx = toSvgX(x)
            const cy = toSvgY(y)
            const size = 7
            const dim = activeFilter ? !activeFilter.commits.has(c.id) : false

            return (
              <g
                key={c.id}
                className="cursor-pointer"
                opacity={dim ? 0.12 : 1}
                transform={`translate(${cx} ${cy}) rotate(45)`}
                onMouseEnter={(e) => {
                  const pt = clientToViewBox(e.clientX, e.clientY)
                  setHovered({ kind: 'commitment', c, x: pt.x, y: pt.y })
                }}
                onMouseMove={(e) => {
                  const pt = clientToViewBox(e.clientX, e.clientY)
                  setHovered({ kind: 'commitment', c, x: pt.x, y: pt.y })
                }}
                onClick={() => navigate('/commitments')}
              >
                <rect
                  x={-size}
                  y={-size}
                  width={size * 2}
                  height={size * 2}
                  fill={color}
                  fillOpacity={0.85}
                  stroke="#0f172a"
                  strokeWidth={1}
                />
              </g>
            )
          })}

          {/* Tooltip */}
          {hovered && <Tooltip hovered={hovered} />}
        </svg>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 border-t border-gray-800 px-4 py-2.5 text-[11px] text-gray-500">
          <span className="font-semibold uppercase tracking-wider text-gray-600">Legend</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
            <span className="h-3 w-3 rounded-full bg-slate-500" />
            <span className="h-4 w-4 rounded-full bg-slate-500" />
            Low → high stakes
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-500 opacity-100" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-500 opacity-60" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-500 opacity-40" />
            Hot → cold (time since touched)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-blue-400 bg-transparent" />
            Focus 10 (pulsing)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-purple-400" />
            Commitment
          </span>
          <span className="ml-auto text-gray-600">
            Click a dot to open · click a pursuit/goal to filter
          </span>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Small bits
// ============================================================

function ToggleChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Target
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-gray-600 bg-gray-800 text-gray-200'
          : 'border-gray-800 text-gray-600 hover:border-gray-700 hover:text-gray-400'
      }`}
    >
      <Icon size={12} />
      {label}
    </button>
  )
}

function Tooltip({ hovered }: { hovered: NonNullable<Hovered> }) {
  const tipW = 240
  const tipH = hovered.kind === 'item' ? 82 : 68
  // Position offset so the tip doesn't cover the cursor
  let tx = hovered.x + 14
  let ty = hovered.y + 14
  if (tx + tipW > VIEW_W) tx = hovered.x - tipW - 14
  if (ty + tipH > VIEW_H) ty = hovered.y - tipH - 14

  return (
    <g className="pointer-events-none" transform={`translate(${tx} ${ty})`}>
      <rect
        width={tipW}
        height={tipH}
        rx={6}
        fill="#0b1120"
        stroke="#374151"
        strokeWidth={1}
      />
      {hovered.kind === 'item' ? (
        <g>
          <text x={10} y={20} fill="#e5e7eb" fontSize="12" fontWeight="600">
            {truncate(hovered.item.title, 32)}
          </text>
          <text x={10} y={38} fill="#9ca3af" fontSize="11">
            {hovered.item.status.replace('_', ' ')}
            {hovered.item.due_date ? ` · due ${formatDue(hovered.item.due_date)}` : ''}
          </text>
          <text x={10} y={54} fill="#6b7280" fontSize="10">
            stakes {hovered.item.stakes ?? '—'} · resistance {hovered.item.resistance ?? '—'} ·
            staleness {Math.round(hovered.item.staleness_score ?? 0)}
          </text>
          {hovered.item.next_action && (
            <text x={10} y={70} fill="#d1d5db" fontSize="10">
              → {truncate(hovered.item.next_action, 38)}
            </text>
          )}
        </g>
      ) : (
        <g>
          <text x={10} y={20} fill="#e5e7eb" fontSize="12" fontWeight="600">
            {truncate(hovered.c.title, 32)}
          </text>
          <text x={10} y={38} fill="#9ca3af" fontSize="11">
            {hovered.c.direction === 'outgoing' ? 'You owe' : 'Owed to you'}
            {hovered.c.counterpart ? ` · ${hovered.c.counterpart}` : ''}
          </text>
          <text x={10} y={56} fill="#6b7280" fontSize="10">
            {hovered.c.do_by
              ? `do by ${formatDue(hovered.c.do_by)}`
              : hovered.c.promised_by
                ? `promised by ${formatDue(hovered.c.promised_by)}`
                : 'no deadline'}
          </text>
        </g>
      )}
    </g>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function formatDue(dateStr: string): string {
  const d = new Date(dateStr)
  const days = daysUntil(dateStr)
  const base = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (days < 0) return `${base} (${Math.abs(days)}d overdue)`
  if (days === 0) return `${base} (today)`
  if (days <= 7) return `${base} (in ${days}d)`
  return base
}
