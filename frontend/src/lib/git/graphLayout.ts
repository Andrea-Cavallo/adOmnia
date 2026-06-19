import type { CommitInfo } from './types'

export const GIT_GRAPH_LANE_START = 22
export const GIT_GRAPH_LANE_GAP = 22

export interface GitGraphLaneLine {
  lane: number
  color: number
}

export interface GitGraphParentEdge {
  fromLane: number
  toLane: number
  color: number
}

export interface GitGraphRowLayout {
  lane: number
  nodeColor: number
  incoming: boolean
  continuations: GitGraphLaneLine[]
  parents: GitGraphParentEdge[]
  isMerge: boolean
}

export interface GitGraphLayout {
  rows: GitGraphRowLayout[]
  laneCount: number
  width: number
}

interface LaneState {
  ref: string
  color: number
}

function sameRef(left: string, right: string): boolean {
  if (!left || !right) return false
  return left === right || left.startsWith(right) || right.startsWith(left)
}

function firstFreeLane(lanes: Array<LaneState | null>, start = 0): number {
  for (let lane = Math.max(0, start); lane < lanes.length; lane++) {
    if (!lanes[lane]) return lane
  }
  return lanes.length
}

function trimTrailingEmptyLanes(lanes: Array<LaneState | null>): void {
  while (lanes.length > 0 && !lanes[lanes.length - 1]) lanes.pop()
}

/** Build stable graph lanes from the real parent relationships in git log order. */
export function buildGitGraphLayout(commits: CommitInfo[]): GitGraphLayout {
  const lanes: Array<LaneState | null> = []
  const rows: GitGraphRowLayout[] = []
  let nextColor = 0
  let laneCount = commits.length ? 1 : 0

  for (const commit of commits) {
    const commitRef = commit.fullHash || commit.hash
    let lane = lanes.findIndex((state) => Boolean(state && sameRef(state.ref, commitRef)))
    const incoming = lane >= 0

    if (lane < 0) {
      lane = firstFreeLane(lanes)
      lanes[lane] = { ref: commitRef, color: nextColor++ }
    }

    const nodeState = lanes[lane]!
    const continuations = lanes.flatMap((state, index) => (
      state && index !== lane ? [{ lane: index, color: state.color }] : []
    ))
    const nextLanes = [...lanes]
    nextLanes[lane] = null
    const parents: GitGraphParentEdge[] = []

    commit.parents.forEach((parentRef, parentIndex) => {
      let targetLane = nextLanes.findIndex((state) => Boolean(state && sameRef(state.ref, parentRef)))

      if (targetLane < 0) {
        targetLane = parentIndex === 0 && !nextLanes[lane]
          ? lane
          : firstFreeLane(nextLanes, lane + 1)
        const color = parentIndex === 0 ? nodeState.color : nextColor++
        nextLanes[targetLane] = { ref: parentRef, color }
      }

      parents.push({
        fromLane: lane,
        toLane: targetLane,
        color: nextLanes[targetLane]!.color,
      })
    })

    const rowMaxLane = Math.max(
      lane,
      ...continuations.map((line) => line.lane),
      ...parents.map((edge) => edge.toLane),
    )
    laneCount = Math.max(laneCount, rowMaxLane + 1)
    rows.push({
      lane,
      nodeColor: nodeState.color,
      incoming,
      continuations,
      parents,
      isMerge: commit.parents.length > 1,
    })

    lanes.splice(0, lanes.length, ...nextLanes)
    trimTrailingEmptyLanes(lanes)
  }

  return {
    rows,
    laneCount,
    width: laneCount === 0 ? 72 : 72 + (laneCount - 1) * GIT_GRAPH_LANE_GAP,
  }
}
