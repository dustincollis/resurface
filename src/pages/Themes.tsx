import ThemeAnalysis from '../components/ThemeAnalysis'

// Hosts the on-demand thematic analysis. Lives at /themes rather than as
// a top section on /ideas because the existing /ideas page is a two-panel
// layout (cluster navigator + cluster detail) that doesn't have room to
// host a wide analysis surface without fighting itself. Easy to relocate
// later — the work lives in <ThemeAnalysis />, this is just the route shell.

export default function Themes() {
  return (
    <div className="mx-auto max-w-3xl">
      <ThemeAnalysis />
    </div>
  )
}
