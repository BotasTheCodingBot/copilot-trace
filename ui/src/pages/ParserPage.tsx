import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
import JsonViewer from '../components/JsonViewer'
import { API_BASE, TRACE_PAGE_SIZE } from '../lib/appConfig'
import { pct, safeText, SectionCard, toneForStatus, toneForType, formatMetricLabel, describeEvalStatus } from '../lib/appUtils'
import type { Evaluation, Trace } from '../types'

interface ParserPageProps {
  availableTags: string[]
  availableTypes: string[]
  draftSearch: string
  evaluationByTraceId: Map<string, Evaluation>
  overview: Record<string, number>
  search: string
  selectedEvaluation?: Evaluation
  selectedSession: string
  selectedTag: string
  selectedTrace: Trace | null
  selectedType: string
  setDraftSearch: (value: string) => void
  setSearch: (value: string) => void
  setSelectedTag: (value: string) => void
  setSelectedTraceId: (value: string | null) => void
  setSelectedType: (value: string) => void
  setTracePage: (value: number) => void
  setTraceSort: (value: 'asc' | 'desc') => void
  tracePage: number
  traceSort: 'asc' | 'desc'
  traces: Trace[]
  tracesTotal: number
}

export function parseMlflowTags(input: string): Record<string, string> {
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

export default function ParserPage({
  availableTags,
  availableTypes,
  draftSearch,
  evaluationByTraceId,
  overview,
  search,
  selectedEvaluation,
  selectedSession,
  selectedTag,
  selectedTrace,
  selectedType,
  setDraftSearch,
  setSearch,
  setSelectedTag,
  setSelectedTraceId,
  setSelectedType,
  setTracePage,
  setTraceSort,
  tracePage,
  traceSort,
  traces,
  tracesTotal,
}: ParserPageProps) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [trackingUri, setTrackingUri] = useState('')
  const [experimentName, setExperimentName] = useState('copilot-trace')
  const [tagText, setTagText] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState<string | null>(null)

  const parsedTags = useMemo(() => parseMlflowTags(tagText), [tagText])

  const handleOpenExportDialog = () => {
    setExportError(null)
    setExportSuccess(null)
    setExportDialogOpen(true)
  }

  const handleCloseExportDialog = () => {
    if (exportLoading) return
    setExportDialogOpen(false)
  }

  const handleSubmitExport = async () => {
    if (!selectedTrace) return
    const normalizedTrackingUri = trackingUri.trim()
    const normalizedExperimentName = experimentName.trim() || 'copilot-trace'

    if (!normalizedTrackingUri) {
      setExportError('Tracking URI is required.')
      return
    }

    setExportLoading(true)
    setExportError(null)
    setExportSuccess(null)
    try {
      const response = await fetch(`${API_BASE}/api/traces/${selectedTrace.id}/export/mlflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_uri: normalizedTrackingUri,
          experiment_name: normalizedExperimentName,
          tags: parsedTags,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || `Export failed (${response.status})`)
      }
      const runId = payload?.export?.run_id
      setExportSuccess(runId
        ? `Exported to MLflow run ${runId} in experiment ${normalizedExperimentName}.`
        : `Exported trace ${selectedTrace.id} to MLflow.`)
      setExportDialogOpen(false)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExportLoading(false)
    }
  }

  return (
    <Stack spacing={3}>
      <SectionCard
        eyebrow="Parser"
        title="Trace review workspace"
        description="Timeline-first review: the filtered event stream stays in focus, while the selected trace sits beside it instead of below extra navigation chrome."
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
          <TextField select label="Timeline sort" size="small" value={traceSort} onChange={(event) => { setTracePage(1); setTraceSort(event.target.value as 'asc' | 'desc') }} sx={{ minWidth: 180 }}>
            <MenuItem value="asc">Oldest first</MenuItem>
            <MenuItem value="desc">Newest first</MenuItem>
          </TextField>
          <Button variant="contained" onClick={() => { setTracePage(1); setSearch(draftSearch) }}>Apply</Button>
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {Object.entries(overview).map(([type, count]) => (
            <Chip key={type} label={`${type}: ${count}`} color={toneForType(type) as any} variant="outlined" />
          ))}
          {search ? <Chip label={`Search: ${search}`} onDelete={() => { setSearch(''); setDraftSearch('') }} /> : null}
          <Chip label={`Page ${tracePage}/${Math.max(1, Math.ceil(tracesTotal / TRACE_PAGE_SIZE))}`} variant="outlined" />
          <Chip label={`Sort: ${traceSort === 'asc' ? 'oldest first' : 'newest first'}`} variant="outlined" />
          <Chip label={`${tracesTotal} total matches`} variant="outlined" />
          <Chip label={`Session ${selectedSession || '—'}`} variant="outlined" />
        </Stack>
      </SectionCard>

      <Stack direction={{ xs: 'column', xl: 'row' }} spacing={3} alignItems="stretch">
        <Box sx={{ flex: 1.15, minWidth: 0 }}>
          <SectionCard title="Trace timeline" description={`${traces.length} traces on this page · ${tracesTotal} matching the current query.`}>
            <List sx={{ maxHeight: 820, overflow: 'auto', py: 0 }}>
              {traces.map((trace) => {
                const traceEval = evaluationByTraceId.get(trace.id)
                const isSelected = selectedTrace?.id === trace.id
                return (
                  <Box key={trace.id}>
                    <ListItemButton selected={isSelected} onClick={() => setSelectedTraceId(trace.id)} sx={{ alignItems: 'flex-start', py: 1.25 }}>
                      <ListItemText
                        primary={
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap alignItems={{ xs: 'flex-start', sm: 'center' }} flexWrap="wrap">
                            <Typography variant="subtitle2" fontWeight={700}>{trace.function}</Typography>
                            <Chip size="small" label={trace.type} color={toneForType(trace.type) as any} variant={isSelected ? 'filled' : 'outlined'} />
                            <Chip size="small" label={`Seq ${trace.sequence ?? '—'}`} variant="outlined" />
                            {trace.parent_trace_id ? <Chip size="small" label={`${trace.parent_reason ?? 'parent'} · ${trace.parent_trace_id}`} variant="outlined" /> : null}
                          </Stack>
                        }
                        secondary={
                          <Stack spacing={0.75} sx={{ mt: 0.9 }}>
                            <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.72)' }}>
                              {safeText(trace).slice(0, 180) || 'No preview text on this trace.'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'rgba(228,235,255,0.5)' }}>
                              {new Date(trace.timestamp).toLocaleString()}
                            </Typography>
                          </Stack>
                        }
                      />
                      <Stack alignItems="flex-end" spacing={0.75} sx={{ pl: 1 }}>
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
        </Box>

        <Box sx={{ flex: 0.95, minWidth: 0 }}>
          <SectionCard title="Selected trace" description="The active trace stays beside the timeline so payload detail and evaluation context remain visible while you scroll the session.">
            {selectedTrace ? (
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}>
                  <Stack direction="row" spacing={1} mb={0.5} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={selectedTrace.type} color={toneForType(selectedTrace.type) as any} />
                    <Chip size="small" label={selectedTrace.function} variant="outlined" />
                    <Chip size="small" label={`Seq ${selectedTrace.sequence ?? '—'}`} variant="outlined" />
                    {selectedTrace.parent_trace_id ? <Chip size="small" label={`Parent ${selectedTrace.parent_reason ?? 'trace'} · ${selectedTrace.parent_trace_id}`} variant="outlined" /> : <Chip size="small" label="Root trace" variant="outlined" />}
                    <Chip size="small" label={new Date(selectedTrace.timestamp).toLocaleString()} variant="outlined" />
                    {selectedEvaluation ? <Chip size="small" label={`Eval ${pct(selectedEvaluation.score)}`} color={toneForStatus(selectedEvaluation.status) as any} variant="outlined" /> : null}
                  </Stack>
                  <Box>
                    <Button variant="contained" color="secondary" onClick={handleOpenExportDialog}>
                      Export to MLflow
                    </Button>
                  </Box>
                </Stack>

                {exportSuccess ? <Alert severity="success" variant="outlined">{exportSuccess}</Alert> : null}
                {exportError ? <Alert severity="error" variant="outlined">{exportError}</Alert> : null}

                <Paper elevation={0} sx={{ p: 2, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(160,185,255,0.12)' }}>
                  <Stack spacing={1.25}>
                    <Typography variant="subtitle2" fontWeight={700}>Trace summary</Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(228,235,255,0.72)' }}>
                      {safeText(selectedTrace) || 'No plain-text preview on this trace.'}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`Session ${selectedTrace.session_id}`} variant="outlined" />
                      <Chip size="small" label={`Trace ${selectedTrace.id}`} variant="outlined" />
                      {(selectedTrace.tags ?? []).map((tag) => <Chip key={tag} size="small" label={tag} variant="outlined" />)}
                    </Stack>
                    {selectedTrace.notes ? <Alert severity="info" variant="outlined">{selectedTrace.notes}</Alert> : null}
                  </Stack>
                </Paper>

                {selectedEvaluation ? (
                  <Paper elevation={0} sx={{ p: 2, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(160,185,255,0.12)' }}>
                    <Stack spacing={1.25}>
                      <Typography variant="subtitle2" fontWeight={700}>Evaluation context</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip size="small" label={selectedEvaluation.label} variant="outlined" />
                        <Chip size="small" label={`Score ${pct(selectedEvaluation.score)}`} color={toneForStatus(selectedEvaluation.status) as any} />
                        <Chip size="small" label={`Band ${selectedEvaluation.score_band ?? 'derived'}`} variant="outlined" />
                        {Object.entries(selectedEvaluation.metrics).map(([metric, value]) => (
                          <Chip key={metric} size="small" label={`${formatMetricLabel(metric)} · ${pct(value)}`} variant="outlined" />
                        ))}
                      </Stack>
                      <Alert severity={selectedEvaluation.status === 'pass' ? 'success' : selectedEvaluation.status === 'warn' ? 'warning' : 'error'} variant="outlined">
                        {describeEvalStatus(selectedEvaluation)}
                      </Alert>
                      {selectedEvaluation.notes.map((note) => (
                        <Typography key={note} variant="body2" sx={{ color: 'rgba(228,235,255,0.72)' }}>• {note}</Typography>
                      ))}
                    </Stack>
                  </Paper>
                ) : null}

                <JsonViewer data={selectedTrace} title="Trace payload" maxHeight={620} />
              </Stack>
            ) : <Typography>No trace selected.</Typography>}
          </SectionCard>
        </Box>
      </Stack>

      <Dialog open={exportDialogOpen} onClose={handleCloseExportDialog} fullWidth maxWidth="sm">
        <DialogTitle>Export to MLflow</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Send the selected trace to an MLflow tracking server as a run. Keep it lightweight: server URL, experiment name, then optional tags.
            </Typography>
            <TextField
              autoFocus
              required
              label="Tracking URI"
              placeholder="http://127.0.0.1:5000"
              value={trackingUri}
              onChange={(event) => setTrackingUri(event.target.value)}
              fullWidth
            />
            <TextField
              label="Experiment name"
              placeholder="copilot-trace"
              value={experimentName}
              onChange={(event) => setExperimentName(event.target.value)}
              fullWidth
            />
            <TextField
              label="Optional tags"
              placeholder="env=local\nowner=tore"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              helperText="Use key=value pairs, one per line or comma-separated."
              multiline
              minRows={3}
              fullWidth
            />
            {Object.keys(parsedTags).length ? (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {Object.entries(parsedTags).map(([key, value]) => (
                  <Chip key={key} size="small" label={`${key}=${value}`} variant="outlined" />
                ))}
              </Stack>
            ) : null}
            {exportError ? <Alert severity="error" variant="outlined">{exportError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseExportDialog} disabled={exportLoading}>Cancel</Button>
          <Button onClick={handleSubmitExport} variant="contained" disabled={exportLoading || !selectedTrace}>
            {exportLoading ? 'Exporting…' : 'Export trace'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
