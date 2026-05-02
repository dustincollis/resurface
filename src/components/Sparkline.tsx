interface Props {
  values: number[]
  width?: number
  height?: number
  className?: string
}

export default function Sparkline({
  values,
  width = 120,
  height = 24,
  className,
}: Props) {
  if (values.length === 0) return null

  const max = Math.max(...values, 1)
  const dx = width / Math.max(values.length - 1, 1)
  const points = values
    .map((v, i) => `${(i * dx).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
