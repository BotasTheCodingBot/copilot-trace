import base64
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request, urlopen

import msgpack

from parser.api import create_server
from parser.cli import main as cli_main
from parser.copilot_parser import CopilotSessionParser
from parser.mlflow_export import MlflowExportConfig, MlflowSessionBundle, export_session_to_mlflow_bundle
from parser.mlflow_import import MlflowImportConfig, MlflowImportError, _normalize_native_trace_payload, import_bundle_to_mlflow, load_bundle
from parser.storage import TraceStorageManager


class CopilotParserTests(unittest.TestCase):
    def setUp(self) -> None:
        self.parser = CopilotSessionParser()
        self.session_dir = Path(__file__).resolve().parents[2] / 'copilot-logs' / 'Okonomi' / 'copilot-chat' / '539fc419' / 'sessions'
        self.session_file = self.session_dir / '0acbeb4f-989a-4a77-bf2d-28b0b71d954b'

    def test_parse_real_session_file_returns_rows(self):
        rows = self.parser.parse_session_file(self.session_file)
        self.assertGreater(len(rows), 10)
        self.assertTrue(any(row.trace_type == 'USER_MESSAGE' for row in rows))
        self.assertTrue(any(row.trace_type == 'TOOL_CALL' for row in rows))
        self.assertTrue(any(row.trace_type == 'TOOL_RESULT' for row in rows))

    def test_sqlite_export_uses_agenttrace_shape(self):
        rows = self.parser.parse_session_file(self.session_file)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'traces.db'
            self.parser.export_sqlite(rows, db_path)
            conn = sqlite3.connect(db_path)
            try:
                cols = conn.execute('PRAGMA table_info(traces)').fetchall()
                col_names = [col[1] for col in cols]
                self.assertEqual(col_names, ['id', 'session_id', 'timestamp', 'trace_type', 'function_name', 'tags', 'data'])
                eval_cols = conn.execute('PRAGMA table_info(evaluations)').fetchall()
                eval_col_names = [col[1] for col in eval_cols]
                self.assertEqual(eval_col_names, ['id', 'session_id', 'timestamp', 'target_trace_id', 'label', 'score', 'status', 'metrics', 'notes'])
                count = conn.execute('SELECT COUNT(*) FROM traces').fetchone()[0]
                self.assertEqual(count, len(rows))
                eval_count = conn.execute('SELECT COUNT(*) FROM evaluations').fetchone()[0]
                self.assertGreater(eval_count, 0)
            finally:
                conn.close()

    def test_json_export_contains_agenttrace_aliases(self):
        rows = self.parser.parse_session_file(self.session_file)
        with tempfile.TemporaryDirectory() as tmp:
            json_path = Path(tmp) / 'traces.json'
            self.parser.export_json(rows, json_path)
            payload = json.loads(json_path.read_text(encoding='utf-8'))
            self.assertEqual(payload['count'], len(rows))
            self.assertIn('evaluations', payload)
            self.assertIn('evaluation_sessions', payload)
            self.assertGreater(len(payload['evaluations']), 0)
            self.assertGreater(len(payload['evaluation_sessions']), 0)
            first = payload['traces'][0]
            self.assertIn('type', first)
            self.assertIn('function', first)
            self.assertIn('trace_type', first)
            self.assertIn('function_name', first)
            self.assertIn('sequence', first)
            self.assertIn('parent_trace_id', first)

    def test_recursive_tool_payload_decoding(self):
        nested_payload = {
            'name': 'outer',
            'inner': {'answer': 42},
        }
        packed = msgpack.packb(nested_payload, use_bin_type=True)
        result = self.parser._decode_tool_result([0, {'Value': {'ValueContainer': ['Example.Type', {'base64': json.dumps('ignore')}, False]}}])
        self.assertEqual(result['type_name'], 'Example.Type')

        decoded = self.parser._try_decode_embedded_payload({'base64': packed.hex()})
        self.assertNotEqual(decoded, nested_payload)  # invalid base64 should not decode

        decoded = self.parser._try_decode_embedded_payload({'base64': base64.b64encode(packed).decode('ascii')})
        self.assertEqual(decoded, nested_payload)

    def test_api_serves_sessions_filters_and_annotations_from_sqlite(self):
        rows = self.parser.parse_session_file(self.session_file)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'traces.db'
            self.parser.export_sqlite(rows, db_path)
            server = create_server(db_path=db_path, host='127.0.0.1', port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                base_url = f'http://127.0.0.1:{server.server_address[1]}'
                sessions_payload = json.loads(urlopen(f'{base_url}/api/traces/sessions?limit=5&offset=0&has_evaluations=true').read().decode('utf-8'))
                self.assertGreaterEqual(sessions_payload['count'], 1)
                self.assertGreaterEqual(sessions_payload['total'], sessions_payload['count'])
                session_id = sessions_payload['sessions'][0]['session_id']

                traces_payload = json.loads(urlopen(f'{base_url}/api/traces?session_id={session_id}&limit=5&offset=0&include_evaluations=true').read().decode('utf-8'))
                self.assertGreater(traces_payload['count'], 0)
                self.assertGreaterEqual(traces_payload['total'], traces_payload['count'])
                self.assertIn('available_filters', traces_payload)
                first_trace = traces_payload['traces'][0]
                self.assertIn('trace_type', first_trace)
                self.assertIn('function_name', first_trace)
                self.assertIn('sequence', first_trace)
                self.assertIn('parent_trace_id', first_trace)
                self.assertIn('evaluations', traces_payload)

                filter_payload = json.loads(urlopen(f"{base_url}/api/traces?session_id={session_id}&type={first_trace['trace_type']}&tag=copilot&search={first_trace['function_name']}").read().decode('utf-8'))
                self.assertGreater(filter_payload['count'], 0)
                self.assertTrue(all(trace['trace_type'] == first_trace['trace_type'] for trace in filter_payload['traces']))

                patch_request = Request(
                    f"{base_url}/api/traces/{first_trace['id']}",
                    data=json.dumps({'tags': ['copilot', 'reviewed', 'important'], 'notes': 'Needs follow-up'}).encode('utf-8'),
                    headers={'Content-Type': 'application/json'},
                    method='PATCH',
                )
                patched_trace = json.loads(urlopen(patch_request).read().decode('utf-8'))
                self.assertIn('reviewed', patched_trace['tags'])
                self.assertEqual(patched_trace['notes'], 'Needs follow-up')

                eval_payload = json.loads(urlopen(f'{base_url}/api/evaluations?session_id={session_id}&limit=5&offset=0&status=pass').read().decode('utf-8'))
                self.assertGreater(eval_payload['count'], 0)
                self.assertGreaterEqual(eval_payload['total'], eval_payload['count'])
                self.assertIn('score', eval_payload['evaluations'][0])
                self.assertIn('status_explanation', eval_payload['evaluations'][0])
                self.assertIn('score_band', eval_payload['evaluations'][0])

                asc_traces_payload = json.loads(urlopen(f'{base_url}/api/traces?session_id={session_id}&limit=5&offset=0&sort=asc').read().decode('utf-8'))
                desc_traces_payload = json.loads(urlopen(f'{base_url}/api/traces?session_id={session_id}&limit=5&offset=0&sort=desc').read().decode('utf-8'))
                self.assertNotEqual(asc_traces_payload['traces'][0]['id'], desc_traces_payload['traces'][0]['id'])

                asc_eval_payload = json.loads(urlopen(f'{base_url}/api/evaluations?session_id={session_id}&limit=5&offset=0&sort=asc').read().decode('utf-8'))
                desc_eval_payload = json.loads(urlopen(f'{base_url}/api/evaluations?session_id={session_id}&limit=5&offset=0&sort=desc').read().decode('utf-8'))
                self.assertNotEqual(asc_eval_payload['evaluations'][0]['id'], desc_eval_payload['evaluations'][0]['id'])

                eval_sessions_payload = json.loads(urlopen(f'{base_url}/api/evaluations/sessions').read().decode('utf-8'))
                self.assertGreaterEqual(eval_sessions_payload['count'], 1)
                self.assertIn('average_score', eval_sessions_payload['sessions'][0])

                trace_payload = json.loads(urlopen(f"{base_url}/api/traces/{first_trace['id']}").read().decode('utf-8'))
                self.assertEqual(trace_payload['id'], first_trace['id'])
                self.assertEqual(trace_payload['notes'], 'Needs follow-up')
                self.assertIn('sequence', trace_payload)
                self.assertIn('parent_trace_id', trace_payload)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_api_exports_selected_session_to_local_mlflow_bundle(self):
        rows = self.parser.parse_session_file(self.session_file)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db_path = tmp_path / 'traces.db'
            export_root = tmp_path / 'exports'
            self.parser.export_sqlite(rows, db_path)

            api_server = create_server(db_path=db_path, host='127.0.0.1', port=0)
            api_thread = threading.Thread(target=api_server.serve_forever, daemon=True)
            api_thread.start()
            try:
                api_base = f'http://127.0.0.1:{api_server.server_address[1]}'
                sessions_payload = json.loads(urlopen(f'{api_base}/api/traces/sessions?limit=1&offset=0').read().decode('utf-8'))
                session_id = sessions_payload['sessions'][0]['session_id']

                export_request = Request(
                    f'{api_base}/api/traces/sessions/{session_id}/export/mlflow',
                    data=json.dumps({
                        'output_dir': str(export_root),
                        'bundle_name': 'copilot-session-export',
                        'tags': {'env': 'test'},
                    }).encode('utf-8'),
                    headers={'Content-Type': 'application/json'},
                    method='POST',
                )
                export_payload = json.loads(urlopen(export_request).read().decode('utf-8'))
                self.assertTrue(export_payload['ok'])
                self.assertEqual(export_payload['session_id'], session_id)
                self.assertEqual(export_payload['export']['bundle_name'], 'copilot-session-export')
                self.assertEqual(export_payload['export']['status'], 'WRITTEN')

                bundle_dir = export_root / 'copilot-session-export'
                self.assertTrue((bundle_dir / 'manifest.json').exists())
                self.assertTrue((bundle_dir / 'session.json').exists())
                self.assertTrue((bundle_dir / 'traces.json').exists())
                self.assertTrue((bundle_dir / 'evaluations.json').exists())
                self.assertTrue((bundle_dir / 'mlflow-run.json').exists())

                manifest_payload = json.loads((bundle_dir / 'manifest.json').read_text(encoding='utf-8'))
                self.assertEqual(manifest_payload['session_id'], session_id)
                traces_payload = json.loads((bundle_dir / 'traces.json').read_text(encoding='utf-8'))
                self.assertGreater(traces_payload['count'], 0)
                self.assertTrue(all(trace['session_id'] == session_id for trace in traces_payload['traces']))

                run_payload = json.loads((bundle_dir / 'mlflow-run.json').read_text(encoding='utf-8'))
                self.assertEqual(run_payload['run_name'], 'copilot-session-export')
                self.assertEqual(run_payload['tags']['env'], 'test')
                self.assertEqual(run_payload['params']['session_id'], session_id)
                self.assertIn('trace_count', run_payload['metrics'])
            finally:
                api_server.shutdown()
                api_server.server_close()
                api_thread.join(timeout=2)

    def test_api_can_export_and_auto_import_bundle_into_mlflow(self):
        rows = self.parser.parse_session_file(self.session_file)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db_path = tmp_path / 'traces.db'
            export_root = tmp_path / 'exports'
            self.parser.export_sqlite(rows, db_path)

            api_server = create_server(db_path=db_path, host='127.0.0.1', port=0)
            api_thread = threading.Thread(target=api_server.serve_forever, daemon=True)
            api_thread.start()
            try:
                api_base = f'http://127.0.0.1:{api_server.server_address[1]}'
                sessions_payload = json.loads(urlopen(f'{api_base}/api/traces/sessions?limit=1&offset=0').read().decode('utf-8'))
                session_id = sessions_payload['sessions'][0]['session_id']

                with patch('parser.api.import_bundle_to_mlflow', return_value={
                    'status': 'IMPORTED',
                    'run_id': 'run-456',
                    'run_name': 'copilot-session-export',
                    'bundle_dir': str(export_root / 'copilot-session-export'),
                    'artifact_path': 'copilot_trace_bundle',
                    'mlflow_trace': {'imported': False, 'span_count': 0},
                }) as import_mock:
                    export_request = Request(
                        f'{api_base}/api/traces/sessions/{session_id}/export/mlflow',
                        data=json.dumps({
                            'output_dir': str(export_root),
                            'bundle_name': 'copilot-session-export',
                            'mlflow_import': {
                                'tracking_uri': 'file:///tmp/mlruns',
                                'experiment_name': 'copilot-trace',
                                'run_name': 'manual-run-name',
                                'artifact_path': '',
                                'import_traces': False,
                            },
                        }).encode('utf-8'),
                        headers={'Content-Type': 'application/json'},
                        method='POST',
                    )
                    payload = json.loads(urlopen(export_request).read().decode('utf-8'))

                self.assertTrue(payload['ok'])
                self.assertEqual(payload['export']['bundle_name'], 'copilot-session-export')
                self.assertEqual(payload['mlflow_import']['run_id'], 'run-456')
                self.assertEqual(import_mock.call_count, 1)
                import_config = import_mock.call_args.kwargs['config']
                self.assertEqual(import_config.bundle_dir, str(export_root / 'copilot-session-export'))
                self.assertEqual(import_config.tracking_uri, 'file:///tmp/mlruns')
                self.assertEqual(import_config.experiment_name, 'copilot-trace')
                self.assertEqual(import_config.run_name, 'manual-run-name')
                self.assertEqual(import_config.artifact_path, '')
                self.assertFalse(import_config.import_traces)
            finally:
                api_server.shutdown()
                api_server.server_close()
                api_thread.join(timeout=2)

    def test_storage_manager_rotates_existing_db_and_updates_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            config_path = tmp_path / 'trace-config.json'
            db_path = tmp_path / 'traces.db'
            db_path.write_text('old-db', encoding='utf-8')
            manager = TraceStorageManager(config_path)

            rotated = manager.rotate_db(db_path, suffix='fixedstamp')
            self.assertEqual(rotated, tmp_path / 'traces.fixedstamp.db')
            self.assertFalse(db_path.exists())
            self.assertTrue(rotated.exists())

            config = manager.update_paths(db_path=db_path, json_path=tmp_path / 'traces.json', last_inputs=[self.session_dir])
            self.assertEqual(config.db_path, str(db_path))
            self.assertEqual(config.json_path, str(tmp_path / 'traces.json'))
            self.assertEqual(config.last_inputs, [str(self.session_dir)])
            payload = json.loads(config_path.read_text(encoding='utf-8'))
            self.assertEqual(payload['db_path'], str(db_path))
            self.assertEqual(payload['last_inputs'], [str(self.session_dir)])

    def test_cli_trace_ingests_directories_rotates_db_and_writes_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            config_path = tmp_path / 'trace-config.json'
            db_path = tmp_path / 'traces.db'
            json_path = tmp_path / 'traces.json'
            db_path.write_text('placeholder', encoding='utf-8')

            exit_code = cli_main([
                'trace',
                str(self.session_dir),
                '--db',
                str(db_path),
                '--json',
                str(json_path),
                '--config',
                str(config_path),
                '--rotate-db',
            ])

            self.assertEqual(exit_code, 0)
            self.assertTrue(db_path.exists())
            self.assertTrue(json_path.exists())
            rotated = list(tmp_path.glob('traces.*.db'))
            self.assertEqual(len(rotated), 1)
            payload = json.loads(json_path.read_text(encoding='utf-8'))
            self.assertGreater(payload['count'], 10)
            config = json.loads(config_path.read_text(encoding='utf-8'))
            self.assertEqual(config['db_path'], str(db_path))
            self.assertEqual(config['json_path'], str(json_path))
            self.assertEqual(config['last_inputs'], [str(self.session_dir)])


class _FakeRunInfo:
    def __init__(self, run_id: str):
        self.run_id = run_id


class _FakeRun:
    def __init__(self, run_id: str):
        self.info = _FakeRunInfo(run_id)


class _FakeSpanEvent:
    def __init__(self, name: str, attributes: dict | None = None, timestamp: int | None = None):
        self.name = name
        self.attributes = attributes or {}
        self.timestamp = timestamp


class _FakeSpan:
    def __init__(self, *, name: str, span_type: str, parent_span=None, inputs=None, attributes=None, start_time_ns=None, trace_id: str = 'trace-native-123'):
        self.name = name
        self.span_type = span_type
        self.parent_span = parent_span
        self.inputs = inputs
        self.attributes = attributes or {}
        self.start_time_ns = start_time_ns
        self.trace_id = trace_id if parent_span is None else parent_span.trace_id
        self.events: list[_FakeSpanEvent] = []
        self.end_calls: list[dict[str, object]] = []

    def add_event(self, event) -> None:
        for value in getattr(event, 'attributes', {}).values():
            if not isinstance(value, (str, int, float, bool)):
                raise AssertionError(f'event attribute must be scalar, got {type(value).__name__}: {value!r}')
        self.events.append(event)

    def end(self, outputs=None, status=None, end_time_ns=None) -> None:
        self.end_calls.append({'outputs': outputs, 'status': status, 'end_time_ns': end_time_ns})


class _FakeMlflow:
    SpanEvent = _FakeSpanEvent

    def __init__(self) -> None:
        self.tracking_uri = None
        self.experiment_name = None
        self.started_run_name = None
        self.tags = None
        self.params = None
        self.metrics: list[tuple[str, float]] = []
        self.artifacts = None
        self.ended_status = None
        self.created_spans: list[_FakeSpan] = []

    def set_tracking_uri(self, tracking_uri: str) -> None:
        self.tracking_uri = tracking_uri

    def set_experiment(self, experiment_name: str) -> None:
        self.experiment_name = experiment_name

    def start_run(self, run_name: str | None = None):
        self.started_run_name = run_name
        return _FakeRun('run-123')

    def start_span_no_context(self, name: str, span_type: str = 'CHAIN', parent_span=None, inputs=None, attributes=None, start_time_ns=None):
        for value in (attributes or {}).values():
            self._assert_mlflow_attr_value(value)
        span = _FakeSpan(
            name=name,
            span_type=span_type,
            parent_span=parent_span,
            inputs=inputs,
            attributes=attributes,
            start_time_ns=start_time_ns,
            trace_id=f'trace-native-{len(self.created_spans) + 1}',
        )
        self.created_spans.append(span)
        return span

    def _assert_mlflow_attr_value(self, value):
        if not isinstance(value, (str, int, float, bool)):
            raise AssertionError(f'attribute must be scalar, got {type(value).__name__}: {value!r}')

    def set_tags(self, tags: dict[str, str]) -> None:
        self.tags = tags

    def log_params(self, params: dict[str, str]) -> None:
        self.params = params

    def log_metric(self, key: str, value: float) -> None:
        self.metrics.append((key, value))

    def log_artifacts(self, local_dir: str, artifact_path: str | None = None) -> None:
        self.artifacts = (local_dir, artifact_path)

    def end_run(self, status: str = 'FINISHED') -> None:
        self.ended_status = status


class MlflowImportTests(unittest.TestCase):
    def _write_bundle(self, root: Path) -> Path:
        bundle = MlflowSessionBundle(
            session={
                'session_id': 'session-123',
                'first_timestamp': '2026-03-31T10:00:00Z',
                'last_timestamp': '2026-03-31T10:05:00Z',
                'annotated_count': 3,
            },
            traces=[
                {
                    'id': 'trace-1',
                    'session_id': 'session-123',
                    'timestamp': '2026-03-31T10:00:00Z',
                    'trace_type': 'ASSISTANT_MESSAGE',
                    'function_name': 'assistant_message',
                    'message_id': 'msg-1',
                    'text': 'Hello',
                    'notes': 'assistant replied',
                    'evaluations': [{'id': 'eval-inline', 'score': 0.8, 'notes': ['good', 'concise']}],
                },
                {
                    'id': 'trace-2',
                    'session_id': 'session-123',
                    'timestamp': '2026-03-31T10:00:00Z',
                    'trace_type': 'TOOL_CALL',
                    'function_name': 'tool.run',
                    'message_id': 'msg-1',
                    'tool_call_id': 'call-123',
                    'args': {'query': 'hello'},
                    'raw': {'nested': ['x', 1]},
                },
                {
                    'id': 'trace-3',
                    'session_id': 'session-123',
                    'timestamp': '2026-03-31T10:00:00Z',
                    'trace_type': 'TOOL_RESULT',
                    'function_name': 'tool.run',
                    'tool_call_id': 'call-123',
                    'result': {'ok': True, 'items': [1, 2, 3]},
                },
                {
                    'id': 'trace-4',
                    'session_id': 'session-123',
                    'timestamp': '2026-03-31T10:00:01Z',
                    'trace_type': 'TOOL_RESULT',
                    'function_name': 'tool.orphan',
                    'parent_trace_id': 'missing-parent',
                    'parent_reason': 'tool_call',
                    'result': {'ok': False},
                },
            ],
            evaluations=[
                {'id': 'eval-1', 'session_id': 'session-123', 'score': 0.8, 'status': 'ok'},
            ],
            evaluation_summary={'average_score': 0.8, 'status_breakdown': {'ok': 1}},
        )
        export = export_session_to_mlflow_bundle(
            bundle=bundle,
            config=MlflowExportConfig(
                output_dir=str(root),
                bundle_name='bundle-under-test',
                extra_tags={'env': 'test'},
            ),
        )
        return Path(export['bundle_dir'])

    def test_load_bundle_reads_exported_payload(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle_dir = self._write_bundle(Path(tmp))
            bundle = load_bundle(bundle_dir)
            self.assertEqual(bundle.manifest['format'], 'copilot-trace.mlflow-bundle')
            self.assertEqual(bundle.session['session_id'], 'session-123')
            self.assertEqual(bundle.traces_payload['count'], 4)
            self.assertEqual(bundle.evaluations_payload['count'], 1)
            self.assertEqual(bundle.run_payload['run_name'], 'bundle-under-test')
            self.assertEqual(bundle.trace_payload['format'], 'copilot-trace.mlflow-native-trace')
            self.assertEqual(bundle.trace_payload['trace_version'], 2)
            self.assertEqual(len(bundle.trace_payload['spans']), 5)

    def test_export_keeps_every_trace_row_as_its_own_span(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle_dir = self._write_bundle(Path(tmp))
            trace_payload = json.loads((bundle_dir / 'mlflow-trace.json').read_text(encoding='utf-8'))
            spans_by_id = {span['id']: span for span in trace_payload['spans']}

            self.assertEqual(trace_payload['trace_version'], 2)
            self.assertEqual(trace_payload['root_span_id'], 'session:session-123')
            self.assertEqual(len(trace_payload['spans']), 5)
            self.assertEqual([span['id'] for span in trace_payload['spans']], ['session:session-123', 'trace-1', 'trace-2', 'trace-3', 'trace-4'])
            self.assertEqual(spans_by_id['trace-2']['parent_id'], 'trace-1')
            self.assertEqual(spans_by_id['trace-2']['attributes']['copilot_trace.parent_reason'], 'message')
            self.assertEqual(spans_by_id['trace-3']['parent_id'], 'trace-2')
            self.assertEqual(spans_by_id['trace-3']['attributes']['copilot_trace.parent_reason'], 'tool_call')
            self.assertEqual(spans_by_id['trace-4']['parent_id'], 'session:session-123')
            self.assertEqual(
                spans_by_id['trace-2']['start_time_ns'],
                spans_by_id['trace-3']['start_time_ns'],
            )
            self.assertEqual(spans_by_id['trace-2']['end_time_ns'], spans_by_id['trace-2']['start_time_ns'] + 1)
            self.assertEqual(spans_by_id['trace-3']['end_time_ns'], spans_by_id['trace-3']['start_time_ns'] + 1)
            self.assertNotIn('copilot_trace.raw', spans_by_id['trace-2']['attributes'])
            self.assertTrue(spans_by_id['trace-2']['attributes']['copilot_trace.raw_present'])
            self.assertIn('raw', spans_by_id['trace-2']['attributes']['copilot_trace.preview'])
            self.assertIsInstance(spans_by_id['trace-1']['events'][0]['attributes']['notes'], str)

    def test_import_bundle_logs_run_metadata_and_artifacts(self):
        fake_mlflow = _FakeMlflow()
        with tempfile.TemporaryDirectory() as tmp:
            bundle_dir = self._write_bundle(Path(tmp))
            result = import_bundle_to_mlflow(
                config=MlflowImportConfig(
                    bundle_dir=str(bundle_dir),
                    tracking_uri='file:///tmp/mlruns',
                    experiment_name='copilot-trace',
                ),
                mlflow_module=fake_mlflow,
            )

            self.assertEqual(result['status'], 'IMPORTED')
            self.assertEqual(result['run_id'], 'run-123')
            self.assertEqual(fake_mlflow.tracking_uri, 'file:///tmp/mlruns')
            self.assertEqual(fake_mlflow.experiment_name, 'copilot-trace')
            self.assertEqual(fake_mlflow.started_run_name, 'bundle-under-test')
            self.assertEqual(fake_mlflow.params['session_id'], 'session-123')
            self.assertIn('trace_count', dict(fake_mlflow.metrics))
            self.assertEqual(fake_mlflow.artifacts, (str(bundle_dir), 'copilot_trace_bundle'))
            self.assertEqual(fake_mlflow.tags['env'], 'test')
            self.assertEqual(fake_mlflow.tags['copilot_trace.bundle_format'], 'copilot-trace.mlflow-bundle')
            self.assertTrue(result['mlflow_trace']['imported'])
            self.assertEqual(result['mlflow_trace']['span_count'], 5)
            self.assertEqual(fake_mlflow.tags['copilot_trace.imported_trace_id'], 'trace-native-1')
            self.assertEqual(len(fake_mlflow.created_spans), 5)
            self.assertEqual([span.name for span in fake_mlflow.created_spans], ['copilot-session:session-123', 'assistant_message', 'tool.run', 'tool.run', 'tool.orphan'])
            self.assertIsNone(fake_mlflow.created_spans[0].parent_span)
            self.assertIs(fake_mlflow.created_spans[1].parent_span, fake_mlflow.created_spans[0])
            self.assertIs(fake_mlflow.created_spans[2].parent_span, fake_mlflow.created_spans[1])
            self.assertIs(fake_mlflow.created_spans[3].parent_span, fake_mlflow.created_spans[2])
            self.assertIs(fake_mlflow.created_spans[4].parent_span, fake_mlflow.created_spans[0])
            self.assertTrue(all(span.end_calls[0]['end_time_ns'] >= span.start_time_ns for span in fake_mlflow.created_spans))
            self.assertEqual(fake_mlflow.created_spans[2].inputs, {'query': 'hello'})
            self.assertEqual(fake_mlflow.created_spans[3].end_calls[0]['outputs'], {'ok': True, 'items': [1, 2, 3]})
            self.assertNotIn('copilot_trace.raw', fake_mlflow.created_spans[2].attributes)
            self.assertTrue(fake_mlflow.created_spans[2].attributes['copilot_trace.raw_present'])
            self.assertIn('raw', fake_mlflow.created_spans[2].attributes['copilot_trace.preview'])
            self.assertEqual(fake_mlflow.created_spans[1].events[0].name, 'copilot.notes')
            self.assertIsInstance(fake_mlflow.created_spans[1].events[0].attributes['notes'], str)
            self.assertEqual(fake_mlflow.ended_status, 'FINISHED')


    def test_import_normalizes_zero_length_spans_to_minimal_duration(self):
        payload = {
            'root_span_id': 'root',
            'spans': [
                {
                    'id': 'root',
                    'name': 'root',
                    'start_time_ns': 100,
                    'end_time_ns': 100,
                    'attributes': {},
                    'events': [],
                }
            ],
        }

        normalized = _normalize_native_trace_payload(payload)
        self.assertEqual(normalized['spans'][0]['start_time_ns'], 100)
        self.assertEqual(normalized['spans'][0]['end_time_ns'], 101)

    def test_load_bundle_rejects_unknown_manifest_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle_dir = self._write_bundle(Path(tmp))
            manifest_path = bundle_dir / 'manifest.json'
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            manifest['format'] = 'not-supported'
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')

            with self.assertRaises(MlflowImportError):
                load_bundle(bundle_dir)


if __name__ == '__main__':
    unittest.main()
