import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Divider,
  IconButton,
  Paper,
  Slider,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import AccountTreeRoundedIcon from '@mui/icons-material/AccountTreeRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import UnfoldLessRoundedIcon from '@mui/icons-material/UnfoldLessRounded'
import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded'
import type { Trace } from '../types'
import {
  buildTraceTree,
  collectExpandedIds,
  edgeLabelForTrace,
  findTracePath,
  flattenTraceTree,
  type TreeNode,
} from './traceTreeUtils'

interface Props {
  traces: Trace[]
  selectedTraceId: string | null
  onSelect: (traceId: string) => void
  title?: string
}

const toneForType = (type: string) => {
  switch (type) {
    case 'USER_MESSAGE': return { fg: '#9cc4ff', bg: 'rgba(86,139,255,0.12)', border: 'rgba(86,139,255,0.3)' }
    case 'ASSISTANT_MESSAGE': return { fg: '#8be0b8', bg: 'rgba(86,214,151,0.12)', border: 'rgba(86,214,151,0.3)' }
    case 'TOOL_CALL': return { fg: '#f6c453', bg: 'rgba(246,196,83,0.12)', border: 'rgba(246,196,83,0.28)' }
    case 'TOOL_RESULT': return { fg: '#c9a8ff', bg: 'rgba(159,122,234,0.12)', border: 'rgba(159,122,234,0.3)' }
    default: return { fg: '#d6dcf5', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' }
  }
}

const safeSummary = (trace: Trace) => String(trace.text ?? trace.state ?? trace.description ?? trace.function ?? trace.id)
const zoomLabel = (zoom: number) => `${Math.round(zoom * 100)}%`

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function TreeBranch({
  node,
  depth,
  selectedTraceId,
  onSelect,
  expandedIds,
  onToggle,
  nodeRefs,
}: {
  node: TreeNode
  depth: number
  selectedTraceId: string | null
  onSelect: (traceId: string) => void
  expandedIds: Set<string>
  onToggle: (traceId: string) => void
  nodeRefs: MutableRefObject<Map<string, HTMLDivElement>>
}) {
  const trace = node.trace
  const tone = toneForType(trace.type)
  const isSelected = trace.id === selectedTraceId
  const hasChildren = node.children.length > 0
  const isExpanded = hasChildren ? expandedIds.has(trace.id) : false
  const edgeLabel = edgeLabelForTrace(trace)

  return (
    <Box
      ref={(element: HTMLDivElement | null) => {
        if (!element) nodeRefs.current.delete(trace.id)
        else nodeRefs.current.set(trace.id, element)
      }}
      sx={{ position: 'relative' }}
    >
      {depth > 0 ? (
        <>
          <Box sx={{ position: 'absolute', left: -18, top: -10, bottom: '50%', width: 14, borderLeft: '1px solid rgba(160,185,255,0.18)', borderBottom: '1px solid rgba(160,185,255,0.18)' }} />
          {edgeLabel ? (
            <Chip
              size="small"
              label={edgeLabel}
              sx={{
                position: 'absolute',
                left: -8,
                top: 10,
                zIndex: 1,
                height: 20,
                fontSize: '0.65rem',
                color: 'rgba(220,228,255,0.86)',
                background: 'rgba(9,14,28,0.96)',
                border: '1px solid rgba(160,185,255,0.18)',
              }}
            />
          ) : null}
        </>
      ) : null}
      <Stack direction="row" spacing={1} alignItems="stretch">
        {hasChildren ? (
          <IconButton
            size="small"
            aria-label={isExpanded ? 'Collapse branch' : 'Expand branch'}
            onClick={() => onToggle(trace.id)}
            sx={{
              alignSelf: 'center',
              color: 'rgba(228,235,255,0.72)',
              border: '1px solid rgba(160,185,255,0.18)',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            {isExpanded ? <KeyboardArrowDownRoundedIcon fontSize="small" /> : <KeyboardArrowRightRoundedIcon fontSize="small" />}
          </IconButton>
        ) : <Box sx={{ width: 34, flexShrink: 0 }} />}

        <ButtonBase
          onClick={() => onSelect(trace.id)}
          sx={{
            width: '100%',
            display: 'block',
            textAlign: 'left',
            borderRadius: 2,
            mb: 1,
            p: 1.25,
            background: isSelected ? 'linear-gradient(135deg, rgba(125,211,167,0.16), rgba(159,122,234,0.12))' : 'rgba(255,255,255,0.025)',
            border: isSelected ? '1px solid rgba(125,211,167,0.32)' : `1px solid ${tone.border}`,
          }}
        >
          <Stack spacing={0.9}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip size="small" label={trace.type} sx={{ color: tone.fg, background: tone.bg, border: `1px solid ${tone.border}` }} />
              <Typography variant="body2" fontWeight={700}>{trace.function}</Typography>
              <Typography variant="caption" sx={{ color: 'rgba(228,235,255,0.58)' }}>#{trace.sequence ?? '—'}</Typography>
              {node.missingParent ? <Chip size="small" label="orphaned" variant="outlined" /> : null}
              {hasChildren ? <Chip size="small" label={`${node.children.length} child${node.children.length === 1 ? '' : 'ren'}`} variant="outlined" /> : null}
            </Stack>
            <Tooltip title={safeSummary(trace)} placement="top-start">
              <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.7)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {safeSummary(trace)}
              </Typography>
            </Tooltip>
          </Stack>
        </ButtonBase>
      </Stack>

      {hasChildren && isExpanded ? (
        <Box sx={{ ml: 3, pl: 1.75, borderLeft: '1px solid rgba(160,185,255,0.14)' }}>
          {node.children.map((child) => (
            <TreeBranch
              key={child.trace.id}
              node={child}
              depth={depth + 1}
              selectedTraceId={selectedTraceId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggle={onToggle}
              nodeRefs={nodeRefs}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

export default function TraceTree({ traces, selectedTraceId, onSelect, title = 'Trace tree' }: Props) {
  const roots = useMemo(() => buildTraceTree(traces), [traces])
  const orphanCount = useMemo(() => roots.filter((node) => node.missingParent).length, [roots])
  const defaultExpanded = useMemo(() => collectExpandedIds(roots), [roots])
  const flatNodes = useMemo(() => flattenTraceTree(roots), [roots])
  const selectedPath = useMemo(() => findTracePath(roots, selectedTraceId), [roots, selectedTraceId])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(defaultExpanded)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    setExpandedIds(defaultExpanded)
  }, [defaultExpanded])

  useEffect(() => {
    if (!selectedTraceId) return
    const element = nodeRefs.current.get(selectedTraceId)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  }, [selectedTraceId, expandedIds])

  const toggleNode = (traceId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(traceId)) next.delete(traceId)
      else next.add(traceId)
      return next
    })
  }

  const setAllExpanded = (expanded: boolean) => setExpandedIds(expanded ? new Set(defaultExpanded) : new Set())

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || zoom <= 1) return
    const dx = event.clientX - dragRef.current.startX
    const dy = event.clientY - dragRef.current.startY
    setPan({ x: dragRef.current.originX + dx, y: dragRef.current.originY + dy })
  }

  const stopDragging = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event?.currentTarget && event.pointerId != null && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragging(false)
  }

  const changeZoom = (nextZoom: number) => {
    setZoom(nextZoom)
    if (nextZoom <= 1) setPan({ x: 0, y: 0 })
  }

  const exportVisibleTree = () => downloadJson('trace-tree.visible.json', traces)
  const exportSelectedPath = () => {
    if (!selectedPath.length) return
    const selectedPathTraces = selectedPath
      .map((traceId) => traces.find((trace) => trace.id === traceId))
      .filter(Boolean)
    downloadJson('trace-tree.path.json', selectedPathTraces)
  }

  return (
    <Paper elevation={0} sx={{ p: 2, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(160,185,255,0.12)' }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={1} alignItems="center">
            <AccountTreeRoundedIcon fontSize="small" sx={{ color: '#8be0b8' }} />
            <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon fontSize="small" />} onClick={exportVisibleTree}>Export visible</Button>
            <Button size="small" variant="outlined" startIcon={<DownloadRoundedIcon fontSize="small" />} disabled={!selectedPath.length} onClick={exportSelectedPath}>Export path</Button>
            <Tooltip title="Expand all branches"><span><IconButton size="small" onClick={() => setAllExpanded(true)}><UnfoldMoreRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
            <Tooltip title="Collapse all branches"><span><IconButton size="small" onClick={() => setAllExpanded(false)}><UnfoldLessRoundedIcon fontSize="small" /></IconButton></span></Tooltip>
          </Stack>
        </Stack>
        <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)' }}>
          Zoom for dense sessions, drag to pan when magnified, and use the waypoint mini-map to jump between roots or the selected branch without losing context.
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`${traces.length} trace${traces.length === 1 ? '' : 's'}`} variant="outlined" />
          <Chip size="small" label={`${roots.length} root${roots.length === 1 ? '' : 's'}`} variant="outlined" />
          <Chip size="small" label={`Zoom ${zoomLabel(zoom)}`} variant="outlined" />
          {orphanCount ? <Chip size="small" label={`${orphanCount} missing parent`} variant="outlined" /> : null}
          {selectedPath.length ? <Chip size="small" label={`Path depth ${selectedPath.length}`} variant="outlined" /> : null}
        </Stack>

        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="stretch">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Paper elevation={0} sx={{ p: 1.5, mb: 1.5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(160,185,255,0.1)' }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 220 }}>
                  <IconButton size="small" onClick={() => changeZoom(Math.max(0.7, Number((zoom - 0.1).toFixed(2))))}><RemoveRoundedIcon fontSize="small" /></IconButton>
                  <Slider min={0.7} max={1.8} step={0.05} value={zoom} onChange={(_, value) => changeZoom(value as number)} valueLabelDisplay="auto" valueLabelFormat={(value) => zoomLabel(value as number)} sx={{ flex: 1 }} />
                  <IconButton size="small" onClick={() => changeZoom(Math.min(1.8, Number((zoom + 0.1).toFixed(2))))}><AddRoundedIcon fontSize="small" /></IconButton>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button size="small" variant="outlined" startIcon={<RestartAltRoundedIcon fontSize="small" />} onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1) }}>Reset view</Button>
                  <Chip size="small" label={zoom > 1 ? 'Drag enabled' : 'Drag unlocks above 100%'} variant="outlined" />
                </Stack>
              </Stack>
            </Paper>

            <Box
              ref={viewportRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onPointerLeave={stopDragging}
              sx={{
                maxHeight: 680,
                overflow: 'auto',
                pr: 0.5,
                cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
                borderRadius: 2,
                border: '1px solid rgba(160,185,255,0.08)',
                background: 'rgba(6,10,18,0.36)',
              }}
            >
              <Box
                sx={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'top left',
                  transition: dragging ? 'none' : 'transform 120ms ease',
                  minWidth: 'fit-content',
                  p: 1,
                }}
              >
                {roots.length ? roots.map((node) => (
                  <TreeBranch key={node.trace.id} node={node} depth={0} selectedTraceId={selectedTraceId} onSelect={onSelect} expandedIds={expandedIds} onToggle={toggleNode} nodeRefs={nodeRefs} />
                )) : <Typography variant="body2">No traces available for the current filters.</Typography>}
              </Box>
            </Box>
          </Box>

          <Paper elevation={0} sx={{ width: { xs: '100%', lg: 250 }, p: 1.5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(160,185,255,0.1)' }}>
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="subtitle2" fontWeight={700}>Waypoint mini-map</Typography>
                <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)', mt: 0.5 }}>
                  Root branches and the active ancestry stay tappable here, so you can hop around long sessions fast.
                </Typography>
              </Box>
              <Divider />
              <Stack spacing={0.75} sx={{ maxHeight: 620, overflow: 'auto', pr: 0.25 }}>
                {flatNodes.map((item, index) => {
                  const onPath = selectedPath.includes(item.id)
                  const isSelected = item.id === selectedTraceId
                  const color = isSelected ? '#7dd3a7' : onPath ? '#9f7aea' : 'rgba(228,235,255,0.5)'
                  return (
                    <ButtonBase
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      sx={{
                        justifyContent: 'flex-start',
                        borderRadius: 1.5,
                        px: 1,
                        py: 0.75,
                        textAlign: 'left',
                        border: isSelected ? '1px solid rgba(125,211,167,0.3)' : '1px solid rgba(255,255,255,0.04)',
                        background: isSelected ? 'rgba(125,211,167,0.08)' : onPath ? 'rgba(159,122,234,0.08)' : 'transparent',
                      }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                        <Box sx={{ width: 8, alignSelf: 'stretch', borderRadius: 999, background: color, ml: `${item.depth * 8}px`, minHeight: 28 }} />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="caption" sx={{ color: 'rgba(228,235,255,0.52)' }}>#{index + 1} · {item.trace.type}</Typography>
                          <Typography variant="body2" noWrap>{item.trace.function}</Typography>
                        </Box>
                        {item.childCount ? <Chip size="small" label={item.childCount} variant="outlined" /> : null}
                      </Stack>
                    </ButtonBase>
                  )
                })}
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      </Stack>
    </Paper>
  )
}
