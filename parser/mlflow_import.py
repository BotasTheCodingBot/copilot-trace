from __future__ import annotations

import argparse
import importlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class MlflowImportError(RuntimeError):
    pass


@dataclass
class MlflowImportBundle:
    bundle_dir: Path
    manifest: dict[str, Any]
    session: dict[str, Any]
    traces_payload: dict[str, Any]
    evaluations_payload: dict[str, Any]
    run_payload: dict[str, Any]
    trace_payload: dict[str, Any]


@dataclass
class MlflowImportConfig:
    bundle_dir: str
    tracking_uri: str | None = None
    experiment_name: str | None = None
    run_name: str | None = None
    artifact_path: str | None = 'copilot_trace_bundle'
    set_terminated: bool = True
    import_traces: bool = True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='import_bundle_to_mlflow.py',
        description='Import a copilot-trace MLflow bundle into an MLflow run, trace, and artifacts.',
    )
    parser.add_argument('bundle_dir', help='Path to the exported bundle directory containing manifest.json')
    parser.add_argument('--tracking-uri', help='MLflow tracking URI (for local runs, use a file: URI or local server URI)')
    parser.add_argument('--experiment-name', help='Create/select this MLflow experiment before starting the run')
    parser.add_argument('--run-name', help='Override the run name stored in mlflow-run.json')
    parser.add_argument(
        '--artifact-path',
        default='copilot_trace_bundle',
        help='Artifact subdirectory inside the MLflow run. Use empty string to log at the root.',
    )
    parser.add_argument(
        '--no-set-terminated',
        action='store_true',
        help='Skip explicitly setting the run to FINISHED after logging.',
    )
    parser.add_argument(
        '--no-import-traces',
        action='store_true',
        help='Skip replaying the exported native MLflow trace payload.',
    )
    return parser


def load_bundle(bundle_dir: str | Path) -> MlflowImportBundle:
    path = Path(bundle_dir).expanduser().resolve()
    if not path.exists():
        raise MlflowImportError(f'Bundle directory does not exist: {path}')
    if not path.is_dir():
        raise MlflowImportError(f'Bundle path is not a directory: {path}')

    manifest = _read_json(path / 'manifest.json')
    _validate_manifest(manifest, path)
    files = manifest.get('files') or {}
    session = _read_json(path / str(files.get('session') or 'session.json'))
    traces_payload = _read_json(path / str(files.get('traces') or 'traces.json'))
    evaluations_payload = _read_json(path / str(files.get('evaluations') or 'evaluations.json'))
    run_payload = _read_json(path / str(files.get('mlflow_run') or 'mlflow-run.json'))
    trace_payload = _read_json(path / str(files.get('mlflow_trace') or 'mlflow-trace.json')) if (path / str(files.get('mlflow_trace') or 'mlflow-trace.json')).exists() else {}

    return MlflowImportBundle(
        bundle_dir=path,
        manifest=manifest,
        session=session,
        traces_payload=traces_payload,
        evaluations_payload=evaluations_payload,
        run_payload=run_payload,
        trace_payload=trace_payload,
    )


def import_bundle_to_mlflow(*, config: MlflowImportConfig, mlflow_module: Any | None = None) -> dict[str, Any]:
    bundle = load_bundle(config.bundle_dir)
    mlflow = mlflow_module or _load_mlflow_module()

    if config.tracking_uri:
        mlflow.set_tracking_uri(config.tracking_uri)
    if config.experiment_name:
        mlflow.set_experiment(config.experiment_name)

    run_name = config.run_name or str(bundle.run_payload.get('run_name') or bundle.manifest.get('bundle_name') or bundle.bundle_dir.name)
    artifact_path = (config.artifact_path or '').strip() or None

    active_run = mlflow.start_run(run_name=run_name)
    run_id = _extract_run_id(active_run)

    tags = {str(key): str(value) for key, value in (bundle.run_payload.get('tags') or {}).items()}
    params = {str(key): _stringify(value) for key, value in (bundle.run_payload.get('params') or {}).items()}
    metrics = _coerce_metrics(bundle.run_payload.get('metrics') or {})

    import_tags = {
        'copilot_trace.bundle_format': str(bundle.manifest.get('format') or ''),
        'copilot_trace.bundle_version': str(bundle.manifest.get('bundle_version') or ''),
        'copilot_trace.bundle_dir': str(bundle.bundle_dir),
    }
    if bundle.manifest.get('created_at'):
        import_tags['copilot_trace.bundle_created_at'] = str(bundle.manifest['created_at'])

    trace_result = {'imported': False, 'span_count': 0}
    if config.import_traces and bundle.trace_payload:
        trace_result = _import_native_trace_payload(bundle=bundle, mlflow=mlflow, run_id=run_id)
        if trace_result.get('trace_id'):
            import_tags['copilot_trace.imported_trace_id'] = str(trace_result['trace_id'])

    mlflow.set_tags({**tags, **import_tags})
    if params:
        mlflow.log_params(params)
    for metric_name, metric_value in metrics.items():
        mlflow.log_metric(metric_name, metric_value)

    mlflow.log_artifacts(str(bundle.bundle_dir), artifact_path=artifact_path)

    if config.set_terminated:
        mlflow.end_run(status='FINISHED')

    return {
        'run_id': run_id,
        'run_name': run_name,
        'tracking_uri': config.tracking_uri,
        'experiment_name': config.experiment_name,
        'artifact_path': artifact_path or '',
        'bundle_dir': str(bundle.bundle_dir),
        'trace_count': int(bundle.traces_payload.get('count') or len(bundle.traces_payload.get('traces') or [])),
        'evaluation_count': int(bundle.evaluations_payload.get('count') or len(bundle.evaluations_payload.get('evaluations') or [])),
        'session_id': str(bundle.session.get('session_id') or bundle.manifest.get('session_id') or ''),
        'mlflow_trace': trace_result,
        'status': 'IMPORTED',
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = import_bundle_to_mlflow(
        config=MlflowImportConfig(
            bundle_dir=args.bundle_dir,
            tracking_uri=args.tracking_uri,
            experiment_name=args.experiment_name,
            run_name=args.run_name,
            artifact_path=args.artifact_path,
            set_terminated=not args.no_set_terminated,
            import_traces=not args.no_import_traces,
        )
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def _load_mlflow_module() -> Any:
    try:
        return importlib.import_module('mlflow')
    except ModuleNotFoundError as exc:
        raise MlflowImportError(
            'mlflow is required for bundle import. Install it first, for example: pip install mlflow'
        ) from exc


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise MlflowImportError(f'Missing bundle file: {path}')
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise MlflowImportError(f'Invalid JSON in {path}: {exc}') from exc
    if not isinstance(payload, dict):
        raise MlflowImportError(f'Expected JSON object in {path}')
    return payload


def _validate_manifest(manifest: dict[str, Any], bundle_dir: Path) -> None:
    if manifest.get('format') != 'copilot-trace.mlflow-bundle':
        raise MlflowImportError(f'Unsupported bundle format in {bundle_dir / "manifest.json"}')


def _coerce_metrics(metrics: dict[str, Any]) -> dict[str, float]:
    coerced: dict[str, float] = {}
    for key, value in metrics.items():
        try:
            coerced[str(key)] = float(value)
        except (TypeError, ValueError) as exc:
            raise MlflowImportError(f'Metric {key!r} must be numeric, got {value!r}') from exc
    return coerced


def _stringify(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _extract_run_id(active_run: Any) -> str:
    info = getattr(active_run, 'info', None)
    run_id = getattr(info, 'run_id', None)
    if run_id:
        return str(run_id)
    return ''


def _import_native_trace_payload(*, bundle: MlflowImportBundle, mlflow: Any, run_id: str) -> dict[str, Any]:
    payload = bundle.trace_payload
    spans_payload = payload.get('spans') or []
    if not spans_payload:
        return {'imported': False, 'span_count': 0, 'reason': 'no_spans_in_bundle'}
    if not hasattr(mlflow, 'start_span_no_context'):
        return {'imported': False, 'span_count': 0, 'reason': 'mlflow_tracing_api_unavailable'}

    spans_by_id = {str(item.get('id')): item for item in spans_payload if item.get('id')}
    children_by_parent: dict[str | None, list[dict[str, Any]]] = {}
    for span_payload in spans_payload:
        parent_id = span_payload.get('parent_id')
        if parent_id and parent_id not in spans_by_id:
            parent_id = None
        children_by_parent.setdefault(parent_id, []).append(span_payload)

    def sort_key(item: dict[str, Any]) -> tuple[int, str]:
        start = item.get('start_time_ns')
        normalized_start = int(start) if isinstance(start, (int, float)) else 0
        return (normalized_start, str(item.get('id') or ''))

    for items in children_by_parent.values():
        items.sort(key=sort_key)

    imported_spans: dict[str, Any] = {}

    def create_span(span_payload: dict[str, Any], parent_live_span: Any | None = None) -> None:
        attributes = dict(span_payload.get('attributes') or {})
        if run_id:
            attributes.setdefault('run_id', run_id)
        live_span = mlflow.start_span_no_context(
            name=str(span_payload.get('name') or span_payload.get('id') or 'copilot.trace'),
            span_type=str(span_payload.get('span_type') or 'CHAIN'),
            parent_span=parent_live_span,
            inputs=span_payload.get('inputs'),
            attributes=attributes,
            start_time_ns=span_payload.get('start_time_ns'),
        )
        imported_spans[str(span_payload.get('id'))] = live_span
        for event in span_payload.get('events') or []:
            _add_event(mlflow=mlflow, live_span=live_span, event_payload=event)
        for child in children_by_parent.get(span_payload.get('id'), []):
            create_span(child, live_span)
        live_span.end(
            outputs=span_payload.get('outputs'),
            status=span_payload.get('status') or 'OK',
            end_time_ns=span_payload.get('end_time_ns'),
        )

    for root_span in children_by_parent.get(None, []):
        create_span(root_span)

    trace_id = ''
    root_span_id = payload.get('root_span_id')
    if root_span_id and root_span_id in imported_spans:
        trace_id = str(getattr(imported_spans[root_span_id], 'trace_id', '') or '')
    elif imported_spans:
        first_span = next(iter(imported_spans.values()))
        trace_id = str(getattr(first_span, 'trace_id', '') or '')

    return {
        'imported': True,
        'trace_id': trace_id,
        'root_span_id': payload.get('root_span_id') or '',
        'span_count': len(imported_spans),
    }


def _add_event(*, mlflow: Any, live_span: Any, event_payload: dict[str, Any]) -> None:
    event_name = str(event_payload.get('name') or 'event')
    attributes = event_payload.get('attributes') or {}
    timestamp = event_payload.get('timestamp_unix_nano')

    span_event_cls = getattr(mlflow, 'SpanEvent', None)
    if span_event_cls is None:
        entities = getattr(mlflow, 'entities', None)
        span_event_cls = getattr(entities, 'SpanEvent', None) if entities is not None else None
    if span_event_cls is not None:
        live_span.add_event(span_event_cls(name=event_name, attributes=attributes, timestamp=timestamp))
        return

    live_span.add_event(type('SpanEventShim', (), {'name': event_name, 'attributes': attributes, 'timestamp': timestamp})())


if __name__ == '__main__':
    raise SystemExit(main())
