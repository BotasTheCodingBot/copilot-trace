from __future__ import annotations

import dataclasses
import statistics
from collections import defaultdict
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from parser.copilot_parser import TraceRow


@dataclasses.dataclass
class EvaluationRow:
    id: str
    session_id: str
    timestamp: str
    target_trace_id: str
    label: str
    score: float
    status: str
    metrics: dict[str, float]
    notes: list[str]
    status_explanation: str
    score_band: str


class TraceEvaluator:
    """Small heuristic evaluator for Copilot trace sessions.

    This is intentionally lightweight for the first framework pass: it scores
    assistant turns using observable trace signals so the API/UI can surface
    evaluation history before a richer benchmark runner lands.
    """

    def evaluate_rows(self, rows: Iterable['TraceRow']) -> list[EvaluationRow]:
        trace_rows = list(rows)
        rows_by_message: dict[tuple[str, str], list[TraceRow]] = defaultdict(list)
        evaluations: list[EvaluationRow] = []

        for row in trace_rows:
            message_id = row.data.get('message_id')
            if message_id:
                rows_by_message[(row.session_id, str(message_id))].append(row)

        for row in trace_rows:
            if row.trace_type != 'ASSISTANT_MESSAGE':
                continue
            message_id = str(row.data.get('message_id') or row.id)
            related = rows_by_message.get((row.session_id, message_id), [row])
            evaluations.append(self._evaluate_assistant_turn(row, related))

        return evaluations

    def summarize(self, evaluations: Iterable[EvaluationRow]) -> list[dict[str, Any]]:
        grouped: dict[str, list[EvaluationRow]] = defaultdict(list)
        for evaluation in evaluations:
            grouped[evaluation.session_id].append(evaluation)

        summaries: list[dict[str, Any]] = []
        for session_id, session_evals in grouped.items():
            session_evals.sort(key=lambda item: (item.timestamp, item.id))
            scores = [item.score for item in session_evals]
            latest = session_evals[-1]
            status_counts: dict[str, int] = defaultdict(int)
            for item in session_evals:
                status_counts[item.status] += 1

            summaries.append(
                {
                    'session_id': session_id,
                    'evaluation_count': len(session_evals),
                    'average_score': round(sum(scores) / len(scores), 3),
                    'latest_score': latest.score,
                    'latest_status': latest.status,
                    'score_delta': round(latest.score - session_evals[0].score, 3),
                    'score_min': min(scores),
                    'score_max': max(scores),
                    'score_stddev': round(statistics.pstdev(scores), 3) if len(scores) > 1 else 0.0,
                    'history': [self.to_payload(item) for item in session_evals],
                    'status_breakdown': dict(status_counts),
                    'improving': len(scores) > 1 and latest.score >= session_evals[0].score,
                }
            )

        summaries.sort(key=lambda item: (item['session_id']))
        return summaries

    def to_payload(self, evaluation: EvaluationRow) -> dict[str, Any]:
        return {
            'id': evaluation.id,
            'session_id': evaluation.session_id,
            'timestamp': evaluation.timestamp,
            'target_trace_id': evaluation.target_trace_id,
            'label': evaluation.label,
            'score': evaluation.score,
            'status': evaluation.status,
            'metrics': evaluation.metrics,
            'notes': evaluation.notes,
            'status_explanation': evaluation.status_explanation,
            'score_band': evaluation.score_band,
        }

    def _evaluate_assistant_turn(self, row: TraceRow, related_rows: list[TraceRow]) -> EvaluationRow:
        text = str(row.data.get('text') or '').strip()
        tool_calls = [item for item in related_rows if item.trace_type == 'TOOL_CALL']
        tool_results = [item for item in related_rows if item.trace_type == 'TOOL_RESULT']

        tool_successes = sum(1 for item in tool_results if self._status_value(item.data.get('status')) == 1)
        tool_failures = sum(1 for item in tool_results if self._status_value(item.data.get('status')) and self._status_value(item.data.get('status')) != 1)
        length_score = min(len(text) / 500, 1.0) if text else 0.0
        tool_usage_score = min(len(tool_calls) / 3, 1.0)
        tool_success_score = (tool_successes / len(tool_results)) if tool_results else 0.5
        explanation_score = 1.0 if any(token in text.lower() for token in ('because', 'next', 'plan', 'i\'ll', 'i will', 'updated', 'change')) else (0.55 if text else 0.0)

        weighted = {
            'answer_presence': 1.0 if text else 0.0,
            'answer_depth': round(length_score, 3),
            'tool_usage': round(tool_usage_score, 3),
            'tool_success': round(tool_success_score, 3),
            'reasoning_signal': round(explanation_score, 3),
        }
        score = round(
            weighted['answer_presence'] * 0.25
            + weighted['answer_depth'] * 0.2
            + weighted['tool_usage'] * 0.15
            + weighted['tool_success'] * 0.2
            + weighted['reasoning_signal'] * 0.2,
            3,
        )

        notes: list[str] = []
        if not text:
            notes.append('Assistant turn has no text payload.')
        if tool_failures:
            notes.append(f'{tool_failures} tool result(s) reported non-success status.')
        if tool_successes and not tool_failures:
            notes.append(f'{tool_successes} tool result(s) completed successfully.')
        if len(text) < 120:
            notes.append('Response is short; depth score is conservative.')
        if not notes:
            notes.append('Balanced response with usable trace signal.')

        status = 'pass' if score >= 0.75 else 'warn' if score >= 0.5 else 'fail'
        score_band = self._score_band(score)
        status_explanation = self._status_explanation(status, score, weighted, notes)
        return EvaluationRow(
            id=f'eval:{row.id}',
            session_id=row.session_id,
            timestamp=row.timestamp,
            target_trace_id=row.id,
            label='assistant_turn_quality',
            score=score,
            status=status,
            metrics=weighted,
            notes=notes,
            status_explanation=status_explanation,
            score_band=score_band,
        )


    def _score_band(self, score: float) -> str:
        if score >= 0.9:
            return 'excellent'
        if score >= 0.75:
            return 'strong'
        if score >= 0.5:
            return 'needs_review'
        return 'high_risk'

    def _status_explanation(self, status: str, score: float, metrics: dict[str, float], notes: list[str]) -> str:
        thresholds = 'pass ≥ 75%, warn ≥ 50%, fail < 50%'
        weakest_metric = min(metrics.items(), key=lambda item: item[1])[0].replace('_', ' ')
        strongest_metric = max(metrics.items(), key=lambda item: item[1])[0].replace('_', ' ')
        summary_note = notes[0] if notes else 'No evaluator note recorded.'
        if status == 'pass':
            return f'Scored {score:.0%}, which lands in pass territory ({thresholds}). Strongest signal: {strongest_metric}. Main note: {summary_note}'
        if status == 'warn':
            return f'Scored {score:.0%}, which lands in warn territory ({thresholds}). Review recommended because the weakest signal was {weakest_metric}. Main note: {summary_note}'
        return f'Scored {score:.0%}, which lands in fail territory ({thresholds}). Immediate follow-up suggested because the weakest signal was {weakest_metric}. Main note: {summary_note}'

    def _status_value(self, value: Any) -> int | None:
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, int):
            return value
        return None
