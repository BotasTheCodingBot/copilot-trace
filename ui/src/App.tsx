import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AutoGraphRoundedIcon from '@mui/icons-material/AutoGraphRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded'
import TraceVisualizer from './components/TraceVisualizer'
import JsonViewer from './components/JsonViewer'
import type {
  Evaluation,
  EvaluationListResponse,
  EvaluationSessionSummary,
  SessionListResponse,
  Trace,
  TraceBundle,
  TraceListResponse,
  TraceSessionSummary,
} from './types'

const API_BASE = ((import.meta as any).env?.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000'
const SAMPLE_BUNDLE_URL = ((import.meta as any).env?.BASE_URL as string | undefined ?? '/').replace(/\/?$/, '/') + 'traces.sample.json'
const SESSION_PAGE_SIZE = 8
const TRACE_PAGE_SIZE = 25
const EVAL_PAGE_SIZE = 50

type AppPage = 'parser' | 'evaluation' | 'dashboard'

type SampleState = {
  traces: Trace[]
  sessions: TraceSessionSummary[]
  evaluations: Evaluation[]
  evaluationSessions: EvaluationSessionSummary[]
}

const EMPTY_SAMPLE_STATE: SampleState = {
  traces: [],
  sessions: [],
  evaluations: [],
  evaluationSessions: [],
}

const PAGE_META: Array<{ key: AppPage; label: string; description: string; icon: typeof TimelineRoundedIcon; path: string }> = [
  {
    key: 'parser',
    path: '/parser',
    label: 'Parser overview',
    description: 'Session picker, trace filters, pagination, and inspection of the live Copilot event stream.',
    icon: TimelineRoundedIcon,
  },
  {
    key: 'evaluation',
    path: '/evaluation',
    label: 'Evaluation',
    description: 'Quality history, rubric detail, and recent assistant-turn scoring for the active session.',
    icon: AutoGraphRoundedIcon,
  },
  {
    key: 'dashboard',
    path: '/dashboard',
    label: 'Dashboard',
    description: 'Operational readout for coverage, session health, and evaluation signals pulled from the API.',
    icon: DashboardRoundedIcon,
  },
]

const pageForPath = (hashOrPath: string): AppPage => {
  const normalized = hashOrPath.startsWith('#') ? hashOrPath.slice(1) || '/parser' : hashOrPath
  return PAGE_META.find((item) => item.path === normalized)?.key ?? 'parser'
}
const pagePath = (page: AppPage) => PAGE_META.find((item) => item.key === page)?.path ?? '/parser'

const toneForType = (type: string) => {
  switch (type) {
    case 'USER_MESSAGE': return 'primary'
    case 'ASSISTANT_MESSAGE': return 'success'
    case 'TOOL_CALL': return 'warning'
    case 'TOOL_RESULT': return 'secondary'
    default: return 'default'
  }
}

const toneForStatus = (status: string) => {
  switch (status) {
    case 'pass': return 'success'
    case 'warn': return 'warning'
    case 'fail': return 'error'
    default: return 'default'
  }
}

const pct = (value: number | undefined | null) => value == null ? '—' : `${Math.round(value * 100)}%`
const safeText = (trace: Trace) => String(trace.text ?? trace.state ?? trace.description ?? trace.timestamp ?? '')

function toSampleState(bundle: TraceBundle): SampleState {
  const traces = bundle.traces ?? []
  const evaluationSessions = bundle.evaluation_sessions ?? []
  const evaluations = bundle.evaluations ?? []
  const sessions: TraceSessionSummary[] = Array.from(new Set(traces.map((trace) => trace.session_id))).map((session_id) => ({
    session_id,
    trace_count: traces.filter((trace) => trace.session_id === session_id).length,
    first_timestamp: traces.find((trace) => trace.session_id === session_id)?.timestamp ?? '',
    last_timestamp: [...traces].reverse().find((trace) => trace.session_id === session_id)?.timestamp ?? '',
    annotated_count: traces.filter((trace) => trace.session_id === session_id && trace.notes).length,
    evaluation: evaluationSessions.find((item) => item.session_id === session_id),
  }))
  return { traces, sessions, evaluations, evaluationSessions }
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper elevation={0} sx={{ flex: 1, minWidth: 160, p: 1.75, background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025))', border: '1px solid rgba(160,185,255,0.12)', backdropFilter: 'blur(14px)' }}>
      <Typography variant="caption" sx={{ color: '#8be0b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography>
      <Typography variant="h5" fontWeight={700} sx={{ mt: 0.75 }}>{value}</Typography>
      {hint ? <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)', mt: 0.5 }}>{hint}</Typography> : null}
    </Paper>
  )
}

function BarChart({ title, data }: { title: string; data: Array<{ label: string; value: number; tone?: string }> }) {
  const max = Math.max(...data.map((item) => item.value), 1)
  return (
    <Paper elevation={0} sx={{ p: 2, background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.025))', border: '1px solid rgba(160,185,255,0.12)' }}>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>{title}</Typography>
      <Stack spacing={1.25}>
        {data.map((item) => (
          <Box key={item.label}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2">{item.label}</Typography>
              <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)' }}>{item.value}</Typography>
            </Stack>
            <Box sx={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <Box sx={{ height: '100%', width: `${(item.value / max) * 100}%`, background: item.tone ?? 'linear-gradient(90deg, #7dd3a7, #9f7aea)' }} />
            </Box>
          </Box>
        ))}
      </Stack>
    </Paper>
  )
}

function SectionCard({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2.25, background: 'linear-gradient(180deg, rgba(14,20,36,0.92), rgba(8,13,24,0.88))', border: '1px solid rgba(160,185,255,0.11)', boxShadow: '0 20px 48px rgba(0,0,0,0.28)' }}>
      <Stack spacing={2}>
        <Box>
          {eyebrow ? <Typography variant="caption" sx={{ color: '#8be0b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{eyebrow}</Typography> : null}
          <Typography variant="h6" fontWeight={700}>{title}</Typography>
          {description ? <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)', mt: 0.5 }}>{description}</Typography> : null}
        </Box>
        {children}
      </Stack>
    </Paper>
  )
}

export default function App() {
  const [page, setPage] = useState<AppPage>(() => pageForPath(window.location.hash || window.location.pathname))
  const [sampleState, setSampleState] = useState<SampleState>(EMPTY_SAMPLE_STATE)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleReady, setSampleReady] = useState(false)

  const [sessions, setSessions] = useState<TraceSessionSummary[]>([])
  const [sessionsTotal, setSessionsTotal] = useState(0)
  const [sessionPage, setSessionPage] = useState(1)
  const [sessionSearchDraft, setSessionSearchDraft] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [sessionEvalFilter, setSessionEvalFilter] = useState('all')
  const [sessionAnnotatedOnly, setSessionAnnotatedOnly] = useState(false)

  const [traces, setTraces] = useState<Trace[]>([])
  const [tracesTotal, setTracesTotal] = useState(0)
  const [tracePage, setTracePage] = useState(1)
  const [availableTypes, setAvailableTypes] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])

  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [sessionEvaluations, setSessionEvaluations] = useState<EvaluationSessionSummary[]>([])
  const [evaluationStatusFilter, setEvaluationStatusFilter] = useState('all')

  const [selectedSession, setSelectedSession] = useState('')
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [draftSearch, setDraftSearch] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedTag, setSelectedTag] = useState('all')
  const [tagDraft, setTagDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingTraces, setLoadingTraces] = useState(true)
  const [loadingEvaluations, setLoadingEvaluations] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceLabel, setSourceLabel] = useState('live API')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session') ?? ''
    const nextSearch = params.get('search') ?? ''
    const nextType = params.get('type') ?? 'all'
    const nextTag = params.get('tag') ?? 'all'
    const nextEvalStatus = params.get('eval') ?? 'all'
    const nextSessionPage = Number(params.get('sessionPage') ?? '1')
    const nextTracePage = Number(params.get('tracePage') ?? '1')

    setSelectedSession(sessionId)
    setSearch(nextSearch)
    setDraftSearch(nextSearch)
    setSelectedType(nextType)
    setSelectedTag(nextTag)
    setEvaluationStatusFilter(nextEvalStatus)
    setSessionPage(Number.isFinite(nextSessionPage) && nextSessionPage > 0 ? nextSessionPage : 1)
    setTracePage(Number.isFinite(nextTracePage) && nextTracePage > 0 ? nextTracePage : 1)

    const syncRoute = () => setPage(pageForPath(window.location.hash || window.location.pathname))
    window.addEventListener('popstate', syncRoute)
    window.addEventListener('hashchange', syncRoute)
    return () => {
      window.removeEventListener('popstate', syncRoute)
      window.removeEventListener('hashchange', syncRoute)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (selectedSession) params.set('session', selectedSession)
    if (search) params.set('search', search)
    if (selectedType !== 'all') params.set('type', selectedType)
    if (selectedTag !== 'all') params.set('tag', selectedTag)
    if (evaluationStatusFilter !== 'all') params.set('eval', evaluationStatusFilter)
    if (sessionPage > 1) params.set('sessionPage', String(sessionPage))
    if (tracePage > 1) params.set('tracePage', String(tracePage))
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}#${pagePath(page)}`
    window.history.replaceState({}, '', nextUrl)
  }, [page, selectedSession, search, selectedType, selectedTag, evaluationStatusFilter, sessionPage, tracePage])

  const loadSampleState = async (): Promise<SampleState> => {
    if (sampleReady) return sampleState
    setSampleLoading(true)
    try {
      const response = await fetch(SAMPLE_BUNDLE_URL)
      if (!response.ok) throw new Error(`Fallback sample request failed (${response.status})`)
      const payload = await response.json() as TraceBundle
      const nextState = toSampleState(payload)
      setSampleState(nextState)
      setSampleReady(true)
      return nextState
    } finally {
      setSampleLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const loadSessions = async () => {
      setLoadingSessions(true)
      try {
        const params = new URLSearchParams({ limit: String(SESSION_PAGE_SIZE), offset: String((sessionPage - 1) * SESSION_PAGE_SIZE) })
        if (sessionSearch.trim()) params.set('search', sessionSearch.trim())
        if (sessionEvalFilter !== 'all') params.set('has_evaluations', sessionEvalFilter === 'with' ? 'true' : 'false')
        if (sessionAnnotatedOnly) params.set('annotated_only', 'true')
        const [sessionRes, evalSessionRes] = await Promise.all([
          fetch(`${API_BASE}/api/traces/sessions?${params.toString()}`),
          fetch(`${API_BASE}/api/evaluations/sessions`),
        ])
        if (!sessionRes.ok || !evalSessionRes.ok) throw new Error('API did not respond cleanly')
        const sessionPayload = await sessionRes.json() as SessionListResponse
        const evalSessionPayload = await evalSessionRes.json()
        if (cancelled) return
        const nextSessions = sessionPayload.sessions ?? []
        setSessions(nextSessions)
        setSessionsTotal(sessionPayload.total ?? nextSessions.length)
        setSessionEvaluations(evalSessionPayload.sessions as EvaluationSessionSummary[])
        const preferredSession = selectedSession && nextSessions.some((item) => item.session_id === selectedSession)
          ? selectedSession
          : nextSessions[0]?.session_id ?? ''
        setSelectedSession(preferredSession)
        setSourceLabel(`live API · ${API_BASE}`)
        setError(null)
      } catch (err) {
        if (cancelled) return
        const fallback = await loadSampleState()
        let filtered = fallback.sessions
        if (sessionSearch.trim()) filtered = filtered.filter((session) => session.session_id.toLowerCase().includes(sessionSearch.trim().toLowerCase()))
        if (sessionEvalFilter === 'with') filtered = filtered.filter((session) => session.evaluation)
        if (sessionEvalFilter === 'without') filtered = filtered.filter((session) => !session.evaluation)
        if (sessionAnnotatedOnly) filtered = filtered.filter((session) => (session.annotated_count ?? 0) > 0)
        const start = (sessionPage - 1) * SESSION_PAGE_SIZE
        const paged = filtered.slice(start, start + SESSION_PAGE_SIZE)
        setSessions(paged)
        setSessionsTotal(filtered.length)
        setSessionEvaluations(fallback.evaluationSessions)
        setSelectedSession((current) => current || paged[0]?.session_id || '')
        setError(`API unavailable, using bundled sample data. ${(err as Error).message}`)
        setSourceLabel(`sample export fallback · ${SAMPLE_BUNDLE_URL}`)
      } finally {
        if (!cancelled) setLoadingSessions(false)
      }
    }
    loadSessions()
    return () => { cancelled = true }
  }, [sessionPage, sessionSearch, sessionEvalFilter, sessionAnnotatedOnly])

  useEffect(() => {
    if (!selectedSession) return
    let cancelled = false
    const loadTracesAndEvaluations = async () => {
      setLoadingTraces(true)
      setLoadingEvaluations(true)
      try {
        const traceParams = new URLSearchParams({
          session_id: selectedSession,
          limit: String(TRACE_PAGE_SIZE),
          offset: String((tracePage - 1) * TRACE_PAGE_SIZE),
          include_evaluations: 'true',
        })
        if (selectedType !== 'all') traceParams.set('type', selectedType)
        if (selectedTag !== 'all') traceParams.set('tag', selectedTag)
        if (search.trim()) traceParams.set('search', search.trim())

        const evalParams = new URLSearchParams({ session_id: selectedSession, limit: String(EVAL_PAGE_SIZE) })
        if (evaluationStatusFilter !== 'all') evalParams.set('status', evaluationStatusFilter)

        const [traceRes, evalRes] = await Promise.all([
          fetch(`${API_BASE}/api/traces?${traceParams.toString()}`),
          fetch(`${API_BASE}/api/evaluations?${evalParams.toString()}`),
        ])
        if (!traceRes.ok || !evalRes.ok) throw new Error('Trace query failed')
        const tracePayload = await traceRes.json() as TraceListResponse
        const evalPayload = await evalRes.json() as EvaluationListResponse
        if (cancelled) return
        const nextTraces = tracePayload.traces ?? []
        setTraces(nextTraces)
        setTracesTotal(tracePayload.total ?? nextTraces.length)
        setAvailableTypes(tracePayload.available_filters?.types ?? [])
        setAvailableTags(tracePayload.available_filters?.tags ?? [])
        setEvaluations(evalPayload.evaluations ?? tracePayload.evaluations ?? [])
        setSelectedTraceId((current) => nextTraces.some((trace) => trace.id === current) ? current : nextTraces[0]?.id ?? null)
      } catch {
        if (cancelled) return
        const fallback = sampleReady ? sampleState : await loadSampleState()
        const filtered = fallback.traces.filter((trace) => {
          if (trace.session_id !== selectedSession) return false
          if (selectedType !== 'all' && trace.type !== selectedType) return false
          if (selectedTag !== 'all' && !(trace.tags ?? []).includes(selectedTag)) return false
          if (search.trim()) {
            const haystack = JSON.stringify(trace).toLowerCase()
            if (!haystack.includes(search.trim().toLowerCase())) return false
          }
          return true
        })
        const fallbackEvaluations = fallback.evaluations.filter((item) => {
          if (item.session_id !== selectedSession) return false
          if (evaluationStatusFilter !== 'all' && item.status !== evaluationStatusFilter) return false
          return true
        })
        const start = (tracePage - 1) * TRACE_PAGE_SIZE
        const paged = filtered.slice(start, start + TRACE_PAGE_SIZE)
        setTraces(paged)
        setTracesTotal(filtered.length)
        setEvaluations(fallbackEvaluations)
        setAvailableTypes(Array.from(new Set(fallback.traces.filter((trace) => trace.session_id === selectedSession).map((trace) => trace.type))).sort())
        setAvailableTags(Array.from(new Set(fallback.traces.filter((trace) => trace.session_id === selectedSession).flatMap((trace) => trace.tags ?? []))).sort())
        setSelectedTraceId((current) => paged.some((trace) => trace.id === current) ? current : paged[0]?.id ?? null)
      } finally {
        if (!cancelled) {
          setLoadingTraces(false)
          setLoadingEvaluations(false)
        }
      }
    }
    loadTracesAndEvaluations()
    return () => { cancelled = true }
  }, [selectedSession, tracePage, selectedType, selectedTag, search, evaluationStatusFilter, sampleReady])

  useEffect(() => {
    setTracePage(1)
  }, [selectedSession, selectedType, selectedTag, search])

  const selectedTrace = useMemo(() => traces.find((trace) => trace.id === selectedTraceId) ?? traces[0] ?? null, [traces, selectedTraceId])
  useEffect(() => {
    setTagDraft((selectedTrace?.tags ?? []).join(', '))
    setNoteDraft(selectedTrace?.notes ?? '')
  }, [selectedTrace?.id])

  const evaluation = useMemo(() => sessionEvaluations.find((item) => item.session_id === selectedSession), [sessionEvaluations, selectedSession])
  const evaluationByTraceId = useMemo(() => new Map(evaluations.map((item) => [item.target_trace_id, item])), [evaluations])
  const selectedEvaluation = selectedTrace ? evaluationByTraceId.get(selectedTrace.id) : undefined

  const overview = useMemo(() => traces.reduce<Record<string, number>>((acc, trace) => { acc[trace.type] = (acc[trace.type] || 0) + 1; return acc }, {}), [traces])
  const annotatedCount = useMemo(() => traces.filter((trace) => trace.notes?.trim()).length, [traces])
  const chartByType = useMemo(() => Object.entries(overview).map(([label, value]) => ({ label, value })), [overview])
  const chartByTag = useMemo(() => {
    const counts = new Map<string, number>()
    traces.forEach((trace) => (trace.tags ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)))
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value, tone: 'linear-gradient(90deg, #9f7aea, #7dd3a7)' }))
  }, [traces])
  const latestEvaluationHistory = useMemo(() => evaluations.slice(0, 8), [evaluations])
  const sessionCount = sessionsTotal
  const currentPageMeta = PAGE_META.find((item) => item.key === page)!
  const evaluationStatusChart = useMemo(() => {
    const counts = new Map<string, number>()
    evaluations.forEach((item) => counts.set(item.status, (counts.get(item.status) ?? 0) + 1))
    return Array.from(counts.entries()).map(([label, value]) => ({
      label,
      value,
      tone: label === 'pass' ? '#7dd3a7' : label === 'warn' ? '#f6c453' : '#f87171',
    }))
  }, [evaluations])
  const lowScoreEvaluations = useMemo(() => [...evaluations].sort((a, b) => a.score - b.score).slice(0, 5), [evaluations])
  const evaluationCoverage = useMemo(() => {
    const assistantCount = traces.filter((trace) => trace.type === 'ASSISTANT_MESSAGE').length
    return assistantCount ? evaluations.length / assistantCount : 0
  }, [traces, evaluations])

  const navigateToPage = (nextPage: AppPage) => {
    setPage(nextPage)
    window.history.pushState({}, '', `${window.location.pathname}${window.location.search}#${pagePath(nextPage)}`)
  }

  const saveAnnotations = async () => {
    if (!selectedTrace) return
    const tags = tagDraft.split(',').map((item) => item.trim()).filter(Boolean)
    const nextNotes = noteDraft.trim()
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/api/traces/${selectedTrace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, notes: nextNotes }),
      })
      if (!response.ok) throw new Error('PATCH failed')
      const updated = await response.json() as Trace
      setTraces((current) => current.map((trace) => trace.id === updated.id ? updated : trace))
      setSelectedTraceId(updated.id)
      setError(null)
    } catch (err) {
      const updated = { ...selectedTrace, tags, notes: nextNotes }
      setTraces((current) => current.map((trace) => trace.id === updated.id ? updated : trace))
      setError(`Saved only in local UI state because the API write failed. ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const renderParserPage = () => (
    <Stack spacing={3}>
      <SectionCard
        eyebrow="Parser"
        title="Trace review workspace"
        description="Paged queries, sharper hierarchy, and URL-addressable state make this usable as an actual review tool instead of a one-shot prototype."
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Search timeline" size="small" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="function, note, payload text…" fullWidth />
          <TextField select label="Trace type" size="small" value={selectedType} onChange={(event) => setSelectedType(event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="all">All types</MenuItem>
            {availableTypes.map((type) => <MenuItem key={type} value={type}>{type}</MenuItem>)}
          </TextField>
          <TextField select label="Tag" size="small" value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="all">All tags</MenuItem>
            {availableTags.map((tag) => <MenuItem key={tag} value={tag}>{tag}</MenuItem>)}
          </TextField>
          <Button variant="contained" onClick={() => { setTracePage(1); setSearch(draftSearch) }}>Apply</Button>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {Object.entries(overview).map(([type, count]) => (
            <Chip key={type} label={`${type}: ${count}`} color={toneForType(type) as any} variant="outlined" />
          ))}
          {search ? <Chip label={`Search: ${search}`} onDelete={() => { setSearch(''); setDraftSearch('') }} /> : null}
          <Chip label={`Page ${tracePage}/${Math.max(1, Math.ceil(tracesTotal / TRACE_PAGE_SIZE))}`} variant="outlined" />
          <Chip label={`${tracesTotal} total matches`} variant="outlined" />
          <Chip label={`Session ${selectedSession || '—'}`} variant="outlined" />
        </Stack>
      </SectionCard>

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={3} alignItems="stretch">
        <SectionCard title="Trace timeline" description={`${traces.length} traces on this page · ${tracesTotal} matching the current query.`}>
          <List sx={{ maxHeight: 760, overflow: 'auto', py: 0 }}>
            {traces.map((trace) => {
              const traceEval = evaluationByTraceId.get(trace.id)
              return (
                <Box key={trace.id}>
                  <ListItemButton selected={selectedTrace?.id === trace.id} onClick={() => setSelectedTraceId(trace.id)}>
                    <ListItemText
                      primary={`${trace.function} · ${trace.type}`}
                      secondary={safeText(trace).slice(0, 120)}
                    />
                    <Stack alignItems="flex-end" spacing={0.5}>
                      {traceEval ? <Chip size="small" label={pct(traceEval.score)} color={toneForStatus(traceEval.status) as any} variant="outlined" /> : null}
                      {trace.notes ? <Chip size="small" label="note" variant="outlined" /> : null}
                    </Stack>
                  </ListItemButton>
                  <Divider component="li" />
                </Box>
              )
            })}
          </List>
          <Stack direction="row" justifyContent="center">
            <Pagination count={Math.max(1, Math.ceil(tracesTotal / TRACE_PAGE_SIZE))} page={tracePage} onChange={(_, next) => setTracePage(next)} color="primary" />
          </Stack>
        </SectionCard>

        <Stack sx={{ flex: 1.15 }} spacing={3}>
          <SectionCard title="Selected trace" description="Trace payload, annotations, and evaluation context stay together so review work is less annoying.">
            {selectedTrace ? (
              <>
                <Stack direction="row" spacing={1} mb={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={selectedTrace.type} color={toneForType(selectedTrace.type) as any} />
                  <Chip size="small" label={selectedTrace.function} variant="outlined" />
                  <Chip size="small" label={new Date(selectedTrace.timestamp).toLocaleString()} variant="outlined" />
                  {selectedEvaluation ? <Chip size="small" label={`Eval ${pct(selectedEvaluation.score)}`} color={toneForStatus(selectedEvaluation.status) as any} variant="outlined" /> : null}
                </Stack>

                <Paper elevation={0} sx={{ p: 2, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(160,185,255,0.12)' }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>Tags & notes</Typography>
                  <Stack spacing={1.5}>
                    <TextField label="Tags" helperText="Comma-separated. Persisted via PATCH /api/traces/:id." size="small" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} />
                    <TextField label="Notes" multiline minRows={3} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Why this trace matters, what looks risky, or what to revisit later." />
                    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {(selectedTrace.tags ?? []).map((tag) => <Chip key={tag} size="small" label={tag} variant="outlined" />)}
                      </Stack>
                      <Button variant="contained" onClick={saveAnnotations} disabled={saving} startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>Save annotation</Button>
                    </Stack>
                  </Stack>
                </Paper>

                {selectedEvaluation ? (
                  <Paper elevation={0} sx={{ p: 2, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(160,185,255,0.12)' }}>
                    <Stack spacing={1.25}>
                      <Typography variant="subtitle2" fontWeight={700}>Evaluation context</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={selectedEvaluation.label} variant="outlined" />
                        <Chip size="small" label={`Score ${pct(selectedEvaluation.score)}`} color={toneForStatus(selectedEvaluation.status) as any} />
                        {Object.entries(selectedEvaluation.metrics).map(([metric, value]) => (
                          <Chip key={metric} size="small" label={`${metric.replace(/_/g, ' ')} · ${pct(value)}`} variant="outlined" />
                        ))}
                      </Stack>
                      {selectedEvaluation.notes.map((note) => (
                        <Typography key={note} variant="body2" sx={{ color: 'rgba(228,235,255,0.72)' }}>• {note}</Typography>
                      ))}
                    </Stack>
                  </Paper>
                ) : null}

                <TraceVisualizer data={selectedTrace} title="Trace graph" />
                <JsonViewer data={selectedTrace} title="Trace payload" maxHeight={420} />
              </>
            ) : <Typography>No trace selected.</Typography>}
          </SectionCard>
        </Stack>
      </Stack>
    </Stack>
  )

  const renderEvaluationPage = () => (
    <Stack spacing={3}>
      <SectionCard
        eyebrow="Evaluation"
        title="Quality review"
        description="Independent evaluation paging/filtering plus routeable state means the quality view is finally shareable without a ritual of clicking first."
      >
        {evaluation ? (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
              <StatCard label="Average" value={pct(evaluation.average_score)} hint={`${evaluation.evaluation_count} eval runs`} />
              <StatCard label="Latest" value={pct(evaluation.latest_score)} hint={`status: ${evaluation.latest_status}`} />
              <StatCard label="Delta" value={`${evaluation.score_delta >= 0 ? '+' : ''}${pct(evaluation.score_delta)}`} hint={evaluation.improving ? 'trend improving' : 'trend mixed'} />
              <StatCard label="Coverage" value={pct(evaluationCoverage)} hint={`${evaluations.length} visible evals vs assistant turns`} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField select label="Status" size="small" value={evaluationStatusFilter} onChange={(event) => setEvaluationStatusFilter(event.target.value)} sx={{ minWidth: 180 }}>
                <MenuItem value="all">All statuses</MenuItem>
                <MenuItem value="pass">Pass</MenuItem>
                <MenuItem value="warn">Warn</MenuItem>
                <MenuItem value="fail">Fail</MenuItem>
              </TextField>
              <Chip label={`${evaluations.length} evaluations loaded`} variant="outlined" sx={{ alignSelf: 'center' }} />
            </Stack>
            <Stack spacing={1}>
              <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)' }}>Session quality score</Typography>
              <LinearProgress variant="determinate" value={evaluation.average_score * 100} sx={{ height: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            </Stack>
          </Stack>
        ) : (
          <Alert severity="info" variant="outlined">No evaluation runs found for this session yet.</Alert>
        )}
      </SectionCard>

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={3}>
        <Box sx={{ flex: 1 }}>
          <SectionCard title="Status breakdown" description="Fast read on how the current session is grading out.">
            {evaluationStatusChart.length ? <BarChart title="Evaluation status counts" data={evaluationStatusChart} /> : <Alert severity="info" variant="outlined">No status breakdown available yet.</Alert>}
          </SectionCard>
        </Box>

        <Box sx={{ flex: 1.1 }}>
          <SectionCard title="Recent assistant-turn evaluations" description="Latest scored turns for the active session, newest first.">
            {latestEvaluationHistory.length ? (
              <Stack spacing={1.25}>
                {latestEvaluationHistory.map((item) => (
                  <Paper key={item.id} elevation={0} sx={{ p: 1.5, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(160,185,255,0.12)' }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={700}>{item.label}</Typography>
                        <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)' }}>{new Date(item.timestamp).toLocaleString()}</Typography>
                      </Box>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={pct(item.score)} color={toneForStatus(item.status) as any} variant="outlined" />
                        <Chip size="small" label={item.target_trace_id} variant="outlined" />
                      </Stack>
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                      {Object.entries(item.metrics).map(([metric, value]) => (
                        <Chip key={metric} size="small" label={`${metric.replace(/_/g, ' ')} · ${pct(value)}`} variant="outlined" />
                      ))}
                    </Stack>
                    {item.notes.length ? (
                      <Stack spacing={0.5} sx={{ mt: 1.25 }}>
                        {item.notes.map((note) => (
                          <Typography key={note} variant="body2" sx={{ color: 'rgba(228,235,255,0.72)' }}>• {note}</Typography>
                        ))}
                      </Stack>
                    ) : null}
                  </Paper>
                ))}
              </Stack>
            ) : <Alert severity="info" variant="outlined">No evaluation history available yet.</Alert>}
          </SectionCard>
        </Box>
      </Stack>

      <SectionCard title="Selected trace evaluation context" description="Still tied to the parser selection, but now sourced from the shared evaluation result map instead of only the session summary.">
        {selectedEvaluation ? (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={`Score ${pct(selectedEvaluation.score)}`} color={toneForStatus(selectedEvaluation.status) as any} />
              <Chip size="small" label={selectedTrace?.function ?? 'selected trace'} variant="outlined" />
              <Chip size="small" label={selectedEvaluation.label} variant="outlined" />
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(selectedEvaluation.metrics).map(([metric, value]) => (
                <Chip key={metric} size="small" label={`${metric.replace(/_/g, ' ')} · ${pct(value)}`} variant="outlined" />
              ))}
            </Stack>
            {selectedEvaluation.notes.map((note) => (
              <Typography key={note} variant="body2" sx={{ color: 'rgba(228,235,255,0.72)' }}>• {note}</Typography>
            ))}
          </Stack>
        ) : <Alert severity="info" variant="outlined">Pick a trace with evaluation data from the Parser overview page to inspect it here.</Alert>}
      </SectionCard>
    </Stack>
  )

  const renderDashboardPage = () => (
    <Stack spacing={3}>
      <SectionCard
        eyebrow="Dashboard"
        title="Operational readout"
        description="Tighter cards, better contrast, and a less decorative layout make the dashboard useful instead of merely screenshot-friendly."
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
          <StatCard label="Sessions" value={String(sessionCount)} hint="matching current session query" />
          <StatCard label="Visible traces" value={String(traces.length)} hint={`${tracesTotal} total matches`} />
          <StatCard label="Annotated" value={String(annotatedCount)} hint="notes on visible traces" />
          <StatCard label="Avg quality" value={evaluation ? pct(evaluation.average_score) : '—'} hint={evaluation ? `${evaluation.evaluation_count} total eval runs` : 'no evaluations'} />
        </Stack>
      </SectionCard>

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={3}>
        <Box sx={{ flex: 1 }}>
          {chartByType.length ? <BarChart title="Counts by trace type" data={chartByType} /> : <Alert severity="info" variant="outlined">No trace data yet.</Alert>}
        </Box>
        <Box sx={{ flex: 1 }}>
          {chartByTag.length ? <BarChart title="Top tags in current view" data={chartByTag} /> : <Alert severity="info" variant="outlined">No tags match this filter set.</Alert>}
        </Box>
      </Stack>

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={3}>
        <Box sx={{ flex: 1 }}>
          {evaluationStatusChart.length ? <BarChart title="Visible evaluation statuses" data={evaluationStatusChart} /> : <Alert severity="info" variant="outlined">No evaluation data for this session view.</Alert>}
        </Box>
        <Box sx={{ flex: 1 }}>
          <SectionCard title="Coverage & focus" description="Makes it easier to see whether the session is being reviewed deeply enough.">
            <Stack spacing={1.25}>
              <Typography variant="body2"><strong>Source:</strong> {sourceLabel}</Typography>
              <Typography variant="body2"><strong>Selected session:</strong> {selectedSession || '—'}</Typography>
              <Typography variant="body2"><strong>Trace filters:</strong> {selectedType} / {selectedTag} / {search || 'no search'}</Typography>
              <Typography variant="body2"><strong>Evaluation filter:</strong> {evaluationStatusFilter}</Typography>
              <Typography variant="body2"><strong>Evaluation coverage:</strong> {pct(evaluationCoverage)}</Typography>
              <Typography variant="body2"><strong>Session page:</strong> {sessionPage}</Typography>
              <Typography variant="body2"><strong>Trace page:</strong> {tracePage}</Typography>
              <Typography variant="body2"><strong>Fallback asset:</strong> {SAMPLE_BUNDLE_URL}</Typography>
            </Stack>
          </SectionCard>
        </Box>
      </Stack>

      <SectionCard title="Lowest-scoring evaluations" description="A simple triage list so the dashboard has an actual action surface instead of decorative wallpaper.">
        {lowScoreEvaluations.length ? (
          <Stack spacing={1.25}>
            {lowScoreEvaluations.map((item) => (
              <Paper key={item.id} elevation={0} sx={{ p: 1.5, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(160,185,255,0.12)' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700}>{item.label}</Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)' }}>{item.target_trace_id}</Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={pct(item.score)} color={toneForStatus(item.status) as any} variant="outlined" />
                    <Chip size="small" label={new Date(item.timestamp).toLocaleString()} variant="outlined" />
                  </Stack>
                </Stack>
                {item.notes.slice(0, 2).map((note) => (
                  <Typography key={note} variant="body2" sx={{ color: 'rgba(228,235,255,0.72)', mt: 1 }}>• {note}</Typography>
                ))}
              </Paper>
            ))}
          </Stack>
        ) : <Alert severity="info" variant="outlined">No evaluation data to triage for this view.</Alert>}
      </SectionCard>
    </Stack>
  )

  return (
    <Box sx={{ minHeight: '100vh', background: 'radial-gradient(circle at top, rgba(99,102,241,0.18) 0%, rgba(13,18,34,1) 38%, rgba(5,8,16,1) 100%)', p: { xs: 2, md: 3 } }}>
      <Box sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'linear-gradient(120deg, rgba(125,211,167,0.05), transparent 28%, transparent 72%, rgba(192,132,252,0.05))' }} />
      <Stack spacing={3} sx={{ position: 'relative' }}>
        <Paper sx={{ p: { xs: 2, md: 2.5 }, background: 'linear-gradient(135deg, rgba(19,26,45,0.96), rgba(8,12,24,0.92))', border: '1px solid rgba(160,185,255,0.14)', boxShadow: '0 24px 60px rgba(0,0,0,0.32)' }}>
          <Stack spacing={2.5}>
            <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={2}>
              <Box sx={{ maxWidth: 980 }}>
                <Typography variant="h3" fontWeight={700}>Copilot Trace</Typography>
                <Typography variant="body1" sx={{ color: 'rgba(228,235,255,0.74)', mt: 1 }}>
                  Review Copilot session traces like an actual investigation surface: URL-addressable pages, live API first, sample fallback only when needed, and less of the usual prototype chaos.
                </Typography>
              </Box>
              <Stack spacing={1} alignItems={{ xs: 'flex-start', lg: 'flex-end' }}>
                <Chip size="small" label={sourceLabel} variant="outlined" />
                <Chip size="small" label={`${sessionCount} sessions available`} variant="outlined" />
                {sampleLoading ? <Chip size="small" label="loading fallback sample…" variant="outlined" /> : null}
              </Stack>
            </Stack>

            {error ? <Alert severity="warning" variant="outlined">{error}</Alert> : null}
            {(loadingSessions || loadingTraces || loadingEvaluations) ? <LinearProgress sx={{ borderRadius: 999, height: 8, backgroundColor: 'rgba(255,255,255,0.08)' }} /> : null}
          </Stack>
        </Paper>

        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="stretch">
          <Paper sx={{ width: { xs: '100%', lg: 340 }, p: 2, background: 'linear-gradient(180deg, rgba(12,18,32,0.92), rgba(8,12,24,0.9))', border: '1px solid rgba(160,185,255,0.12)', position: { lg: 'sticky' }, top: { lg: 24 }, alignSelf: 'flex-start' }}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="h6" fontWeight={700}>Workspace menu</Typography>
                <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)' }}>Switch between the three major features without changing the backing API contracts.</Typography>
              </Box>

              <Stack spacing={1}>
                {PAGE_META.map((item) => {
                  const Icon = item.icon
                  const active = item.key === page
                  return (
                    <Paper
                      key={item.key}
                      elevation={0}
                      sx={{
                        p: 0.5,
                        borderRadius: 2,
                        background: active ? 'linear-gradient(135deg, rgba(125,211,167,0.14), rgba(159,122,234,0.1))' : 'rgba(255,255,255,0.02)',
                        border: active ? '1px solid rgba(125,211,167,0.28)' : '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <Button fullWidth onClick={() => navigateToPage(item.key)} startIcon={<Icon />} sx={{ justifyContent: 'flex-start', textAlign: 'left', color: '#fff', px: 1.25, py: 1.25 }}>
                        <Box>
                          <Typography variant="subtitle2" fontWeight={700}>{item.label}</Typography>
                          <Typography variant="caption" sx={{ color: 'rgba(228,235,255,0.62)' }}>{item.description}</Typography>
                        </Box>
                      </Button>
                    </Paper>
                  )
                })}
              </Stack>

              <Divider />

              <Stack spacing={1.5}>
                <Typography variant="subtitle2" fontWeight={700}>Sessions</Typography>
                <TextField size="small" label="Find session" value={sessionSearchDraft} onChange={(event) => setSessionSearchDraft(event.target.value)} onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setSessionPage(1)
                    setSessionSearch(sessionSearchDraft)
                  }
                }} />
                <Stack direction={{ xs: 'column', sm: 'row', lg: 'column' }} spacing={1}>
                  <TextField select size="small" label="Evals" value={sessionEvalFilter} onChange={(event) => { setSessionPage(1); setSessionEvalFilter(event.target.value) }}>
                    <MenuItem value="all">All sessions</MenuItem>
                    <MenuItem value="with">With evaluations</MenuItem>
                    <MenuItem value="without">Without evaluations</MenuItem>
                  </TextField>
                  <TextField select size="small" label="Annotations" value={sessionAnnotatedOnly ? 'annotated' : 'all'} onChange={(event) => { setSessionPage(1); setSessionAnnotatedOnly(event.target.value === 'annotated') }}>
                    <MenuItem value="all">All sessions</MenuItem>
                    <MenuItem value="annotated">Annotated only</MenuItem>
                  </TextField>
                  <Button variant="outlined" onClick={() => { setSessionPage(1); setSessionSearch(sessionSearchDraft) }}>Apply</Button>
                </Stack>
                <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)' }}>{sessionsTotal} matching sessions</Typography>
                <List dense sx={{ maxHeight: 460, overflow: 'auto', py: 0 }}>
                  {sessions.map((session) => {
                    const sessionEval = sessionEvaluations.find((item) => item.session_id === session.session_id)
                    return (
                      <ListItemButton key={session.session_id} selected={session.session_id === selectedSession} onClick={() => { setSelectedSession(session.session_id); setSelectedTraceId(null); setTracePage(1) }}>
                        <ListItemText
                          primary={session.session_id}
                          secondary={`${session.trace_count} traces · ${session.annotated_count ?? 0} annotated${sessionEval ? ` · avg ${pct(sessionEval.average_score)}` : ''}`}
                        />
                      </ListItemButton>
                    )
                  })}
                </List>
                <Stack direction="row" justifyContent="center">
                  <Pagination count={Math.max(1, Math.ceil(sessionsTotal / SESSION_PAGE_SIZE))} page={sessionPage} onChange={(_, next) => setSessionPage(next)} color="primary" size="small" />
                </Stack>
              </Stack>
            </Stack>
          </Paper>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Paper sx={{ p: 2.25, mb: 3, background: 'linear-gradient(180deg, rgba(12,18,32,0.92), rgba(8,12,24,0.9))', border: '1px solid rgba(160,185,255,0.12)' }}>
              <Typography variant="caption" sx={{ color: '#8be0b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current page</Typography>
              <Typography variant="h5" fontWeight={700}>{currentPageMeta.label}</Typography>
              <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)', mt: 0.5 }}>{currentPageMeta.description}</Typography>
            </Paper>

            {page === 'parser' ? renderParserPage() : null}
            {page === 'evaluation' ? renderEvaluationPage() : null}
            {page === 'dashboard' ? renderDashboardPage() : null}
          </Box>
        </Stack>
      </Stack>
    </Box>
  )
}
