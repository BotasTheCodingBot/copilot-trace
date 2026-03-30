import { describe, expect, it } from 'vitest'
import { buildTraceTree, collectExpandedIds, diffTraceObjects, edgeLabelForTrace, findTracePath, flattenTraceTree } from './traceTreeUtils'
import type { Trace } from '../types'

const makeTrace = (overrides: Partial<Trace>): Trace => ({
  id: overrides.id ?? 'trace',
  session_id: overrides.session_id ?? 'session-1',
  timestamp: overrides.timestamp ?? '2026-03-30T00:00:00Z',
  type: overrides.type ?? 'USER_MESSAGE',
  function: overrides.function ?? 'message',
  ...overrides,
})

describe('traceTreeUtils', () => {
  it('builds parent-child relationships and marks orphan roots', () => {
    const traces = [
      makeTrace({ id: 'root', sequence: 1 }),
      makeTrace({ id: 'child', type: 'TOOL_CALL', function: 'tool', parent_trace_id: 'root', sequence: 2 }),
      makeTrace({ id: 'orphan', type: 'TOOL_RESULT', function: 'result', parent_trace_id: 'missing', sequence: 3 }),
    ]

    const roots = buildTraceTree(traces)

    expect(roots.map((node) => node.trace.id)).toEqual(['root', 'orphan'])
    expect(roots[0].children.map((node) => node.trace.id)).toEqual(['child'])
    expect(roots[1].missingParent).toBe(true)
  })

  it('collects every expandable branch id', () => {
    const roots = buildTraceTree([
      makeTrace({ id: 'a', sequence: 1 }),
      makeTrace({ id: 'b', parent_trace_id: 'a', sequence: 2 }),
      makeTrace({ id: 'c', parent_trace_id: 'b', sequence: 3 }),
    ])

    expect(Array.from(collectExpandedIds(roots)).sort()).toEqual(['a', 'b'])
  })

  it('derives readable edge labels from explicit parent reasons or trace type', () => {
    expect(edgeLabelForTrace(makeTrace({ type: 'TOOL_CALL', function: 'tool' }))).toBe('invokes')
    expect(edgeLabelForTrace(makeTrace({ type: 'TOOL_RESULT', function: 'tool_result' }))).toBe('returns')
    expect(edgeLabelForTrace(makeTrace({ type: 'ASSISTANT_MESSAGE', parent_reason: 'follow_up' }))).toBe('follow up')
  })

  it('flattens tree nodes in traversal order and returns the selected path', () => {
    const roots = buildTraceTree([
      makeTrace({ id: 'a', sequence: 1 }),
      makeTrace({ id: 'b', parent_trace_id: 'a', sequence: 2 }),
      makeTrace({ id: 'c', parent_trace_id: 'b', sequence: 3 }),
      makeTrace({ id: 'd', sequence: 4 }),
    ])

    expect(flattenTraceTree(roots).map((node) => `${node.id}:${node.depth}`)).toEqual(['a:0', 'b:1', 'c:2', 'd:0'])
    expect(findTracePath(roots, 'c')).toEqual(['a', 'b', 'c'])
    expect(findTracePath(roots, 'missing')).toEqual([])
  })

  it('diffs nested trace payloads with readable paths', () => {
    const diffs = diffTraceObjects(
      { a: 1, nested: { state: 'ok', tags: ['x', 'y'] } },
      { a: 2, nested: { state: 'warn', tags: ['x', 'z'] } },
    )

    expect(diffs).toEqual([
      { path: 'a', left: 1, right: 2 },
      { path: 'nested.state', left: 'ok', right: 'warn' },
      { path: 'nested.tags[1]', left: 'y', right: 'z' },
    ])
  })
})
