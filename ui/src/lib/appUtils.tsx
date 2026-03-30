import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type {
  Evaluation,
  EvaluationSessionSummary,
  Trace,
  TraceBundle,
  TraceSessionSummary,
} from '../types'

export type SampleState = {
  traces: Trace[]
  sessions: TraceSessionSummary[]
  evaluations: Evaluation[]
  evaluationSessions: EvaluationSessionSummary[]
}

export const EMPTY_SAMPLE_STATE: SampleState = {
  traces: [],
  sessions: [],
  evaluations: [],
  evaluationSessions: [],
}

export const toneForType = (type: string) => {
  switch (type) {
    case 'USER_MESSAGE': return 'primary'
    case 'ASSISTANT_MESSAGE': return 'success'
    case 'TOOL_CALL': return 'warning'
    case 'TOOL_RESULT': return 'secondary'
    default: return 'default'
  }
}

export const toneForStatus = (status: string) => {
  switch (status) {
    case 'pass': return 'success'
    case 'warn': return 'warning'
    case 'fail': return 'error'
    default: return 'default'
  }
}

export const pct = (value: number | undefined | null) => value == null ? '—' : `${Math.round(value * 100)}%`
export const safeText = (trace: Trace) => String(trace.text ?? trace.state ?? trace.description ?? trace.timestamp ?? '')
export const formatMetricLabel = (metric: string) => metric.replace(/_/g, ' ')

export const describeEvalStatus = (evaluation: Evaluation) => {
  if (evaluation.status_explanation) return evaluation.status_explanation
  const weakestMetric = Object.entries(evaluation.metrics).sort((a, b) => a[1] - b[1])[0]?.[0]
  const weakestLabel = weakestMetric ? formatMetricLabel(weakestMetric) : 'unknown signal'
  if (evaluation.status === 'pass') return `Scored ${pct(evaluation.score)}, so it passed the current rubric (pass ≥ 75%).`
  if (evaluation.status === 'warn') return `Scored ${pct(evaluation.score)}, so it landed in review territory (warn ≥ 50%). Weakest signal: ${weakestLabel}.`
  return `Scored ${pct(evaluation.score)}, so it failed the current rubric (< 50%). Weakest signal: ${weakestLabel}.`
}

export const enrichTraces = (input: Trace[]): Trace[] => {
  const grouped = new Map<string, Trace[]>()
  input.forEach((trace) => {
    const sessionId = trace.session_id ?? ''
    grouped.set(sessionId, [...(grouped.get(sessionId) ?? []), trace])
  })

  const enriched: Trace[] = []
  for (const [sessionId, traces] of grouped.entries()) {
    const sorted = [...traces].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
    const messageMap = new Map(sorted.filter((trace) => trace.message_id).map((trace) => [String(trace.message_id), trace.id]))
    const toolMap = new Map(sorted.filter((trace) => trace.tool_call_id && trace.type === 'TOOL_CALL').map((trace) => [String(trace.tool_call_id), trace.id]))
    sorted.forEach((trace, index) => {
      let parentTraceId: string | null = trace.parent_trace_id ?? null
      let parentReason: string | null = trace.parent_reason ?? null
      if (!parentTraceId && trace.type === 'TOOL_CALL') {
        parentTraceId = messageMap.get(String(trace.message_id ?? '')) ?? null
        parentReason = parentTraceId ? 'message' : null
      }
      if (!parentTraceId && trace.type === 'TOOL_RESULT') {
        parentTraceId = toolMap.get(String(trace.tool_call_id ?? '')) ?? null
        parentReason = parentTraceId ? 'tool_call' : null
      }
      enriched.push({
        ...trace,
        sequence: trace.sequence ?? index + 1,
        sequence_id: trace.sequence_id ?? `${sessionId}:${index + 1}`,
        parent_trace_id: parentTraceId,
        parent_reason: parentReason,
      })
    })
  }
  return enriched
}

export function toSampleState(bundle: TraceBundle): SampleState {
  const traces = enrichTraces(bundle.traces ?? [])
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

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper elevation={0} sx={{ flex: 1, minWidth: 160, p: 1.75, background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025))', border: '1px solid rgba(160,185,255,0.12)', backdropFilter: 'blur(14px)' }}>
      <Typography variant="caption" sx={{ color: '#8be0b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</Typography>
      <Typography variant="h5" fontWeight={700} sx={{ mt: 0.75 }}>{value}</Typography>
      {hint ? <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.62)', mt: 0.5 }}>{hint}</Typography> : null}
    </Paper>
  )
}

export function BarChart({ title, data }: { title: string; data: Array<{ label: string; value: number; tone?: string }> }) {
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

export function SectionCard({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children: ReactNode }) {
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

export function PageLoadingState() {
  return (
    <SectionCard eyebrow="Loading" title="Loading workspace" description="The page module is being fetched on demand to keep the initial bundle leaner.">
      <Alert severity="info" variant="outlined">Loading page component…</Alert>
      <Chip label="Lazy-loaded route" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
    </SectionCard>
  )
}
