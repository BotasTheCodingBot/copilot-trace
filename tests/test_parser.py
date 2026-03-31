import base64
import json
import sqlite3
import tempfile
import threading
import unittest
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

import msgpack

from parser.api import create_server
from parser.cli import main as cli_main
from parser.copilot_parser import CopilotSessionParser
from parser.storage import TraceStorageManager


class _FakeMlflowHandler(BaseHTTPRequestHandler):
    experiments: dict[str, str] = {}
    created_runs: list[dict] = []
    logged_batches: list[dict] = []
    updated_runs: list[dict] = []

    def do_GET(self):  # noqa: N802
        if self.path.startswith('/api/2.0/mlflow/experiments/get-by-name'):
            from urllib.parse import parse_qs, urlparse

            name = parse_qs(urlparse(self.path).query).get('experiment_name', [''])[0]
            experiment_id = self.experiments.get(name)
            if experiment_id:
                self._write_json({'experiment': {'experiment_id': experiment_id, 'name': name}})
                return
            self._write_json({'error_code': 'RESOURCE_DOES_NOT_EXIST'}, status=HTTPStatus.NOT_FOUND)
            return
        self._write_json({'error': 'not found'}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get('Content-Length', '0') or '0')
        payload = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}

        if self.path == '/api/2.0/mlflow/experiments/create':
            experiment_id = str(len(self.experiments) + 1)
            self.experiments[payload['name']] = experiment_id
            self._write_json({'experiment_id': experiment_id})
            return
        if self.path == '/api/2.0/mlflow/runs/create':
            run_id = f"run-{len(self.created_runs) + 1}"
            run = {'info': {'run_id': run_id}, 'data': {'tags': payload.get('tags', [])}}
            self.created_runs.append(payload)
            self._write_json({'run': run})
            return
        if self.path == '/api/2.0/mlflow/runs/log-batch':
            self.logged_batches.append(payload)
            self._write_json({})
            return
        if self.path == '/api/2.0/mlflow/runs/update':
            self.updated_runs.append(payload)
            self._write_json({'run_info': {'run_id': payload['run_id'], 'status': payload['status']}})
            return
        self._write_json({'error': 'not found'}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, format, *args):  # noqa: A003
        return

    def _write_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class CopilotParserTests(unittest.TestCase):
    def setUp(self) -> None:
        self.parser = CopilotSessionParser()
        self.session_dir = Path(__file__).resolve().parents[2] / 'copilot-logs' / 'Okonomi' / 'copilot-chat' / '539fc419' / 'sessions'
        self.session_file = self.session_dir / '0acbeb4f-989a-4a77-bf2d-28b0b71d954b'
        _FakeMlflowHandler.experiments = {}
        _FakeMlflowHandler.created_runs = []
        _FakeMlflowHandler.logged_batches = []
        _FakeMlflowHandler.updated_runs = []

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

    def test_api_exports_selected_trace_to_mlflow_run_via_rest(self):
        rows = self.parser.parse_session_file(self.session_file)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / 'traces.db'
            self.parser.export_sqlite(rows, db_path)

            api_server = create_server(db_path=db_path, host='127.0.0.1', port=0)
            api_thread = threading.Thread(target=api_server.serve_forever, daemon=True)
            api_thread.start()

            mlflow_server = ThreadingHTTPServer(('127.0.0.1', 0), _FakeMlflowHandler)
            mlflow_thread = threading.Thread(target=mlflow_server.serve_forever, daemon=True)
            mlflow_thread.start()
            try:
                api_base = f'http://127.0.0.1:{api_server.server_address[1]}'
                mlflow_base = f'http://127.0.0.1:{mlflow_server.server_address[1]}'
                traces_payload = json.loads(urlopen(f'{api_base}/api/traces?limit=3&offset=0&include_evaluations=true').read().decode('utf-8'))
                trace_id = traces_payload['traces'][0]['id']

                export_request = Request(
                    f'{api_base}/api/traces/{trace_id}/export/mlflow',
                    data=json.dumps({
                        'tracking_uri': mlflow_base,
                        'experiment_name': 'copilot-trace-tests',
                        'tags': {'env': 'test'},
                    }).encode('utf-8'),
                    headers={'Content-Type': 'application/json'},
                    method='POST',
                )
                export_payload = json.loads(urlopen(export_request).read().decode('utf-8'))
                self.assertTrue(export_payload['ok'])
                self.assertEqual(export_payload['trace_id'], trace_id)
                self.assertEqual(export_payload['export']['tracking_uri'], mlflow_base)
                self.assertEqual(export_payload['export']['experiment_id'], '1')
                self.assertEqual(export_payload['export']['status'], 'FINISHED')

                self.assertEqual(len(_FakeMlflowHandler.created_runs), 1)
                create_payload = _FakeMlflowHandler.created_runs[0]
                self.assertEqual(create_payload['experiment_id'], '1')
                create_tags = {item['key']: item['value'] for item in create_payload['tags']}
                self.assertEqual(create_tags['source'], 'copilot-trace')
                self.assertEqual(create_tags['trace.id'], trace_id)
                self.assertEqual(create_tags['env'], 'test')

                self.assertEqual(len(_FakeMlflowHandler.logged_batches), 1)
                batch_payload = _FakeMlflowHandler.logged_batches[0]
                batch_params = {item['key']: item['value'] for item in batch_payload.get('params', [])}
                self.assertEqual(batch_params['trace_id'], trace_id)
                self.assertIn('session_id', batch_params)
                batch_tags = {item['key']: item['value'] for item in batch_payload.get('tags', [])}
                self.assertIn('trace.preview', batch_tags)
                self.assertIn('trace.payload', batch_tags)
                batch_metrics = {item['key']: item['value'] for item in batch_payload.get('metrics', [])}
                self.assertIn('evaluation_count', batch_metrics)

                self.assertEqual(len(_FakeMlflowHandler.updated_runs), 1)
                self.assertEqual(_FakeMlflowHandler.updated_runs[0]['status'], 'FINISHED')
            finally:
                api_server.shutdown()
                api_server.server_close()
                api_thread.join(timeout=2)
                mlflow_server.shutdown()
                mlflow_server.server_close()
                mlflow_thread.join(timeout=2)

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


if __name__ == '__main__':
    unittest.main()
