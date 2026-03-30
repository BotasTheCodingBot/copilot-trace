import type { Trace } from '../types'

export type TreeNode = {
  trace: Trace
  children: TreeNode[]
  missingParent: boolean
}

export type FlattenedTreeNode = {
  id: string
  depth: number
  childCount: number
  missingParent: boolean
  trace: Trace
}

export type TraceDiffEntry = {
  path: string
  left: unknown
  right: unknown
}

export function edgeLabelForTrace(trace: Trace): string | null {
  if (trace.parent_reason === 'message') return 'invokes'
  if (trace.parent_reason === 'tool_call') return 'returns'
  if (trace.parent_reason) return trace.parent_reason.replace(/_/g, ' ')
  if (trace.type === 'TOOL_CALL') return 'invokes'
  if (trace.type === 'TOOL_RESULT') return 'returns'
  return null
}

export function buildTraceTree(traces: Trace[]): TreeNode[] {
  const sorted = [...traces].sort((a, b) => {
    const seqDiff = (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER)
    if (seqDiff !== 0) return seqDiff
    return a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)
  })
  const nodeMap = new Map<string, TreeNode>()
  sorted.forEach((trace) => nodeMap.set(trace.id, { trace, children: [], missingParent: false }))

  const roots: TreeNode[] = []
  for (const trace of sorted) {
    const node = nodeMap.get(trace.id)!
    const parentId = trace.parent_trace_id
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node)
    } else {
      node.missingParent = Boolean(parentId)
      roots.push(node)
    }
  }
  return roots
}

export function collectExpandedIds(roots: TreeNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (node: TreeNode) => {
    if (node.children.length) ids.add(node.trace.id)
    node.children.forEach(walk)
  }
  roots.forEach(walk)
  return ids
}

export function flattenTraceTree(roots: TreeNode[]): FlattenedTreeNode[] {
  const flat: FlattenedTreeNode[] = []
  const walk = (node: TreeNode, depth: number) => {
    flat.push({
      id: node.trace.id,
      depth,
      childCount: node.children.length,
      missingParent: node.missingParent,
      trace: node.trace,
    })
    node.children.forEach((child) => walk(child, depth + 1))
  }
  roots.forEach((root) => walk(root, 0))
  return flat
}

export function findTracePath(roots: TreeNode[], traceId: string | null): string[] {
  if (!traceId) return []
  const stack: string[] = []
  const walk = (node: TreeNode): boolean => {
    stack.push(node.trace.id)
    if (node.trace.id === traceId) return true
    for (const child of node.children) {
      if (walk(child)) return true
    }
    stack.pop()
    return false
  }

  for (const root of roots) {
    if (walk(root)) return [...stack]
    stack.length = 0
  }
  return []
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const stringifyComparable = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function diffTraceObjects(left: unknown, right: unknown, maxEntries = 40): TraceDiffEntry[] {
  const diffs: TraceDiffEntry[] = []

  const visit = (lhs: unknown, rhs: unknown, path: string) => {
    if (diffs.length >= maxEntries) return
    if (stringifyComparable(lhs) === stringifyComparable(rhs)) return

    if (Array.isArray(lhs) && Array.isArray(rhs)) {
      const length = Math.max(lhs.length, rhs.length)
      for (let index = 0; index < length; index += 1) {
        visit(lhs[index], rhs[index], `${path}[${index}]`)
        if (diffs.length >= maxEntries) return
      }
      return
    }

    if (isPlainObject(lhs) && isPlainObject(rhs)) {
      const keys = Array.from(new Set([...Object.keys(lhs), ...Object.keys(rhs)])).sort()
      for (const key of keys) {
        visit(lhs[key], rhs[key], path ? `${path}.${key}` : key)
        if (diffs.length >= maxEntries) return
      }
      return
    }

    diffs.push({
      path: path || 'root',
      left: lhs,
      right: rhs,
    })
  }

  visit(left, right, '')
  return diffs
}
