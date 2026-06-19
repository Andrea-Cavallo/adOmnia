import {
  GIT_GRAPH_LANE_GAP,
  GIT_GRAPH_LANE_START,
  type GitGraphRowLayout,
} from '@/lib/git/graphLayout'

const GRAPH_COLORS = [
  'var(--color-accent)',
  'var(--color-warning)',
  '#34d399',
  '#60a5fa',
  '#f472b6',
  '#a78bfa',
]

function graphColor(index: number): string {
  return GRAPH_COLORS[index % GRAPH_COLORS.length]
}

function graphLaneX(lane: number): number {
  return GIT_GRAPH_LANE_START + lane * GIT_GRAPH_LANE_GAP
}

export function GitCommitGraph({ layout, width }: { layout: GitGraphRowLayout; width: number }) {
  const centerY = 29
  const bottomY = 58
  const x = graphLaneX(layout.lane)
  const nodeColor = graphColor(layout.nodeColor)

  return (
    <svg width={width} height="58" viewBox={`0 0 ${width} 58`} className="shrink-0 overflow-visible" aria-hidden="true">
      {layout.continuations.map((line) => (
        <line
          key={`continuation-${line.lane}`}
          x1={graphLaneX(line.lane)}
          y1="0"
          x2={graphLaneX(line.lane)}
          y2={bottomY}
          stroke={graphColor(line.color)}
          strokeWidth="2.25"
          strokeLinecap="round"
          opacity="0.72"
        />
      ))}
      {layout.incoming && (
        <line x1={x} y1="0" x2={x} y2={centerY} stroke={nodeColor} strokeWidth="2.5" strokeLinecap="round" />
      )}
      {layout.parents.map((edge, index) => {
        const targetX = graphLaneX(edge.toLane)
        const color = graphColor(edge.color)
        return edge.fromLane === edge.toLane ? (
          <line key={`parent-${index}`} x1={x} y1={centerY} x2={targetX} y2={bottomY} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        ) : (
          <path
            key={`parent-${index}`}
            d={`M ${x} ${centerY} C ${x} ${centerY + 12}, ${targetX} ${bottomY - 12}, ${targetX} ${bottomY}`}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )
      })}
      {layout.isMerge && <circle cx={x} cy={centerY} r="8.5" fill="var(--color-surface-1)" stroke="var(--color-warning)" strokeWidth="1.5" opacity="0.9" />}
      <circle cx={x} cy={centerY} r="5.5" fill="var(--color-surface-1)" stroke={nodeColor} strokeWidth="2.5" />
      <circle cx={x} cy={centerY} r="2" fill={nodeColor} />
    </svg>
  )
}
