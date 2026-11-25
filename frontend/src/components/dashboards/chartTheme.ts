// Shared chart styling for Recharts, from the Xenia theme tokens (no hex values here).
import { createElement } from 'react'
// Recharts draws SVG and needs real color strings, so we read the CSS variables that
// @theme in index.css defines.

export function themeColor(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim()
}

// Categorical series colors, always in this order. At most 4 per chart (team decision P1a:
// the first four pass the colorblind checks; the 5th/6th are too close to each other).
export const seriesColor = (index: number) => themeColor(`chart-${(index % 4) + 1}`)

// Axis and grid: quiet, so the data stands out.
export const axisProps = () => ({
  tick: { fill: themeColor('fg-muted'), fontSize: 12 },
  axisLine: { stroke: themeColor('line') },
  tickLine: false,
})

export const gridProps = () => ({ stroke: themeColor('line'), vertical: false })

export const tooltipProps = () => ({
  contentStyle: {
    background: themeColor('surface-2'),
    border: `1px solid ${themeColor('line-strong')}`,
    borderRadius: 12,
    color: themeColor('fg'),
  },
  labelStyle: { color: themeColor('fg'), fontWeight: 600 },
  itemStyle: { color: themeColor('fg-soft') },
  cursor: { fill: themeColor('surface-2'), opacity: 0.6 },
})

// Legend text stays in a text color; only the small marker next to it carries the series
// color (dataviz rule: never write labels in the series color).
export const legendProps = () => ({
  wrapperStyle: { fontSize: 13 },
  formatter: (value: string) => createElement('span', { style: { color: themeColor('fg-soft') } }, value),
})

// Rounded data-end on bars (4 px), flat where the bar meets the axis.
export const BAR_RADIUS_UP: [number, number, number, number] = [4, 4, 0, 0]
export const BAR_RADIUS_RIGHT: [number, number, number, number] = [0, 4, 4, 0]

// "2026-11" -> "Nov", "2026-11-23" -> "Nov 23"
export function shortMonth(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })
}
export function shortDay(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
