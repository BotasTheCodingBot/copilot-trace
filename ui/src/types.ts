export interface Trace {
  id: string
  session_id: string
  timestamp: string
  type: string
  function: string
  trace_type?: string
  function_name?: string
  tags?: string[] | null
  notes?: string | null
  sequence?: number
  sequence_id?: string
  parent_trace_id?: string | null
  parent_reason?: string | null
  [key: string]: any
}

export interface Evaluation {
  id: string
  session_id: string
  timestamp: string
  target_trace_id: string
  label: string
  score: number
  status: 'pass' | 'warn' | 'fail' | string
  metrics: Record<string, number>
  notes: string[]
  status_explanation?: string
  score_band?: 'excellent' | 'strong' | 'needs_review' | 'high_risk' | string
}

export interface EvaluationSessionSummary {
  session_id: string
  evaluation_count: number
  average_score: number
  latest_score: number
  latest_status: 'pass' | 'warn' | 'fail' | string
  score_delta: number
  score_min: number
  score_max: number
  score_stddev: number
  improving: boolean
  status_breakdown: Record<string, number>
  history: Evaluation[]
}

export interface TraceSessionSummary {
  session_id: string
  trace_count: number
  first_timestamp: string
  last_timestamp: string
  annotated_count?: number
  evaluation?: EvaluationSessionSummary
}

export interface TraceBundle {
  count: number
  total?: number
  traces: Trace[]
  evaluations?: Evaluation[]
  evaluation_sessions?: EvaluationSessionSummary[]
}

export interface PagedResponse<T> {
  count: number
  total: number
  offset: number
  limit: number | null
  pages: number
}

export interface TraceListResponse extends PagedResponse<Trace> {
  traces: Trace[]
  evaluations?: Evaluation[]
  available_filters?: {
    types: string[]
    tags: string[]
  }
}

export interface SessionListResponse extends PagedResponse<TraceSessionSummary> {
  sessions: TraceSessionSummary[]
}

export interface EvaluationListResponse extends PagedResponse<Evaluation> {
  evaluations: Evaluation[]
}
