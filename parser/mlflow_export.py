from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class MlflowExportError(RuntimeError):
    pass


@dataclass
class MlflowExportConfig:
    output_dir: str
    bundle_name: str | None = None
    extra_tags: dict[str, str] | None = None


@dataclass
class MlflowSessionBundle:
    session: dict[str, Any]
    traces: list[dict[str, Any]]
    evaluations: list[dict[str, Any]]
    evaluation_summary: dict[str, Any] | None = None


def export_session_to_mlflow_bundle(*, bundle: MlflowSessionBundle, config: MlflowExportConfig) -> dict[str, Any]:
    output_root = Path(config.output_dir).expanduser()
    bundle_name = _normalize_bundle_name(config.bundle_name or bundle.session.get('session_id') or 'session')
    bundle_dir = output_root / bundle_name
    bundle_dir.mkdir(parents=True, exist_ok=True)

    created_at = datetime.now(timezone.utc).isoformat()
    trace_ids = [str(trace.get('id') or '') for trace in bundle.traces]
    tags = {
        'source': 'copilot-trace',
        'session.id': str(bundle.session.get('session_id') or ''),
        'trace.count': str(len(bundle.traces)),
        'evaluation.count': str(len(bundle.evaluations)),
    }
    if config.extra_tags:
        tags.update({str(key): str(value) for key, value in config.extra_tags.items()})

    params = {
        'session_id': str(bundle.session.get('session_id') or ''),
        'first_timestamp': str(bundle.session.get('first_timestamp') or ''),
        'last_timestamp': str(bundle.session.get('last_timestamp') or ''),
        'bundle_name': bundle_name,
    }
    metrics = {
        'trace_count': float(len(bundle.traces)),
        'annotated_count': float(bundle.session.get('annotated_count') or 0),
        'evaluation_count': float(len(bundle.evaluations)),
    }
    if bundle.evaluation_summary:
        if bundle.evaluation_summary.get('average_score') is not None:
            metrics['average_score'] = float(bundle.evaluation_summary['average_score'])
        for status, count in (bundle.evaluation_summary.get('status_breakdown') or {}).items():
            metrics[f'status_{status}'] = float(count)

    native_trace = _build_native_trace_payload(bundle=bundle, bundle_name=bundle_name, created_at=created_at)

    manifest = {
        'bundle_version': 2,
        'format': 'copilot-trace.mlflow-bundle',
        'created_at': created_at,
        'bundle_name': bundle_name,
        'output_dir': str(output_root),
        'session_id': str(bundle.session.get('session_id') or ''),
        'files': {
            'manifest': 'manifest.json',
            'session': 'session.json',
            'traces': 'traces.json',
            'evaluations': 'evaluations.json',
            'mlflow_run': 'mlflow-run.json',
            'mlflow_trace': 'mlflow-trace.json',
        },
    }

    mlflow_run = {
        'run_name': bundle_name,
        'tags': tags,
        'params': params,
        'metrics': metrics,
        'artifacts': {
            'trace_ids': trace_ids,
            'preview': _string_limit(_best_session_preview(bundle.traces), 4000),
        },
    }

    (bundle_dir / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (bundle_dir / 'session.json').write_text(json.dumps(bundle.session, ensure_ascii=False, indent=2), encoding='utf-8')
    (bundle_dir / 'traces.json').write_text(json.dumps({'count': len(bundle.traces), 'traces': bundle.traces}, ensure_ascii=False, indent=2), encoding='utf-8')
    (bundle_dir / 'evaluations.json').write_text(
        json.dumps(
            {
                'count': len(bundle.evaluations),
                'evaluation_summary': bundle.evaluation_summary,
                'evaluations': bundle.evaluations,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding='utf-8',
    )
    (bundle_dir / 'mlflow-run.json').write_text(json.dumps(mlflow_run, ensure_ascii=False, indent=2), encoding='utf-8')
    (bundle_dir / 'mlflow-trace.json').write_text(json.dumps(native_trace, ensure_ascii=False, indent=2), encoding='utf-8')

    return {
        'output_dir': str(output_root),
        'bundle_dir': str(bundle_dir),
        'bundle_name': bundle_name,
        'files': manifest['files'],
        'trace_count': len(bundle.traces),
        'evaluation_count': len(bundle.evaluations),
        'status': 'WRITTEN',
    }


def config_from_payload(payload: dict[str, Any]) -> MlflowExportConfig:
    output_dir = str(payload.get('output_dir') or os.getenv('MLFLOW_EXPORT_DIR') or '').strip()
    bundle_name = payload.get('bundle_name')
    extra_tags = payload.get('tags') or {}
    if not output_dir:
        raise MlflowExportError('output_dir is required in request body or MLFLOW_EXPORT_DIR env var')
    if extra_tags is not None and not isinstance(extra_tags, dict):
        raise MlflowExportError('tags must be an object of string values')
    return MlflowExportConfig(
        output_dir=output_dir,
        bundle_name=str(bundle_name).strip() if bundle_name else None,
        extra_tags={str(k): str(v) for k, v in (extra_tags or {}).items()},
    )


def _normalize_bundle_name(value: str) -> str:
    normalized = re.sub(r'[^A-Za-z0-9._-]+', '-', value.strip()).strip('-.')
    if not normalized:
        raise MlflowExportError('bundle_name must contain at least one letter or number')
    return normalized[:120]


def _best_session_preview(traces: list[dict[str, Any]]) -> str:
    previews: list[str] = []
    for trace in traces[:12]:
        for key in ('text', 'state', 'description', 'function', 'function_name', 'id'):
            value = trace.get(key)
            if value:
                previews.append(str(value))
                break
    return '\n'.join(previews)


def _string_limit(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 1] + '…'


def _build_native_trace_payload(*, bundle: MlflowSessionBundle, bundle_name: str, created_at: str) -> dict[str, Any]:
    session_id = str(bundle.session.get('session_id') or '')
    root_start = _to_unix_nanos(bundle.session.get('first_timestamp'))
    root_end = _to_unix_nanos(bundle.session.get('last_timestamp'))
    root_id = f'session:{session_id or bundle_name}'

    spans: list[dict[str, Any]] = [
        {
            'id': root_id,
            'parent_id': None,
            'name': f'copilot-session:{session_id or bundle_name}',
            'span_type': 'SESSION',
            'start_time_ns': root_start,
            'end_time_ns': root_end,
            'status': 'OK',
            'inputs': {
                'session_id': session_id,
                'bundle_name': bundle_name,
            },
            'outputs': {
                'trace_count': len(bundle.traces),
                'evaluation_count': len(bundle.evaluations),
            },
            'attributes': {
                'copilot_trace.kind': 'session',
                'copilot_trace.bundle_created_at': created_at,
            },
            'events': [],
        }
    ]

    traces = _with_inferred_trace_parents(bundle.traces)
    known_ids = {str(trace.get('id') or '') for trace in traces if trace.get('id')}
    for index, trace in enumerate(traces):
        trace_id = str(trace.get('id') or f'trace-{index + 1}')
        parent_trace_id = str(trace.get('parent_trace_id') or '').strip()
        parent_id = parent_trace_id if parent_trace_id in known_ids else root_id
        timestamp_ns = _to_unix_nanos(trace.get('timestamp'))
        attributes = {
            'copilot_trace.kind': 'entry',
            'copilot_trace.trace_id': trace_id,
            'copilot_trace.trace_type': str(trace.get('trace_type') or trace.get('type') or 'UNKNOWN'),
            'copilot_trace.function_name': str(trace.get('function_name') or trace.get('function') or ''),
            'copilot_trace.sequence': trace.get('sequence'),
            'copilot_trace.parent_reason': trace.get('parent_reason'),
            'copilot_trace.tool_call_id': trace.get('tool_call_id'),
            'copilot_trace.tags': trace.get('tags') or [],
            'copilot_trace.raw': trace,
        }
        spans.append(
            {
                'id': trace_id,
                'parent_id': parent_id,
                'name': _trace_span_name(trace),
                'span_type': _trace_span_type(trace),
                'start_time_ns': timestamp_ns,
                'end_time_ns': timestamp_ns,
                'status': _trace_status(trace),
                'inputs': _trace_inputs(trace),
                'outputs': _trace_outputs(trace),
                'attributes': {k: v for k, v in attributes.items() if v not in (None, '', [], {})},
                'events': _trace_events(trace),
            }
        )

    normalized_spans = _normalize_native_spans(spans, root_span_id=root_id)
    return {
        'format': 'copilot-trace.mlflow-native-trace',
        'trace_version': 2,
        'session_id': session_id,
        'bundle_name': bundle_name,
        'root_span_id': root_id,
        'spans': normalized_spans,
    }


def _with_inferred_trace_parents(traces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sorted_traces = sorted(
        traces,
        key=lambda trace: (
            str(trace.get('timestamp') or ''),
            int(trace.get('sequence') or 0),
            str(trace.get('id') or ''),
        ),
    )
    message_ids = {
        str(trace.get('message_id')): str(trace.get('id'))
        for trace in sorted_traces
        if trace.get('message_id')
        and trace.get('id')
        and str(trace.get('trace_type') or trace.get('type') or '').upper() not in {'TOOL_CALL', 'TOOL_RESULT'}
    }
    tool_call_ids = {
        str(trace.get('tool_call_id')): str(trace.get('id'))
        for trace in sorted_traces
        if trace.get('tool_call_id') and trace.get('id') and str(trace.get('trace_type') or trace.get('type') or '').upper() == 'TOOL_CALL'
    }

    enriched: list[dict[str, Any]] = []
    for trace in sorted_traces:
        trace_type = str(trace.get('trace_type') or trace.get('type') or '').upper()
        parent_trace_id = str(trace.get('parent_trace_id') or '').strip() or None
        parent_reason = trace.get('parent_reason')
        if not parent_trace_id and trace_type == 'TOOL_CALL':
            parent_trace_id = message_ids.get(str(trace.get('message_id') or ''))
            parent_reason = 'message' if parent_trace_id else parent_reason
        elif not parent_trace_id and trace_type == 'TOOL_RESULT':
            parent_trace_id = tool_call_ids.get(str(trace.get('tool_call_id') or ''))
            parent_reason = 'tool_call' if parent_trace_id else parent_reason
        enriched.append(
            {
                **trace,
                'parent_trace_id': parent_trace_id,
                'parent_reason': parent_reason,
            }
        )
    return enriched


def _trace_span_name(trace: dict[str, Any]) -> str:
    return str(
        trace.get('function_name')
        or trace.get('function')
        or trace.get('trace_type')
        or trace.get('type')
        or trace.get('id')
        or 'copilot.trace'
    )


def _trace_span_type(trace: dict[str, Any]) -> str:
    trace_type = str(trace.get('trace_type') or trace.get('type') or '').upper()
    if trace_type == 'TOOL_CALL':
        return 'TOOL'
    if trace_type == 'TOOL_RESULT':
        return 'TOOL'
    if 'USER' in trace_type:
        return 'CHAT_MODEL'
    if 'ASSISTANT' in trace_type or 'MODEL' in trace_type:
        return 'LLM'
    return 'CHAIN'


def _trace_status(trace: dict[str, Any]) -> str:
    status = str(trace.get('status') or '').strip().lower()
    if status in {'error', 'failed', 'failure', 'cancelled', 'canceled'}:
        return 'ERROR'
    return 'OK'


def _trace_inputs(trace: dict[str, Any]) -> Any:
    for key in ('input', 'inputs', 'arguments', 'args', 'prompt', 'message', 'text'):
        if key in trace and trace.get(key) not in (None, ''):
            return trace.get(key)
    return {
        key: trace.get(key)
        for key in ('trace_type', 'function_name', 'timestamp')
        if trace.get(key) not in (None, '')
    }


def _trace_outputs(trace: dict[str, Any]) -> Any:
    for key in ('output', 'outputs', 'result', 'response', 'value', 'result_preview', 'state'):
        if key in trace and trace.get(key) not in (None, ''):
            return trace.get(key)
    return None


def _trace_events(trace: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    notes = trace.get('notes')
    if notes:
        events.append({'name': 'copilot.notes', 'timestamp_unix_nano': _to_unix_nanos(trace.get('timestamp')), 'attributes': {'notes': notes}})
    evaluations = trace.get('evaluations') or []
    for evaluation in evaluations:
        events.append(
            {
                'name': 'copilot.evaluation',
                'timestamp_unix_nano': _to_unix_nanos(evaluation.get('timestamp') or trace.get('timestamp')),
                'attributes': evaluation,
            }
        )
    return events


def _normalize_native_spans(spans: list[dict[str, Any]], *, root_span_id: str) -> list[dict[str, Any]]:
    if not spans:
        return []

    spans_by_id = {str(span.get('id')): dict(span) for span in spans if span.get('id')}
    if root_span_id not in spans_by_id:
        raise MlflowExportError(f'Native trace root span is missing: {root_span_id}')

    all_times = [
        int(value)
        for span in spans_by_id.values()
        for value in (span.get('start_time_ns'), span.get('end_time_ns'))
        if isinstance(value, (int, float)) and int(value) > 0
    ]
    time_seed = min(all_times) if all_times else int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)

    original_order = {span_id: index for index, span_id in enumerate(spans_by_id)}
    for span_id, span in spans_by_id.items():
        parent_id = span.get('parent_id')
        if span_id == root_span_id:
            parent_id = None
        elif parent_id and parent_id not in spans_by_id:
            parent_id = root_span_id
        elif parent_id in ('', None):
            parent_id = root_span_id
        span['parent_id'] = parent_id

    def sort_key(span_id: str) -> tuple[int, int, str]:
        span = spans_by_id[span_id]
        base_start = span.get('start_time_ns')
        start_ns = int(base_start) if isinstance(base_start, (int, float)) and int(base_start) > 0 else time_seed + original_order[span_id]
        return (start_ns, original_order[span_id], span_id)

    children_by_parent: dict[str | None, list[str]] = {}
    for span_id, span in spans_by_id.items():
        parent_id = span.get('parent_id')
        if span_id == parent_id:
            parent_id = root_span_id if span_id != root_span_id else None
            span['parent_id'] = parent_id
        children_by_parent.setdefault(parent_id, []).append(span_id)
    for child_ids in children_by_parent.values():
        child_ids.sort(key=sort_key)

    ordered_ids: list[str] = []
    visited: set[str] = set()

    def visit(span_id: str) -> None:
        if span_id in visited:
            return
        visited.add(span_id)
        ordered_ids.append(span_id)
        for child_id in children_by_parent.get(span_id, []):
            if child_id != span_id:
                visit(child_id)

    visit(root_span_id)
    for span_id in sorted((span_id for span_id in spans_by_id if span_id not in visited), key=sort_key):
        visit(span_id)

    for index, span_id in enumerate(ordered_ids):
        span = spans_by_id[span_id]
        base_start = span.get('start_time_ns')
        start_ns = int(base_start) if isinstance(base_start, (int, float)) and int(base_start) > 0 else time_seed + index
        base_end = span.get('end_time_ns')
        end_ns = int(base_end) if isinstance(base_end, (int, float)) and int(base_end) > 0 else start_ns + 1
        if end_ns < start_ns:
            end_ns = start_ns + 1

        span['start_time_ns'] = start_ns
        span['end_time_ns'] = end_ns
        span['name'] = str(span.get('name') or span_id)
        span['span_type'] = str(span.get('span_type') or 'CHAIN')
        span['status'] = str(span.get('status') or 'OK')
        span['inputs'] = _normalize_mlflow_value(span.get('inputs'))
        span['outputs'] = _normalize_mlflow_value(span.get('outputs'))
        span['attributes'] = _normalize_mlflow_attributes(span.get('attributes') or {})
        span['events'] = _normalize_mlflow_events(span.get('events') or [], default_timestamp=start_ns)

    return [spans_by_id[span_id] for span_id in ordered_ids]


def _normalize_mlflow_events(events: list[dict[str, Any]], *, default_timestamp: int) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            continue
        timestamp = event.get('timestamp_unix_nano')
        if not isinstance(timestamp, (int, float)) or int(timestamp) <= 0:
            timestamp = default_timestamp + index
        normalized.append(
            {
                'name': str(event.get('name') or f'event-{index + 1}'),
                'timestamp_unix_nano': int(timestamp),
                'attributes': _normalize_mlflow_attributes(event.get('attributes') or {}),
            }
        )
    return normalized


def _normalize_mlflow_attributes(value: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if item is None:
            continue
        normalized[str(key)] = _normalize_mlflow_attribute_value(item)
    return normalized


def _normalize_mlflow_attribute_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)):
        return value
    return json.dumps(_json_safe(value), ensure_ascii=False, sort_keys=True)


def _normalize_mlflow_value(value: Any) -> Any:
    if value is None:
        return None
    return _json_safe(value)


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return str(value)


def _to_unix_nanos(value: Any) -> int | None:
    if value in (None, ''):
        return None
    if isinstance(value, (int, float)):
        numeric = int(value)
        if numeric > 10_000_000_000_000_000:
            return numeric
        if numeric > 10_000_000_000_000:
            return numeric * 1_000
        if numeric > 10_000_000_000:
            return numeric * 1_000_000
        return numeric * 1_000_000_000
    text = str(value).strip()
    if not text:
        return None
    try:
        return _to_unix_nanos(int(text))
    except ValueError:
        pass
    try:
        if text.endswith('Z'):
            text = text[:-1] + '+00:00'
        return int(datetime.fromisoformat(text).timestamp() * 1_000_000_000)
    except ValueError:
        return None
