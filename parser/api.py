from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import Counter
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from parser.copilot_parser import CopilotSessionParser, TraceRow


class TraceRepository:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self.parser = CopilotSessionParser()

    def list_sessions(
        self,
        *,
        search: str | None = None,
        has_evaluations: bool | None = None,
        annotated_only: bool = False,
        limit: int | None = None,
        offset: int = 0,
    ) -> dict[str, Any]:
        base_query = '''
            SELECT t.session_id,
                   COUNT(*) AS trace_count,
                   MIN(t.timestamp) AS first_timestamp,
                   MAX(t.timestamp) AS last_timestamp,
                   SUM(CASE WHEN json_extract(t.data, '$.notes') IS NOT NULL AND json_extract(t.data, '$.notes') != '' THEN 1 ELSE 0 END) AS annotated_count,
                   es.data
            FROM traces t
            LEFT JOIN evaluation_sessions es ON es.session_id = t.session_id
        '''
        clauses: list[str] = []
        params: list[Any] = []
        if search:
            clauses.append('LOWER(t.session_id) LIKE ?')
            params.append(f'%{search.lower()}%')
        if has_evaluations is True:
            clauses.append('es.data IS NOT NULL')
        elif has_evaluations is False:
            clauses.append('es.data IS NULL')
        if annotated_only:
            clauses.append("json_extract(t.data, '$.notes') IS NOT NULL AND json_extract(t.data, '$.notes') != ''")

        where = f" WHERE {' AND '.join(clauses)}" if clauses else ''
        group_by = ' GROUP BY t.session_id'
        order = ' ORDER BY MAX(t.timestamp) DESC, t.session_id DESC'

        count_query = f'SELECT COUNT(*) FROM ({base_query}{where}{group_by}) sessions'
        query = base_query + where + group_by + order
        if limit is not None:
            query += ' LIMIT ? OFFSET ?'
            query_params = [*params, limit, max(offset, 0)]
        else:
            query_params = params

        with sqlite3.connect(self.db_path) as conn:
            total = conn.execute(count_query, params).fetchone()[0]
            rows = conn.execute(query, query_params).fetchall()

        sessions: list[dict[str, Any]] = []
        for row in rows:
            payload = {
                'session_id': row[0],
                'trace_count': row[1],
                'first_timestamp': row[2],
                'last_timestamp': row[3],
                'annotated_count': row[4],
            }
            if row[5]:
                payload['evaluation'] = json.loads(row[5])
            sessions.append(payload)

        return {
            'count': len(sessions),
            'total': total,
            'offset': max(offset, 0),
            'limit': limit,
            'pages': math.ceil(total / limit) if limit else 1,
            'sessions': sessions,
        }

    def list_traces(
        self,
        session_id: str | None = None,
        trace_type: str | None = None,
        tag: str | None = None,
        search: str | None = None,
        limit: int | None = None,
        offset: int = 0,
        include_evaluations: bool = False,
        sort: str = 'asc',
    ) -> dict[str, Any]:
        query = 'SELECT id, session_id, timestamp, trace_type, function_name, tags, data FROM traces'
        count_query = 'SELECT COUNT(*) FROM traces'
        clauses: list[str] = []
        params: list[Any] = []
        if session_id:
            clauses.append('session_id = ?')
            params.append(session_id)
        if trace_type:
            clauses.append('trace_type = ?')
            params.append(trace_type)
        if tag:
            clauses.append('EXISTS (SELECT 1 FROM json_each(traces.tags) WHERE json_each.value = ?)')
            params.append(tag)
        if search:
            clauses.append("(LOWER(COALESCE(data, '')) LIKE ? OR LOWER(COALESCE(function_name, '')) LIKE ? OR LOWER(COALESCE(trace_type, '')) LIKE ?)")
            like = f'%{search.lower()}%'
            params.extend([like, like, like])
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        sort_direction = self._normalize_sort_direction(sort)
        query += where + f' ORDER BY timestamp {sort_direction}, session_id {sort_direction}, id {sort_direction}'
        count_query += where
        if limit is not None:
            query += ' LIMIT ? OFFSET ?'
            query_params = [*params, limit, max(offset, 0)]
        else:
            query_params = params

        with sqlite3.connect(self.db_path) as conn:
            total = conn.execute(count_query, params).fetchone()[0]
            rows = conn.execute(query, query_params).fetchall()
            filter_rows = conn.execute(
                'SELECT trace_type, tags FROM traces' + (' WHERE session_id = ?' if session_id else ''),
                [session_id] if session_id else [],
            ).fetchall()

            evaluations: list[dict[str, Any]] = []
            if include_evaluations and rows:
                trace_ids = [row[0] for row in rows]
                placeholders = ','.join('?' for _ in trace_ids)
                eval_rows = conn.execute(
                    f'SELECT id, session_id, timestamp, target_trace_id, label, score, status, metrics, notes FROM evaluations WHERE target_trace_id IN ({placeholders}) ORDER BY timestamp {sort_direction}, id {sort_direction}',
                    trace_ids,
                ).fetchall()
                evaluations = [self._row_to_evaluation_payload(row) for row in eval_rows]

        traces = self.parser.enrich_agent_traces([self._row_to_trace_payload(row) for row in rows])
        available_types = sorted({row[0] for row in filter_rows if row[0]})
        available_tags = sorted({tag_value for _, tags_blob in filter_rows for tag_value in (json.loads(tags_blob) if tags_blob else [])})
        return {
            'count': len(traces),
            'total': total,
            'offset': max(offset, 0),
            'limit': limit,
            'pages': math.ceil(total / limit) if limit else 1,
            'traces': traces,
            'evaluations': evaluations,
            'available_filters': {
                'types': available_types,
                'tags': available_tags,
            },
        }

    def list_evaluations(
        self,
        session_id: str | None = None,
        status: str | None = None,
        target_trace_id: str | None = None,
        limit: int | None = None,
        offset: int = 0,
        sort: str = 'desc',
    ) -> dict[str, Any]:
        query = 'SELECT id, session_id, timestamp, target_trace_id, label, score, status, metrics, notes FROM evaluations'
        count_query = 'SELECT COUNT(*) FROM evaluations'
        clauses: list[str] = []
        params: list[Any] = []
        if session_id:
            clauses.append('session_id = ?')
            params.append(session_id)
        if status:
            clauses.append('status = ?')
            params.append(status)
        if target_trace_id:
            clauses.append('target_trace_id = ?')
            params.append(target_trace_id)
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        sort_direction = self._normalize_sort_direction(sort, default='DESC')
        query += where + f' ORDER BY timestamp {sort_direction}, id {sort_direction}'
        count_query += where
        if limit is not None:
            query += ' LIMIT ? OFFSET ?'
            query_params = [*params, limit, max(offset, 0)]
        else:
            query_params = params
        with sqlite3.connect(self.db_path) as conn:
            total = conn.execute(count_query, params).fetchone()[0]
            rows = conn.execute(query, query_params).fetchall()
        evaluations = [self._row_to_evaluation_payload(row) for row in rows]
        return {
            'count': len(evaluations),
            'total': total,
            'offset': max(offset, 0),
            'limit': limit,
            'pages': math.ceil(total / limit) if limit else 1,
            'evaluations': evaluations,
        }

    def list_evaluation_sessions(self) -> dict[str, Any]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute('SELECT session_id, data FROM evaluation_sessions ORDER BY session_id').fetchall()
        sessions = [json.loads(row[1]) for row in rows]
        return {'count': len(sessions), 'sessions': sessions}

    def get_trace(self, trace_id: str) -> dict[str, Any] | None:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                'SELECT id, session_id, timestamp, trace_type, function_name, tags, data FROM traces WHERE id = ?',
                (trace_id,),
            ).fetchone()
        if not row:
            return None
        trace = self._row_to_trace_payload(row)
        return self._enrich_single_trace(trace)

    def update_trace_annotations(self, trace_id: str, *, tags: list[str] | None = None, notes: str | None = None) -> dict[str, Any] | None:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                'SELECT id, session_id, timestamp, trace_type, function_name, tags, data FROM traces WHERE id = ?',
                (trace_id,),
            ).fetchone()
            if not row:
                return None
            current_tags = json.loads(row[5]) if row[5] else []
            current_data = json.loads(row[6]) if row[6] else {}
            normalized_tags = self._normalize_tags(tags if tags is not None else current_tags)
            if notes is not None:
                current_data['notes'] = notes.strip()
            conn.execute(
                'UPDATE traces SET tags = ?, data = ? WHERE id = ?',
                (json.dumps(normalized_tags, ensure_ascii=False), json.dumps(current_data, ensure_ascii=False), trace_id),
            )
            conn.commit()
        return self.get_trace(trace_id)

    def evaluation_summary_for_trace_ids(self, trace_ids: list[str]) -> dict[str, Any]:
        if not trace_ids:
            return {'count': 0, 'average_score': None, 'status_breakdown': {}}
        placeholders = ','.join('?' for _ in trace_ids)
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                f'SELECT score, status FROM evaluations WHERE target_trace_id IN ({placeholders})',
                trace_ids,
            ).fetchall()
        if not rows:
            return {'count': 0, 'average_score': None, 'status_breakdown': {}}
        scores = [float(row[0]) for row in rows]
        statuses = dict(Counter(str(row[1]) for row in rows))
        return {
            'count': len(rows),
            'average_score': round(sum(scores) / len(scores), 3),
            'status_breakdown': statuses,
        }

    def _normalize_sort_direction(self, value: str | None, *, default: str = 'ASC') -> str:
        if not value:
            return default
        normalized = value.strip().lower()
        if normalized in {'asc', 'oldest', 'oldest_first'}:
            return 'ASC'
        if normalized in {'desc', 'newest', 'newest_first'}:
            return 'DESC'
        return default

    def _normalize_tags(self, tags: list[str] | None) -> list[str]:
        if not tags:
            return []
        seen: set[str] = set()
        normalized: list[str] = []
        for tag in tags:
            value = str(tag).strip()
            if not value:
                continue
            lowered = value.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            normalized.append(value)
        return normalized

    def _row_to_trace_payload(self, row: tuple[Any, ...]) -> dict[str, Any]:
        trace = TraceRow(
            id=row[0],
            session_id=row[1],
            timestamp=row[2],
            trace_type=row[3],
            function_name=row[4],
            tags=json.loads(row[5]) if row[5] else [],
            data=json.loads(row[6]) if row[6] else {},
        )
        return self.parser.trace_to_agent_dict(trace)

    def _enrich_single_trace(self, trace: dict[str, Any]) -> dict[str, Any]:
        session_id = trace.get('session_id')
        if not session_id:
            return trace
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                'SELECT id, session_id, timestamp, trace_type, function_name, tags, data FROM traces WHERE session_id = ? ORDER BY timestamp ASC, id ASC',
                (session_id,),
            ).fetchall()
        enriched = self.parser.enrich_agent_traces([self._row_to_trace_payload(row) for row in rows])
        by_id = {item['id']: item for item in enriched}
        return by_id.get(trace['id'], trace)

    def _row_to_evaluation_payload(self, row: tuple[Any, ...]) -> dict[str, Any]:
        metrics = json.loads(row[7]) if row[7] else {}
        notes = json.loads(row[8]) if row[8] else []
        score = row[5]
        status = row[6]
        score_band = 'excellent' if score >= 0.9 else 'strong' if score >= 0.75 else 'needs_review' if score >= 0.5 else 'high_risk'
        weakest_metric = min(metrics.items(), key=lambda item: item[1])[0].replace('_', ' ') if metrics else 'unknown'
        threshold_text = 'pass ≥ 75%, warn ≥ 50%, fail < 50%'
        if status == 'pass':
            status_explanation = f'Scored {score:.0%}, passing the current rubric ({threshold_text}). Strongest signals outweighed any weak spots.'
        elif status == 'warn':
            status_explanation = f'Scored {score:.0%}, landing in warn range ({threshold_text}). Review the weaker signal around {weakest_metric}.'
        else:
            status_explanation = f'Scored {score:.0%}, landing in fail range ({threshold_text}). Follow up on the weaker signal around {weakest_metric}.'
        return {
            'id': row[0],
            'session_id': row[1],
            'timestamp': row[2],
            'target_trace_id': row[3],
            'label': row[4],
            'score': score,
            'status': status,
            'metrics': metrics,
            'notes': notes,
            'status_explanation': status_explanation,
            'score_band': score_band,
        }


class TraceApiHandler(BaseHTTPRequestHandler):
    repository: TraceRepository

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._write_cors_headers()
        self.send_header('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path in {'/health', '/api/health'}:
            self._write_json({'ok': True})
            return
        if parsed.path == '/api/traces/sessions':
            limit = self._parse_int(query.get('limit', [None])[0])
            offset = self._parse_int(query.get('offset', ['0'])[0]) or 0
            search = query.get('search', [None])[0]
            has_evaluations = self._parse_bool(query.get('has_evaluations', [None])[0])
            annotated_only = bool(self._parse_bool(query.get('annotated_only', ['false'])[0]))
            self._write_json(
                self.repository.list_sessions(
                    search=search,
                    has_evaluations=has_evaluations,
                    annotated_only=annotated_only,
                    limit=limit,
                    offset=offset,
                )
            )
            return
        if parsed.path == '/api/traces':
            limit = self._parse_int(query.get('limit', [None])[0])
            offset = self._parse_int(query.get('offset', ['0'])[0]) or 0
            session_id = query.get('session_id', [None])[0]
            trace_type = query.get('trace_type', [None])[0] or query.get('type', [None])[0]
            tag = query.get('tag', [None])[0]
            search = query.get('search', [None])[0]
            include_evaluations = bool(self._parse_bool(query.get('include_evaluations', ['false'])[0]))
            sort = query.get('sort', ['asc'])[0]
            self._write_json(
                self.repository.list_traces(
                    session_id=session_id,
                    trace_type=trace_type,
                    tag=tag,
                    search=search,
                    limit=limit,
                    offset=offset,
                    include_evaluations=include_evaluations,
                    sort=sort,
                )
            )
            return
        if parsed.path == '/api/evaluations':
            limit = self._parse_int(query.get('limit', [None])[0])
            offset = self._parse_int(query.get('offset', ['0'])[0]) or 0
            session_id = query.get('session_id', [None])[0]
            status = query.get('status', [None])[0]
            target_trace_id = query.get('target_trace_id', [None])[0]
            sort = query.get('sort', ['desc'])[0]
            self._write_json(
                self.repository.list_evaluations(
                    session_id=session_id,
                    status=status,
                    target_trace_id=target_trace_id,
                    limit=limit,
                    offset=offset,
                    sort=sort,
                )
            )
            return
        if parsed.path == '/api/evaluations/sessions':
            self._write_json(self.repository.list_evaluation_sessions())
            return
        if parsed.path.startswith('/api/traces/'):
            trace_id = parsed.path.split('/api/traces/', 1)[1]
            trace = self.repository.get_trace(trace_id)
            if trace is None:
                self._write_json({'error': 'trace not found', 'id': trace_id}, status=HTTPStatus.NOT_FOUND)
                return
            self._write_json(trace)
            return

        self._write_json({'error': 'not found', 'path': parsed.path}, status=HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not parsed.path.startswith('/api/traces/'):
            self._write_json({'error': 'not found', 'path': parsed.path}, status=HTTPStatus.NOT_FOUND)
            return

        trace_id = parsed.path.split('/api/traces/', 1)[1]
        payload = self._read_json_body()
        if payload is None:
            self._write_json({'error': 'invalid json body'}, status=HTTPStatus.BAD_REQUEST)
            return

        tags = payload.get('tags')
        notes = payload.get('notes')
        if tags is not None and not isinstance(tags, list):
            self._write_json({'error': 'tags must be a list of strings'}, status=HTTPStatus.BAD_REQUEST)
            return
        if notes is not None and not isinstance(notes, str):
            self._write_json({'error': 'notes must be a string'}, status=HTTPStatus.BAD_REQUEST)
            return

        trace = self.repository.update_trace_annotations(trace_id, tags=tags, notes=notes)
        if trace is None:
            self._write_json({'error': 'trace not found', 'id': trace_id}, status=HTTPStatus.NOT_FOUND)
            return
        self._write_json(trace)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _parse_int(self, value: str | None) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except ValueError:
            return None

    def _parse_bool(self, value: str | None) -> bool | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized in {'1', 'true', 'yes', 'on'}:
            return True
        if normalized in {'0', 'false', 'no', 'off'}:
            return False
        return None

    def _read_json_body(self) -> dict[str, Any] | None:
        length = self._parse_int(self.headers.get('Content-Length')) or 0
        if length <= 0:
            return {}
        try:
            raw = self.rfile.read(length)
            return json.loads(raw.decode('utf-8'))
        except Exception:
            return None

    def _write_cors_headers(self) -> None:
        self.send_header('Access-Control-Allow-Origin', '*')

    def _write_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._write_cors_headers()
        self.end_headers()
        self.wfile.write(body)


def create_server(*, db_path: str | Path, host: str = '127.0.0.1', port: int = 8000) -> ThreadingHTTPServer:
    TraceApiHandler.repository = TraceRepository(db_path)
    return ThreadingHTTPServer((host, port), TraceApiHandler)


def main() -> None:
    parser = argparse.ArgumentParser(description='Serve an AgentTrace-like API over traces.db')
    parser.add_argument('--db', required=True, help='Path to traces.db')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()

    server = create_server(db_path=args.db, host=args.host, port=args.port)
    print(f'Serving Trace API on http://{args.host}:{args.port} using {args.db}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
