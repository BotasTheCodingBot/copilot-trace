from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


class MlflowExportError(RuntimeError):
    pass


@dataclass
class MlflowExportConfig:
    tracking_uri: str
    experiment_name: str = 'copilot-trace'
    run_name: str | None = None
    extra_tags: dict[str, str] | None = None


class MlflowRestClient:
    """Small dependency-free MLflow Tracking REST client.

    First implementation intentionally exports a selected trace as a standard MLflow run.
    That gives us a low-friction integration path without introducing a hard mlflow Python
    package dependency into this repo.
    """

    def __init__(self, tracking_uri: str):
        if not tracking_uri:
            raise MlflowExportError('tracking_uri is required')
        self.tracking_uri = tracking_uri.rstrip('/')

    def ensure_experiment(self, name: str) -> str:
        query = urllib.parse.urlencode({'experiment_name': name})
        try:
            payload = self._request('GET', f'/api/2.0/mlflow/experiments/get-by-name?{query}')
            experiment = payload.get('experiment') or {}
            experiment_id = experiment.get('experiment_id')
            if experiment_id:
                return str(experiment_id)
        except MlflowExportError:
            pass

        created = self._request('POST', '/api/2.0/mlflow/experiments/create', {'name': name})
        experiment_id = created.get('experiment_id')
        if not experiment_id:
            raise MlflowExportError('MLflow did not return experiment_id')
        return str(experiment_id)

    def create_run(self, *, experiment_id: str, run_name: str, tags: dict[str, str]) -> dict[str, Any]:
        payload = {
            'experiment_id': str(experiment_id),
            'run_name': run_name,
            'start_time': int(datetime.now(timezone.utc).timestamp() * 1000),
            'tags': [{'key': key, 'value': value} for key, value in tags.items()],
        }
        response = self._request('POST', '/api/2.0/mlflow/runs/create', payload)
        run = response.get('run') or {}
        info = run.get('info') or {}
        if not info.get('run_id'):
            raise MlflowExportError('MLflow did not return run.info.run_id')
        return run

    def log_batch(
        self,
        *,
        run_id: str,
        params: dict[str, str] | None = None,
        metrics: dict[str, float] | None = None,
        tags: dict[str, str] | None = None,
    ) -> None:
        payload: dict[str, Any] = {'run_id': run_id}
        if params:
            payload['params'] = [{'key': key, 'value': value} for key, value in params.items()]
        if metrics:
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            payload['metrics'] = [
                {'key': key, 'value': float(value), 'timestamp': now_ms, 'step': 0}
                for key, value in metrics.items()
            ]
        if tags:
            payload['tags'] = [{'key': key, 'value': value} for key, value in tags.items()]
        self._request('POST', '/api/2.0/mlflow/runs/log-batch', payload)

    def finalize_run(self, *, run_id: str, status: str = 'FINISHED') -> None:
        self._request(
            'POST',
            '/api/2.0/mlflow/runs/update',
            {
                'run_id': run_id,
                'status': status,
                'end_time': int(datetime.now(timezone.utc).timestamp() * 1000),
            },
        )

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        url = f'{self.tracking_uri}{path}'
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header('Accept', 'application/json')
        if payload is not None:
            request.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode('utf-8', errors='replace')
            raise MlflowExportError(f'MLflow request failed: {exc.code} {exc.reason}: {body}') from exc
        except urllib.error.URLError as exc:
            raise MlflowExportError(f'Unable to reach MLflow at {url}: {exc.reason}') from exc

        if not raw:
            return {}
        return json.loads(raw.decode('utf-8'))


def export_trace_to_mlflow(
    *,
    client: MlflowRestClient,
    trace: dict[str, Any],
    config: MlflowExportConfig,
    evaluation_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    experiment_id = client.ensure_experiment(config.experiment_name)

    run_name = config.run_name or _default_run_name(trace)
    base_tags = {
        'source': 'copilot-trace',
        'trace.id': str(trace.get('id') or ''),
        'trace.session_id': str(trace.get('session_id') or ''),
        'trace.type': str(trace.get('trace_type') or trace.get('type') or ''),
        'trace.function': str(trace.get('function_name') or trace.get('function') or ''),
        'trace.sequence_id': str(trace.get('sequence_id') or ''),
    }
    if trace.get('parent_trace_id'):
        base_tags['trace.parent_id'] = str(trace['parent_trace_id'])
    for tag in trace.get('tags') or []:
        tag_value = str(tag).strip()
        if tag_value:
            base_tags[f'trace.tag.{tag_value}'] = 'true'
    if trace.get('notes'):
        base_tags['trace.notes_present'] = 'true'
    if config.extra_tags:
        base_tags.update({str(k): str(v) for k, v in config.extra_tags.items()})

    run = client.create_run(experiment_id=experiment_id, run_name=run_name, tags=base_tags)
    run_id = str((run.get('info') or {}).get('run_id'))

    params = {
        'trace_id': str(trace.get('id') or ''),
        'session_id': str(trace.get('session_id') or ''),
        'trace_type': str(trace.get('trace_type') or trace.get('type') or ''),
        'function_name': str(trace.get('function_name') or trace.get('function') or ''),
        'timestamp': str(trace.get('timestamp') or ''),
        'sequence': str(trace.get('sequence') or ''),
    }
    metrics: dict[str, float] = {}
    if evaluation_summary:
        if evaluation_summary.get('count') is not None:
            metrics['evaluation_count'] = float(evaluation_summary['count'])
        if evaluation_summary.get('average_score') is not None:
            metrics['average_score'] = float(evaluation_summary['average_score'])
        for status, count in (evaluation_summary.get('status_breakdown') or {}).items():
            metrics[f'status_{status}'] = float(count)

    detail_tags = {
        'trace.preview': _string_limit(_best_trace_preview(trace), 4000),
        'trace.payload': _string_limit(json.dumps(trace, ensure_ascii=False), 5000),
    }

    try:
        client.log_batch(run_id=run_id, params=params, metrics=metrics, tags=detail_tags)
        client.finalize_run(run_id=run_id, status='FINISHED')
    except Exception:
        try:
            client.finalize_run(run_id=run_id, status='FAILED')
        finally:
            raise

    return {
        'tracking_uri': client.tracking_uri,
        'experiment_id': experiment_id,
        'run_id': run_id,
        'run_name': run_name,
        'status': 'FINISHED',
    }


def config_from_payload(payload: dict[str, Any]) -> MlflowExportConfig:
    tracking_uri = str(payload.get('tracking_uri') or os.getenv('MLFLOW_TRACKING_URI') or '').strip()
    experiment_name = str(payload.get('experiment_name') or os.getenv('MLFLOW_EXPERIMENT_NAME') or 'copilot-trace').strip()
    run_name = payload.get('run_name')
    extra_tags = payload.get('tags') or {}
    if not tracking_uri:
        raise MlflowExportError('tracking_uri is required in request body or MLFLOW_TRACKING_URI env var')
    if extra_tags is not None and not isinstance(extra_tags, dict):
        raise MlflowExportError('tags must be an object of string values')
    return MlflowExportConfig(
        tracking_uri=tracking_uri,
        experiment_name=experiment_name or 'copilot-trace',
        run_name=str(run_name).strip() if run_name else None,
        extra_tags={str(k): str(v) for k, v in (extra_tags or {}).items()},
    )


def _default_run_name(trace: dict[str, Any]) -> str:
    function_name = str(trace.get('function_name') or trace.get('function') or 'trace')
    trace_type = str(trace.get('trace_type') or trace.get('type') or 'TRACE')
    trace_id = str(trace.get('id') or '')[:12]
    return f'{trace_type.lower()}::{function_name}::{trace_id}'


def _best_trace_preview(trace: dict[str, Any]) -> str:
    for key in ('text', 'state', 'description'):
        value = trace.get(key)
        if value:
            return str(value)
    return str(trace.get('id') or 'trace')


def _string_limit(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: limit - 1] + '…'
