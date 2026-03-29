import { Box, Paper, Stack, Typography } from '@mui/material'

interface Props {
  data: any
  title?: string
}

const renderNode = (label: string, value: any, depth = 0): any => {
  const isObject = value && typeof value === 'object'
  return (
    <Box key={`${label}-${depth}`} sx={{ ml: depth * 2, pl: 1.5, borderLeft: depth ? '1px solid rgba(255,255,255,0.12)' : 'none' }}>
      <Typography variant="caption" sx={{ color: '#7dd3a7', letterSpacing: '0.04em' }}>{label}</Typography>
      {isObject ? (
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {Object.entries(value).slice(0, 12).map(([childKey, childValue]) => renderNode(childKey, childValue, depth + 1))}
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.82)', wordBreak: 'break-word' }}>{String(value)}</Typography>
      )}
    </Box>
  )
}

export default function TraceVisualizer({ data, title = 'Trace graph' }: Props) {
  return (
    <Paper elevation={0} sx={{ p: 2, mb: 2, backgroundColor: '#0f1528', border: '1px solid rgba(255,255,255,0.06)' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>{title}</Typography>
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.62)', mb: 2 }}>
        Lightweight AgentTrace-style structural view. It is intentionally simple for the first pass, while the richer TensorStax-style interactive graph can replace this once the data model stabilizes.
      </Typography>
      <Stack spacing={1}>
        {Object.entries(data || {}).slice(0, 16).map(([key, value]) => renderNode(key, value, 0))}
      </Stack>
    </Paper>
  )
}
