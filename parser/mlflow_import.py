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


@dataclass
class MlflowImportConfig:
    bundle_dir: str
    tracking_uri: str | None = None
    experiment_name: str | None = None
    run_name: str | None = None
    artifact_path: str | None = 'copilot_trace_bundle'
    set_terminated: bool = True


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog='import_bundle_to_mlflow.py',
        description='Import a copilot-trace MLflow bundle into an MLflow run and artifacts.',
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

    return MlflowImportBundle(
        bundle_dir=path,
        manifest=manifest,
        session=session,
        traces_payload=traces_payload,
        evaluations_payload=evaluations_payload,
        run_payload=run_payload,
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


if __name__ == '__main__':
    raise SystemExit(main())
