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

    manifest = {
        'bundle_version': 1,
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
