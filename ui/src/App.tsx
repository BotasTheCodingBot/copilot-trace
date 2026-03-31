import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Pagination,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  API_BASE,
  EVAL_PAGE_SIZE,
  getCurrentPath,
  getCurrentSearch,
  hasWindow,
  PAGE_META,
  pageForPath,
  pagePath,
  SESSION_PAGE_SIZE,
  SAMPLE_BUNDLE_URL,
  TRACE_PAGE_SIZE,
  type AppPage,
} from './lib/appConfig'
import {
  EMPTY_SAMPLE_STATE,
  enrichTraces,
  PageLoadingState,
  pct,
  toSampleState,
  toneForStatus,
  type SampleState,
} from './lib/appUtils'
import type {
  Evaluation,
  EvaluationListResponse,
  EvaluationSessionSummary,
  SessionListResponse,
  Trace,
  TraceListResponse,
  TraceSessionSummary,
  TraceBundle,
} from './types'

const ParserPage = lazy(() => import('./pages/ParserPage'))
const EvaluationPage = lazy(() => import('./pages/EvaluationPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))

export function parseBundleTags(input: string): Record<string, string> {
  return input
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const separatorIndex = entry.indexOf('=')
      if (separatorIndex <= 0) return acc
      const key = entry.slice(0, separatorIndex).trim()
      const value = entry.slice(separatorIndex + 1).trim()
      if (!key || !value) return acc
      acc[key] = value
      return acc
    }, {})
}

type DirectoryHandleLike = {
  name?: string
  path?: string
  fullPath?: string
  absolutePath?: string
}

type WindowWithDirectoryPicker = {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>
}

function readDirectoryPath(handle: DirectoryHandleLike | null | undefined): string {
  if (!handle) return ''
  const candidate = [handle.path, handle.fullPath, handle.absolutePath].find((value) => typeof value === 'string' && value.trim())
  return candidate?.trim() ?? ''
}

export function supportsNativeDirectoryPicker(target: WindowWithDirectoryPicker | undefined = typeof window === 'undefined' ? undefined : (window as WindowWithDirectoryPicker)): boolean {
  return typeof target?.showDirectoryPicker === 'function'
}

export function describePickedDirectory(handle: DirectoryHandleLike | null | undefined): { path: string; label: string } {
  const path = readDirectoryPath(handle)
  const label = handle?.name?.trim() || path || 'selected folder'
  return { path, label }
}

export default function App() {
  const [page, setPage] = useState<AppPage>(() => pageForPath(getCurrentPath()))
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
  const [traceSort, setTraceSort] = useState<'asc' | 'desc'>('asc')
  const [evaluationSort, setEvaluationSort] = useState<'desc' | 'asc'>('desc')

  const [selectedSession, setSelectedSession] = useState('')
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [draftSearch, setDraftSearch] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedTag, setSelectedTag] = useState('all')
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingTraces, setLoadingTraces] = useState(true)
  const [loadingEvaluations, setLoadingEvaluations] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sourceLabel, setSourceLabel] = useState('live API')
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportOutputDir, setExportOutputDir] = useState('')
  const [exportBundleName, setExportBundleName] = useState('')
  const [exportTagText, setExportTagText] = useState('')
  const [exportSelectedFolderLabel, setExportSelectedFolderLabel] = useState('')
  const [exportPickerMessage, setExportPickerMessage] = useState<string | null>(null)
  const [exportAutoImportEnabled, setExportAutoImportEnabled] = useState(false)
  const [mlflowTrackingUri, setMlflowTrackingUri] = useState('')
  const [mlflowExperimentName, setMlflowExperimentName] = useState('')
  const [mlflowRunName, setMlflowRunName] = useState('')
  const [mlflowArtifactPath, setMlflowArtifactPath] = useState('copilot_trace_bundle')
  const [mlflowImportTraces, setMlflowImportTraces] = useState(true)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(getCurrentSearch())
    const sessionId = params.get('session') ?? ''
    const nextSearch = params.get('search') ?? ''
    const nextType = params.get('type') ?? 'all'
    const nextTag = params.get('tag') ?? 'all'
    const nextEvalStatus = params.get('eval') ?? 'all'
    const nextTraceSort = (params.get('traceSort') ?? 'asc') === 'desc' ? 'desc' : 'asc'
    const nextEvaluationSort = (params.get('evaluationSort') ?? 'desc') === 'asc' ? 'asc' : 'desc'
    const nextSessionPage = Number(params.get('sessionPage') ?? '1')
    const nextTracePage = Number(params.get('tracePage') ?? '1')

    setSelectedSession(sessionId)
    setSearch(nextSearch)
    setDraftSearch(nextSearch)
    setSelectedType(nextType)
    setSelectedTag(nextTag)
    setEvaluationStatusFilter(nextEvalStatus)
    setTraceSort(nextTraceSort)
    setEvaluationSort(nextEvaluationSort)
    setSessionPage(Number.isFinite(nextSessionPage) && nextSessionPage > 0 ? nextSessionPage : 1)
    setTracePage(Number.isFinite(nextTracePage) && nextTracePage > 0 ? nextTracePage : 1)

    if (!hasWindow()) return
    const syncRoute = () => setPage(pageForPath(getCurrentPath()))
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
    if (traceSort !== 'asc') params.set('traceSort', traceSort)
    if (evaluationSort !== 'desc') params.set('evaluationSort', evaluationSort)
    if (sessionPage > 1) params.set('sessionPage', String(sessionPage))
    if (tracePage > 1) params.set('tracePage', String(tracePage))
    if (!hasWindow()) return
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}#${pagePath(page)}`
    window.history.replaceState({}, '', nextUrl)
  }, [page, selectedSession, search, selectedType, selectedTag, evaluationStatusFilter, traceSort, evaluationSort, sessionPage, tracePage])

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
        traceParams.set('sort', traceSort)

        const evalParams = new URLSearchParams({ session_id: selectedSession, limit: String(EVAL_PAGE_SIZE), sort: evaluationSort })
        if (evaluationStatusFilter !== 'all') evalParams.set('status', evaluationStatusFilter)

        const [traceRes, evalRes] = await Promise.all([
          fetch(`${API_BASE}/api/traces?${traceParams.toString()}`),
          fetch(`${API_BASE}/api/evaluations?${evalParams.toString()}`),
        ])
        if (!traceRes.ok || !evalRes.ok) throw new Error('Trace query failed')
        const tracePayload = await traceRes.json() as TraceListResponse
        const evalPayload = await evalRes.json() as EvaluationListResponse
        if (cancelled) return
        const nextTraces = enrichTraces(tracePayload.traces ?? [])
        setTraces(nextTraces)
        setTracesTotal(tracePayload.total ?? nextTraces.length)
        setAvailableTypes(tracePayload.available_filters?.types ?? [])
        setAvailableTags(tracePayload.available_filters?.tags ?? [])
        setEvaluations(evalPayload.evaluations ?? tracePayload.evaluations ?? [])
        setSelectedTraceId((current) => nextTraces.some((trace) => trace.id === current) ? current : nextTraces[0]?.id ?? null)
      } catch {
        if (cancelled) return
        const fallback = sampleReady ? sampleState : await loadSampleState()
        const filtered = enrichTraces(fallback.traces).filter((trace) => {
          if (trace.session_id !== selectedSession) return false
          if (selectedType !== 'all' && trace.type !== selectedType) return false
          if (selectedTag !== 'all' && !(trace.tags ?? []).includes(selectedTag)) return false
          if (search.trim()) {
            const haystack = JSON.stringify(trace).toLowerCase()
            if (!haystack.includes(search.trim().toLowerCase())) return false
          }
          return true
        }).sort((a, b) => traceSort === 'asc'
          ? a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)
          : b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))
        const fallbackEvaluations = fallback.evaluations.filter((item) => {
          if (item.session_id !== selectedSession) return false
          if (evaluationStatusFilter !== 'all' && item.status !== evaluationStatusFilter) return false
          return true
        }).sort((a, b) => evaluationSort === 'asc'
          ? a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)
          : b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))
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
  }, [selectedSession, tracePage, selectedType, selectedTag, search, evaluationStatusFilter, traceSort, evaluationSort, sampleReady])

  useEffect(() => {
    setTracePage(1)
  }, [selectedSession, selectedType, selectedTag, search])

  const selectedTrace = useMemo(() => (
    traces.find((trace) => trace.id === selectedTraceId) ?? traces[0] ?? null
  ), [traces, selectedTraceId])

  const evaluation = useMemo(() => sessionEvaluations.find((item) => item.session_id === selectedSession), [sessionEvaluations, selectedSession])
  const evaluationByTraceId = useMemo(() => new Map(evaluations.map((item) => [item.target_trace_id, item])), [evaluations])
  const selectedEvaluation = selectedTrace ? evaluationByTraceId.get(selectedTrace.id) : undefined
  const parsedExportTags = useMemo(() => parseBundleTags(exportTagText), [exportTagText])
  const nativeDirectoryPickerSupported = useMemo(() => supportsNativeDirectoryPicker(), [])
  const activeExportSessionId = exportDialogOpen ? selectedSession.trim() : ''

  useEffect(() => {
    if (!exportDialogOpen) return
    setExportBundleName((current) => current.trim() ? current : selectedSession)
  }, [exportDialogOpen, selectedSession])

  const handleExportOutputDirChange = (event: ChangeEvent<HTMLInputElement>) => {
    setExportOutputDir(event.target.value)
    setExportPickerMessage(null)
  }

  const handleOpenExportDialog = () => {
    setExportBundleName(selectedSession)
    setExportSelectedFolderLabel('')
    setExportPickerMessage(null)
    setExportAutoImportEnabled(false)
    setMlflowTrackingUri('')
    setMlflowExperimentName('')
    setMlflowRunName('')
    setMlflowArtifactPath('copilot_trace_bundle')
    setMlflowImportTraces(true)
    setExportError(null)
    setExportSuccess(null)
    setExportDialogOpen(true)
  }

  const handleCloseExportDialog = () => {
    if (exportLoading) return
    setExportDialogOpen(false)
  }

  const handlePickExportFolder = async () => {
    if (!supportsNativeDirectoryPicker() || exportLoading) return
    setExportError(null)
    try {
      const handle = await (window as WindowWithDirectoryPicker).showDirectoryPicker?.({ mode: 'readwrite' })
      const { path, label } = describePickedDirectory(handle)
      setExportSelectedFolderLabel(label)
      if (path) {
        setExportOutputDir(path)
        setExportPickerMessage(`Using native folder selection for ${label}.`)
        return
      }
      setExportPickerMessage(`Picked “${label}”, but this browser only exposes the folder name here. Paste the full path below to finish the export.`)
    } catch (pickerError) {
      const message = pickerError instanceof Error ? pickerError.message : ''
      if (message.toLowerCase().includes('abort')) return
      setExportError(message || 'Folder selection failed')
    }
  }

  const handleSubmitExport = async () => {
    const normalizedSessionId = activeExportSessionId
    const normalizedOutputDir = exportOutputDir.trim()
    const normalizedBundleName = exportBundleName.trim() || normalizedSessionId
    if (!normalizedSessionId) {
      setExportError('Session id is required.')
      return
    }
    if (!normalizedOutputDir) {
      setExportError('Output folder is required.')
      return
    }

    setExportLoading(true)
    setExportError(null)
    setExportSuccess(null)
    try {
      const requestBody: Record<string, unknown> = {
        output_dir: normalizedOutputDir,
        bundle_name: normalizedBundleName,
        tags: parsedExportTags,
      }
      if (exportAutoImportEnabled) {
        requestBody.mlflow_import = {
          tracking_uri: mlflowTrackingUri.trim() || undefined,
          experiment_name: mlflowExperimentName.trim() || undefined,
          run_name: mlflowRunName.trim() || undefined,
          artifact_path: mlflowArtifactPath,
          import_traces: mlflowImportTraces,
        }
      }

      const response = await fetch(`${API_BASE}/api/traces/sessions/${encodeURIComponent(normalizedSessionId)}/export/mlflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Export failed (${response.status})`)
      const bundleDir = payload?.export?.bundle_dir ?? normalizedOutputDir
      const importedRunId = payload?.mlflow_import?.run_id
      setExportSuccess(importedRunId
        ? `Session bundle written to ${bundleDir} and imported into MLflow run ${importedRunId}.`
        : `Session bundle written to ${bundleDir}.`)
      setExportDialogOpen(false)
    } catch (submitError) {
      setExportError(submitError instanceof Error ? submitError.message : 'Export failed')
    } finally {
      setExportLoading(false)
    }
  }

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
    if (!hasWindow()) return
    window.history.pushState({}, '', `${window.location.pathname}${window.location.search}#${pagePath(nextPage)}`)
  }

  const renderPage = () => {
    switch (page) {
      case 'evaluation':
        return (
          <EvaluationPage
            evaluation={evaluation}
            evaluationCoverage={evaluationCoverage}
            evaluationSort={evaluationSort}
            evaluationStatusChart={evaluationStatusChart}
            evaluationStatusFilter={evaluationStatusFilter}
            evaluations={evaluations}
            latestEvaluationHistory={latestEvaluationHistory}
            selectedEvaluation={selectedEvaluation}
            selectedTrace={selectedTrace}
            setEvaluationSort={setEvaluationSort}
            setEvaluationStatusFilter={setEvaluationStatusFilter}
          />
        )
      case 'dashboard':
        return (
          <DashboardPage
            annotatedCount={annotatedCount}
            chartByTag={chartByTag}
            chartByType={chartByType}
            evaluation={evaluation}
            evaluationCoverage={evaluationCoverage}
            evaluationStatusChart={evaluationStatusChart}
            evaluationStatusFilter={evaluationStatusFilter}
            lowScoreEvaluations={lowScoreEvaluations}
            search={search}
            selectedSession={selectedSession}
            selectedTag={selectedTag}
            selectedType={selectedType}
            sessionCount={sessionCount}
            sessionPage={sessionPage}
            sourceLabel={sourceLabel}
            tracePage={tracePage}
            tracesLength={traces.length}
            tracesTotal={tracesTotal}
          />
        )
      case 'parser':
      default:
        return (
          <ParserPage
            availableTags={availableTags}
            availableTypes={availableTypes}
            draftSearch={draftSearch}
            evaluationByTraceId={evaluationByTraceId}
            overview={overview}
            search={search}
            onOpenExportDialog={handleOpenExportDialog}
            selectedEvaluation={selectedEvaluation}
            selectedSession={selectedSession}
            selectedTag={selectedTag}
            selectedTrace={selectedTrace}
            selectedType={selectedType}
            setDraftSearch={setDraftSearch}
            setSearch={setSearch}
            setSelectedTag={setSelectedTag}
            setSelectedTraceId={setSelectedTraceId}
            setSelectedType={setSelectedType}
            setTracePage={setTracePage}
            setTraceSort={setTraceSort}
            tracePage={tracePage}
            traceSort={traceSort}
            traces={traces}
            tracesTotal={tracesTotal}
          />
        )
    }
  }

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
            {exportSuccess ? <Alert severity="success" variant="outlined">{exportSuccess}</Alert> : null}
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
                    const selected = session.session_id === selectedSession
                    return (
                      <Box key={session.session_id} sx={{ px: 0.5, py: 0.25 }}>
                        <Paper
                          elevation={0}
                          sx={{
                            borderRadius: 2,
                            border: selected ? '1px solid rgba(125,211,167,0.32)' : '1px solid rgba(255,255,255,0.06)',
                            background: selected ? 'rgba(125,211,167,0.08)' : 'rgba(255,255,255,0.02)',
                            overflow: 'hidden',
                          }}
                        >
                          <ListItemButton selected={selected} onClick={() => { setSelectedSession(session.session_id); setSelectedTraceId(null); setTracePage(1) }}>
                            <ListItemText
                              primary={session.session_id}
                              secondary={`${session.trace_count} traces · ${session.annotated_count ?? 0} annotated${sessionEval ? ` · avg ${pct(sessionEval.average_score)}` : ''}`}
                            />
                          </ListItemButton>
                        </Paper>
                      </Box>
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

            <Suspense fallback={<PageLoadingState />}>
              {renderPage()}
            </Suspense>
          </Box>
        </Stack>
      </Stack>

      <Dialog open={exportDialogOpen} onClose={handleCloseExportDialog} fullWidth maxWidth="sm">
        <DialogTitle>Export session bundle</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Write the whole selected session to a local MLflow-oriented bundle. This stays on disk only — no tracking server calls.
            </Typography>
            <TextField label="Session id" value={activeExportSessionId} disabled fullWidth />
            <Stack spacing={1.25}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'flex-start' }}>
                <TextField
                  autoFocus={!nativeDirectoryPickerSupported}
                  required
                  label="Output folder"
                  placeholder="/home/tore/exports/mlflow"
                  value={exportOutputDir}
                  onChange={handleExportOutputDirChange}
                  fullWidth
                />
                {nativeDirectoryPickerSupported ? (
                  <Button variant="outlined" onClick={handlePickExportFolder} disabled={exportLoading} sx={{ minWidth: { sm: 148 }, whiteSpace: 'nowrap', alignSelf: { sm: 'stretch' } }}>
                    Choose folder
                  </Button>
                ) : null}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {nativeDirectoryPickerSupported
                  ? 'Prefer the native folder picker when your browser supports it. If the picker cannot expose the full filesystem path, paste it manually below.'
                  : 'Your browser does not expose a native directory picker here, so paste the destination path manually.'}
              </Typography>
              {exportSelectedFolderLabel ? <Chip size="small" label={`Picked: ${exportSelectedFolderLabel}`} variant="outlined" sx={{ alignSelf: 'flex-start' }} /> : null}
              {exportPickerMessage ? <Alert severity="info" variant="outlined">{exportPickerMessage}</Alert> : null}
            </Stack>
            <TextField
              label="Bundle name"
              placeholder="session-2026-03-31"
              value={exportBundleName}
              onChange={(event) => setExportBundleName(event.target.value)}
              helperText="A subfolder with this name will be created inside the output folder."
              fullWidth
            />
            <TextField
              label="Optional tags"
              placeholder="owner=tore\nenv=local"
              value={exportTagText}
              onChange={(event) => setExportTagText(event.target.value)}
              helperText="Use key=value pairs, one per line or comma-separated."
              multiline
              minRows={3}
              fullWidth
            />
            {Object.keys(parsedExportTags).length ? (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {Object.entries(parsedExportTags).map(([key, value]) => (
                  <Chip key={key} size="small" label={`${key}=${value}`} variant="outlined" />
                ))}
              </Stack>
            ) : null}
            <Stack spacing={1.5} sx={{ borderRadius: 2, border: '1px solid rgba(255,255,255,0.08)', p: 1.5 }}>
              <FormControlLabel
                control={<Switch checked={exportAutoImportEnabled} onChange={(event) => setExportAutoImportEnabled(event.target.checked)} />}
                label="Import into MLflow right after export"
              />
              <Typography variant="caption" color="text.secondary">
                Keeps the local bundle on disk, then replays it into an MLflow run in the same request.
              </Typography>
              {exportAutoImportEnabled ? (
                <Stack spacing={1.25}>
                  <TextField
                    label="Tracking URI"
                    placeholder="file:/home/tore/.openclaw/workspace/copilot-trace/out/mlruns"
                    value={mlflowTrackingUri}
                    onChange={(event) => setMlflowTrackingUri(event.target.value)}
                    helperText="Optional. Leave blank to use MLFLOW_TRACKING_URI or MLflow defaults."
                    fullWidth
                  />
                  <TextField
                    label="Experiment name"
                    placeholder="copilot-trace"
                    value={mlflowExperimentName}
                    onChange={(event) => setMlflowExperimentName(event.target.value)}
                    helperText="Optional. Creates/selects the experiment before starting the run."
                    fullWidth
                  />
                  <TextField
                    label="Run name override"
                    placeholder="session-2026-03-31"
                    value={mlflowRunName}
                    onChange={(event) => setMlflowRunName(event.target.value)}
                    helperText="Optional. Defaults to the exported bundle name."
                    fullWidth
                  />
                  <TextField
                    label="Artifact subdirectory"
                    placeholder="copilot_trace_bundle"
                    value={mlflowArtifactPath}
                    onChange={(event) => setMlflowArtifactPath(event.target.value)}
                    helperText="Use empty text to log artifacts at the run root."
                    fullWidth
                  />
                  <FormControlLabel
                    control={<Switch checked={mlflowImportTraces} onChange={(event) => setMlflowImportTraces(event.target.checked)} />}
                    label="Replay native MLflow trace spans"
                  />
                </Stack>
              ) : null}
            </Stack>
            {exportError ? <Alert severity="error" variant="outlined">{exportError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseExportDialog} disabled={exportLoading}>Cancel</Button>
          <Button onClick={handleSubmitExport} variant="contained" disabled={exportLoading || !activeExportSessionId}>
            {exportLoading ? 'Exporting…' : 'Export session'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
