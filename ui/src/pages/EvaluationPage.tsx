import { Alert, Box, Chip, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { BarChart, describeEvalStatus, formatMetricLabel, pct, SectionCard, StatCard, toneForStatus } from '../lib/appUtils'
import type { Evaluation, EvaluationSessionSummary, Trace } from '../types'

interface EvaluationPageProps {
  evaluation?: EvaluationSessionSummary
  evaluationCoverage: number
  evaluationSort: 'desc' | 'asc'
  evaluationStatusChart: Array<{ label: string; value: number; tone?: string }>
  evaluationStatusFilter: string
  evaluations: Evaluation[]
  latestEvaluationHistory: Evaluation[]
  selectedEvaluation?: Evaluation
  selectedTrace: Trace | null
  setEvaluationSort: (value: 'desc' | 'asc') => void
  setEvaluationStatusFilter: (value: string) => void
}

export default function EvaluationPage({
  evaluation,
  evaluationCoverage,
  evaluationSort,
  evaluationStatusChart,
  evaluationStatusFilter,
  evaluations,
  latestEvaluationHistory,
  selectedEvaluation,
  selectedTrace,
  setEvaluationSort,
  setEvaluationStatusFilter,
}: EvaluationPageProps) {
  return (
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
              <TextField select label="Eval sort" size="small" value={evaluationSort} onChange={(event) => setEvaluationSort(event.target.value as 'desc' | 'asc')} sx={{ minWidth: 180 }}>
                <MenuItem value="desc">Newest first</MenuItem>
                <MenuItem value="asc">Oldest first</MenuItem>
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
                      <Chip size="small" label={`Band ${item.score_band ?? 'derived'}`} variant="outlined" />
                      {Object.entries(item.metrics).map(([metric, value]) => (
                        <Chip key={metric} size="small" label={`${formatMetricLabel(metric)} · ${pct(value)}`} variant="outlined" />
                      ))}
                    </Stack>
                    <Alert severity={item.status === 'pass' ? 'success' : item.status === 'warn' ? 'warning' : 'error'} variant="outlined" sx={{ mt: 1.25 }}>
                      {describeEvalStatus(item)}
                    </Alert>
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
              <Chip size="small" label={`Band ${selectedEvaluation.score_band ?? 'derived'}`} variant="outlined" />
            </Stack>
            <Alert severity={selectedEvaluation.status === 'pass' ? 'success' : selectedEvaluation.status === 'warn' ? 'warning' : 'error'} variant="outlined">
              {describeEvalStatus(selectedEvaluation)}
            </Alert>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(selectedEvaluation.metrics).map(([metric, value]) => (
                <Chip key={metric} size="small" label={`${formatMetricLabel(metric)} · ${pct(value)}`} variant="outlined" />
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
}
