import { Alert, Box, Paper, Stack, Typography } from '@mui/material'
import { BarChart, pct, SectionCard, StatCard, toneForStatus } from '../lib/appUtils'
import type { EvaluationSessionSummary } from '../types'

interface DashboardPageProps {
  annotatedCount: number
  chartByTag: Array<{ label: string; value: number; tone?: string }>
  chartByType: Array<{ label: string; value: number; tone?: string }>
  evaluation?: EvaluationSessionSummary
  evaluationCoverage: number
  evaluationStatusChart: Array<{ label: string; value: number; tone?: string }>
  evaluationStatusFilter: string
  lowScoreEvaluations: Array<{
    id: string
    label: string
    notes: string[]
    score: number
    status: string
    target_trace_id: string
    timestamp: string
  }>
  search: string
  selectedSession: string
  selectedTag: string
  selectedType: string
  sessionCount: number
  sessionPage: number
  sourceLabel: string
  tracePage: number
  tracesLength: number
  tracesTotal: number
}

export default function DashboardPage({
  annotatedCount,
  chartByTag,
  chartByType,
  evaluation,
  evaluationCoverage,
  evaluationStatusChart,
  evaluationStatusFilter,
  lowScoreEvaluations,
  search,
  selectedSession,
  selectedTag,
  selectedType,
  sessionCount,
  sessionPage,
  sourceLabel,
  tracePage,
  tracesLength,
  tracesTotal,
}: DashboardPageProps) {
  return (
    <Stack spacing={3}>
      <SectionCard
        eyebrow="Dashboard"
        title="Operational readout"
        description="Tighter cards, better contrast, and a less decorative layout make the dashboard useful instead of merely screenshot-friendly."
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
          <StatCard label="Sessions" value={String(sessionCount)} hint="matching current session query" />
          <StatCard label="Visible traces" value={String(tracesLength)} hint={`${tracesTotal} total matches`} />
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
              <Typography variant="body2"><strong>Fallback asset:</strong> {sourceLabel.includes('sample export fallback') ? 'active' : 'standby'}</Typography>
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
                    <Paper component="span" elevation={0} sx={{ px: 1, py: 0.25, borderRadius: 999, border: '1px solid rgba(160,185,255,0.12)', background: 'transparent' }}>{pct(item.score)}</Paper>
                    <Paper component="span" elevation={0} sx={{ px: 1, py: 0.25, borderRadius: 999, border: '1px solid rgba(160,185,255,0.12)', background: 'transparent' }}>{new Date(item.timestamp).toLocaleString()}</Paper>
                    <Paper component="span" elevation={0} sx={{ px: 1, py: 0.25, borderRadius: 999, border: `1px solid ${toneForStatus(item.status) === 'error' ? 'rgba(248,113,113,0.35)' : 'rgba(160,185,255,0.12)'}`, background: 'transparent' }}>{item.status}</Paper>
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
}
