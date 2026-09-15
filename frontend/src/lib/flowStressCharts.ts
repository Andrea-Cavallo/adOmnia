import type { StepStats, StressStats } from '@/lib/flowStressStats'
import type { StressHistoryEntry } from '@/lib/flowStressHistory'

export interface ChartPoint {
  x: number
  y: number
  value: number
  label: string
}

export interface TimelineChartModel {
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number; width: number; height: number }
  requestMax: number
  errorRateMax: number
  requestPoints: ChartPoint[]
  errorRatePoints: ChartPoint[]
  xTicks: Array<{ x: number; label: string }>
  requestTicks: Array<{ y: number; label: string }>
  errorTicks: Array<{ y: number; label: string }>
}

export interface LatencyChartRow {
  step: StepStats
  y: number
  p50X: number
  p95X: number
  p99X: number
}

export interface LatencyChartModel {
  width: number
  height: number
  plot: { left: number; right: number; top: number; bottom: number; width: number; height: number }
  maxMs: number
  ticks: Array<{ x: number; label: string }>
  rows: LatencyChartRow[]
  thresholdX?: number
}

export interface WorkloadChartModel {
  width: number
  height: number
  plot: TimelineChartModel['plot']
  maxVus: number
  points: ChartPoint[]
  ticks: Array<{ y: number; label: string }>
  xTicks: Array<{ x: number; label: string }>
}

export interface DistributionChartModel {
  width: number
  height: number
  plot: TimelineChartModel['plot']
  bars: Array<{ x: number; y: number; width: number; height: number; label: string; value: number }>
  ticks: Array<{ y: number; label: string }>
}

export interface TrendChartModel {
  width: number
  height: number
  plot: TimelineChartModel['plot']
  p95Points: ChartPoint[]
  rpsPoints: ChartPoint[]
  p95Max: number
  rpsMax: number
}

export function niceScaleMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

const tickIndexes = (length: number) => [...new Set([0, Math.round((length - 1) * 0.25), Math.round((length - 1) * 0.5), Math.round((length - 1) * 0.75), length - 1])]
const pointsString = (points: ChartPoint[]) => points.map((point) => `${point.x},${point.y}`).join(' ')

export function chartPoints(points: ChartPoint[]): string {
  return pointsString(points)
}

export function timelineChartModel(timeline: StressStats['timeline'], width = 720, height = 190): TimelineChartModel {
  const plot = { left: 46, right: 48, top: 20, bottom: 30, width: width - 94, height: height - 50 }
  const requestMax = niceScaleMax(Math.max(1, ...timeline.map((point) => point.requests)))
  const peakErrorRate = Math.max(0, ...timeline.map((point) => point.requests ? (point.errors / point.requests) * 100 : 0))
  const errorRateMax = Math.min(100, niceScaleMax(Math.max(5, peakErrorRate)))
  const firstSecond = timeline[0]?.s ?? 0
  const lastSecond = timeline[timeline.length - 1]?.s ?? firstSecond
  const span = Math.max(1, lastSecond - firstSecond)
  const xFor = (second: number) => plot.left + ((second - firstSecond) / span) * plot.width
  const requestY = (value: number) => plot.top + plot.height - (value / requestMax) * plot.height
  const errorY = (value: number) => plot.top + plot.height - (value / errorRateMax) * plot.height
  const requestPoints = timeline.map((point) => ({ x: xFor(point.s), y: requestY(point.requests), value: point.requests, label: `${point.s}s: ${point.requests} req/s` }))
  const errorRatePoints = timeline.map((point) => {
    const value = point.requests ? Math.round((point.errors / point.requests) * 1000) / 10 : 0
    return { x: xFor(point.s), y: errorY(value), value, label: `${point.s}s: ${value}% errors (${point.errors}/${point.requests})` }
  })
  const fractions = [0, 0.25, 0.5, 0.75, 1]
  return {
    width,
    height,
    plot,
    requestMax,
    errorRateMax,
    requestPoints,
    errorRatePoints,
    xTicks: tickIndexes(timeline.length).map((index) => ({ x: xFor(timeline[index]?.s ?? 0), label: `${timeline[index]?.s ?? 0}s` })),
    requestTicks: fractions.map((fraction) => ({ y: plot.top + plot.height * (1 - fraction), label: String(Math.round(requestMax * fraction * 10) / 10) })),
    errorTicks: fractions.map((fraction) => ({ y: plot.top + plot.height * (1 - fraction), label: `${Math.round(errorRateMax * fraction)}%` })),
  }
}

export function latencyChartModel(steps: StepStats[], maxP95Ms = 0, width = 720): LatencyChartModel {
  const top = 26
  const bottom = 28
  const rowHeight = 32
  const height = top + bottom + Math.max(1, steps.length) * rowHeight
  const plot = { left: 176, right: 42, top, bottom, width: width - 218, height: Math.max(1, steps.length) * rowHeight }
  const maxObserved = Math.max(1, maxP95Ms, ...steps.map((step) => step.p99))
  const maxMs = niceScaleMax(maxObserved)
  const xFor = (value: number) => plot.left + (Math.min(maxMs, Math.max(0, value)) / maxMs) * plot.width
  return {
    width,
    height,
    plot,
    maxMs,
    ticks: [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({ x: plot.left + plot.width * fraction, label: `${Math.round(maxMs * fraction)} ms` })),
    rows: steps.map((step, index) => ({ step, y: top + index * rowHeight + rowHeight / 2, p50X: xFor(step.p50), p95X: xFor(step.p95), p99X: xFor(step.p99) })),
    thresholdX: maxP95Ms > 0 ? xFor(maxP95Ms) : undefined,
  }
}

export function workloadChartModel(timeline: StressStats['timeline'], width = 720, height = 150): WorkloadChartModel {
  const plot = { left: 46, right: 20, top: 16, bottom: 30, width: width - 66, height: height - 46 }
  const maxVus = niceScaleMax(Math.max(1, ...timeline.map((point) => point.activeVus ?? 0)))
  const firstSecond = timeline[0]?.s ?? 0
  const lastSecond = timeline[timeline.length - 1]?.s ?? firstSecond
  const span = Math.max(1, lastSecond - firstSecond)
  const xFor = (second: number) => plot.left + ((second - firstSecond) / span) * plot.width
  const yFor = (value: number) => plot.top + plot.height - (value / maxVus) * plot.height
  return {
    width, height, plot, maxVus,
    points: timeline.map((point) => ({ x: xFor(point.s), y: yFor(point.activeVus ?? 0), value: point.activeVus ?? 0, label: `${point.s}s: ${point.activeVus ?? 0} active VUs` })),
    ticks: [0, 0.5, 1].map((fraction) => ({ y: plot.top + plot.height * (1 - fraction), label: String(Math.round(maxVus * fraction)) })),
    xTicks: tickIndexes(timeline.length).map((index) => ({ x: xFor(timeline[index]?.s ?? 0), label: `${timeline[index]?.s ?? 0}s` })),
  }
}

export function distributionChartModel(distribution: StressStats['distribution'], width = 720, height = 190): DistributionChartModel {
  const plot = { left: 46, right: 20, top: 16, bottom: 42, width: width - 66, height: height - 58 }
  const maxPct = niceScaleMax(Math.max(1, ...distribution.map((bin) => bin.percentage)))
  const slot = plot.width / Math.max(1, distribution.length)
  return {
    width, height, plot,
    bars: distribution.map((bin, index) => {
      const barHeight = (bin.percentage / maxPct) * plot.height
      const range = bin.overflow ? `>${bin.fromMs} ms` : `${bin.fromMs}–${bin.toMs} ms`
      return { x: plot.left + index * slot + 2, y: plot.top + plot.height - barHeight, width: Math.max(2, slot - 4), height: barHeight, label: `${range}: ${bin.count} requests (${bin.percentage}%)`, value: bin.percentage }
    }),
    ticks: [0, 0.5, 1].map((fraction) => ({ y: plot.top + plot.height * (1 - fraction), label: `${Math.round(maxPct * fraction)}%` })),
  }
}

export function trendChartModel(history: StressHistoryEntry[], width = 720, height = 170): TrendChartModel {
  const ordered = [...history].reverse()
  const plot = { left: 46, right: 48, top: 18, bottom: 30, width: width - 94, height: height - 48 }
  const p95Max = niceScaleMax(Math.max(1, ...ordered.map((item) => item.stats.overall.p95)))
  const rpsMax = niceScaleMax(Math.max(1, ...ordered.map((item) => item.stats.rps)))
  const xFor = (index: number) => plot.left + (index / Math.max(1, ordered.length - 1)) * plot.width
  return {
    width, height, plot, p95Max, rpsMax,
    p95Points: ordered.map((item, index) => ({ x: xFor(index), y: plot.top + plot.height - (item.stats.overall.p95 / p95Max) * plot.height, value: item.stats.overall.p95, label: `${item.startedAt.slice(0, 19)}: p95 ${item.stats.overall.p95} ms` })),
    rpsPoints: ordered.map((item, index) => ({ x: xFor(index), y: plot.top + plot.height - (item.stats.rps / rpsMax) * plot.height, value: item.stats.rps, label: `${item.startedAt.slice(0, 19)}: ${item.stats.rps} req/s` })),
  }
}
