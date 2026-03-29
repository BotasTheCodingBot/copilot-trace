from __future__ import annotations

import argparse
import base64
import dataclasses
import datetime as dt
import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable

import msgpack

from parser.evaluation import TraceEvaluator


@dataclasses.dataclass
class TraceRow:
    id: str
    session_id: str
    timestamp: str
    trace_type: str
    function_name: str
    tags: list[str]
    data: dict[str, Any]


class CopilotSessionParser:
    def __init__(self) -> None:
        self.evaluator = TraceEvaluator()

    def parse_session_file(self, path: str | Path) -> list[TraceRow]:
        path = Path(path)
        unpacker = msgpack.Unpacker(raw=False, strict_map_key=False)
        unpacker.feed(path.read_bytes())
        items = list(unpacker)
        if len(items) < 2:
            return []

        version = items[0]
        session_meta = items[1]
        session_id = self._extract_session_id(session_meta) or path.name
        created = self._coerce_timestamp(session_meta.get('TimeCreated'))
        updated = self._coerce_timestamp(session_meta.get('TimeUpdated'))
        session_rows: list[TraceRow] = []

        event_items = [item for item in items[2:] if isinstance(item, list) and len(item) == 2 and isinstance(item[1], dict)]
        total = max(len(event_items), 1)

        for index, item in enumerate(event_items):
            marker, payload = item
            timestamp = self._interpolate_timestamp(created, updated, index, total)
            session_rows.extend(
                self._parse_event(
                    session_id=session_id,
                    payload=payload,
                    marker=marker,
                    index=index,
                    version=version,
                    timestamp=timestamp,
                )
            )

        return session_rows

    def _parse_event(self, *, session_id: str, payload: dict[str, Any], marker: int, index: int, version: Any, timestamp: str) -> list[TraceRow]:
        rows: list[TraceRow] = []
        role = 'user' if marker == 0 else 'assistant'
        correlation_id = payload.get('CorrelationId')
        message_id = payload.get('MessageId') or f'{session_id}:{index}:{role}'
        content = payload.get('Content') or []

        text_blocks: list[str] = []
        tool_blocks: list[dict[str, Any]] = []

        for block in content:
            if not isinstance(block, list) or len(block) != 2:
                continue
            block_kind, block_payload = block
            if not isinstance(block_payload, dict):
                continue
            if block_kind == 3 and block_payload.get('Content'):
                text_blocks.append(str(block_payload.get('Content')))
            elif block_kind == 7:
                tool_blocks.append(block_payload)
            elif 'Content' in block_payload and block_payload.get('Content'):
                text_blocks.append(str(block_payload.get('Content')))

        if text_blocks:
            rows.append(
                TraceRow(
                    id=str(message_id),
                    session_id=session_id,
                    timestamp=timestamp,
                    trace_type='USER_MESSAGE' if role == 'user' else 'ASSISTANT_MESSAGE',
                    function_name='user_message' if role == 'user' else 'assistant_message',
                    tags=['copilot', role],
                    data={
                        'role': role,
                        'correlation_id': correlation_id,
                        'message_id': message_id,
                        'text': '\n\n'.join(text_blocks),
                        'content_blocks': text_blocks,
                        'status': payload.get('Status'),
                        'model': self._json_safe(payload.get('Model')),
                        'metadata': self._json_safe(payload.get('Metadata') or {}),
                        'version': version,
                        'raw_preview': self._payload_preview(payload),
                    },
                )
            )

        for tool_index, block in enumerate(tool_blocks):
            function = (block.get('Function') or {})
            tool_name = function.get('Name') or 'tool'
            tool_call_id = self._extract_tool_call_id(function)
            arguments = self._decode_argument_payload(function.get('Arguments'))
            result = self._decode_tool_result(block.get('Result'))
            base_id = f'{message_id}:{tool_index}:{tool_name}'

            rows.append(
                TraceRow(
                    id=f'{base_id}:call',
                    session_id=session_id,
                    timestamp=timestamp,
                    trace_type='TOOL_CALL',
                    function_name=tool_name,
                    tags=['copilot', role, 'tool-call'],
                    data={
                        'role': role,
                        'correlation_id': correlation_id,
                        'message_id': message_id,
                        'tool_call_id': tool_call_id,
                        'state': block.get('State'),
                        'description': block.get('Description'),
                        'status': block.get('Status'),
                        'confirmation_requirement': block.get('ConfirmationRequirement'),
                        'args': arguments,
                        'result_preview': self._truncate_value(result, 1500),
                        'raw': self._payload_preview(block),
                    },
                )
            )

            rows.append(
                TraceRow(
                    id=f'{base_id}:result',
                    session_id=session_id,
                    timestamp=timestamp,
                    trace_type='TOOL_RESULT',
                    function_name=tool_name,
                    tags=['copilot', role, 'tool-result'],
                    data={
                        'role': role,
                        'correlation_id': correlation_id,
                        'message_id': message_id,
                        'tool_call_id': tool_call_id,
                        'state': block.get('State'),
                        'description': block.get('Description'),
                        'status': block.get('Status'),
                        'result': result,
                        'raw': self._payload_preview(block),
                    },
                )
            )

        return rows

    def export_sqlite(self, rows: Iterable[TraceRow], sqlite_path: str | Path) -> Path:
        sqlite_path = Path(sqlite_path)
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        normalized_rows = list(rows)
        evaluations = self.evaluator.evaluate_rows(normalized_rows)
        summaries = self.evaluator.summarize(evaluations)
        conn = sqlite3.connect(sqlite_path)
        try:
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS traces (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    timestamp TEXT,
                    trace_type TEXT,
                    function_name TEXT,
                    tags TEXT,
                    data TEXT
                )
                '''
            )
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS evaluations (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    timestamp TEXT,
                    target_trace_id TEXT,
                    label TEXT,
                    score REAL,
                    status TEXT,
                    metrics TEXT,
                    notes TEXT
                )
                '''
            )
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS evaluation_sessions (
                    session_id TEXT PRIMARY KEY,
                    data TEXT
                )
                '''
            )
            conn.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON traces(timestamp)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_type ON traces(trace_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_session ON traces(session_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_eval_session ON evaluations(session_id)')
            conn.execute('DELETE FROM traces')
            conn.execute('DELETE FROM evaluations')
            conn.execute('DELETE FROM evaluation_sessions')
            conn.executemany(
                'INSERT OR REPLACE INTO traces (id, session_id, timestamp, trace_type, function_name, tags, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    (
                        row.id,
                        row.session_id,
                        row.timestamp,
                        row.trace_type,
                        row.function_name,
                        json.dumps(row.tags),
                        json.dumps(self._json_safe(row.data), ensure_ascii=False),
                    )
                    for row in normalized_rows
                ],
            )
            conn.executemany(
                'INSERT OR REPLACE INTO evaluations (id, session_id, timestamp, target_trace_id, label, score, status, metrics, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    (
                        item.id,
                        item.session_id,
                        item.timestamp,
                        item.target_trace_id,
                        item.label,
                        item.score,
                        item.status,
                        json.dumps(self._json_safe(item.metrics), ensure_ascii=False),
                        json.dumps(self._json_safe(item.notes), ensure_ascii=False),
                    )
                    for item in evaluations
                ],
            )
            conn.executemany(
                'INSERT OR REPLACE INTO evaluation_sessions (session_id, data) VALUES (?, ?)',
                [
                    (item['session_id'], json.dumps(self._json_safe(item), ensure_ascii=False))
                    for item in summaries
                ],
            )
            conn.commit()
        finally:
            conn.close()
        return sqlite_path

    def export_json(self, rows: Iterable[TraceRow], json_path: str | Path) -> Path:
        json_path = Path(json_path)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        normalized_rows = list(rows)
        serialized = [self.trace_to_agent_dict(row) for row in normalized_rows]
        evaluations = [self.evaluator.to_payload(item) for item in self.evaluator.evaluate_rows(normalized_rows)]
        session_evaluations = self.evaluator.summarize(self.evaluator.evaluate_rows(normalized_rows))
        payload = {
            'count': len(serialized),
            'traces': serialized,
            'evaluations': evaluations,
            'evaluation_sessions': session_evaluations,
        }
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        return json_path

    def parse_directory(self, sessions_dir: str | Path) -> list[TraceRow]:
        sessions_dir = Path(sessions_dir)
        rows: list[TraceRow] = []
        for path in sorted(sessions_dir.iterdir()):
            if path.is_file():
                rows.extend(self.parse_session_file(path))
        rows.sort(key=lambda row: (row.timestamp, row.session_id, row.id))
        return rows

    def trace_to_agent_dict(self, row: TraceRow) -> dict[str, Any]:
        payload = {
            'id': row.id,
            'session_id': row.session_id,
            'timestamp': row.timestamp,
            'trace_type': row.trace_type,
            'function_name': row.function_name,
            'type': row.trace_type,
            'function': row.function_name,
            'tags': row.tags,
        }
        payload.update(self._json_safe(row.data))
        return payload

    def _extract_session_id(self, session_meta: dict[str, Any]) -> str | None:
        session_id = session_meta.get('Id')
        if isinstance(session_id, list) and session_id:
            return str(session_id[0])
        if isinstance(session_id, str):
            return session_id
        return None

    def _extract_tool_call_id(self, function: dict[str, Any]) -> str | None:
        tool_id = function.get('Id')
        if isinstance(tool_id, list) and tool_id:
            return str(tool_id[0])
        if isinstance(tool_id, str):
            return tool_id
        return None

    def _decode_argument_payload(self, arguments: Any) -> Any:
        if isinstance(arguments, list) and len(arguments) == 2 and isinstance(arguments[1], dict):
            candidate = arguments[1]
            if 'json' in candidate:
                return self._parse_possible_json(candidate['json'])
            return self._deep_decode(candidate)
        return self._deep_decode(arguments)

    def _decode_tool_result(self, result: Any) -> Any:
        if not isinstance(result, list) or len(result) != 2 or not isinstance(result[1], dict):
            return self._deep_decode(result)
        value = result[1].get('Value')
        if isinstance(value, dict):
            container = value.get('ValueContainer')
            if isinstance(container, list) and len(container) >= 2:
                type_name = container[0]
                raw_value = container[1]
                decoded = self._try_decode_embedded_payload(raw_value)
                return {
                    'type_name': type_name,
                    'decoded': decoded,
                    'is_truncated': len(container) > 2 and bool(container[2]),
                }
        return self._deep_decode(result)

    def _try_decode_embedded_payload(self, value: Any) -> Any:
        if isinstance(value, dict) and 'base64' in value and isinstance(value['base64'], str):
            try:
                value = base64.b64decode(value['base64'])
            except Exception:
                return self._deep_decode(value)

        if isinstance(value, (bytes, bytearray)):
            raw_bytes = bytes(value)
            unpacked = self._unpack_msgpack_bytes(raw_bytes)
            if unpacked is not None:
                return self._deep_decode(unpacked)

            text = self._decode_text_bytes(raw_bytes)
            parsed_text = self._parse_possible_json(text)
            if parsed_text != text:
                return self._deep_decode(parsed_text)

            return {
                'base64': base64.b64encode(raw_bytes).decode('ascii'),
                'utf8': text,
            }

        return self._deep_decode(value)

    def _unpack_msgpack_bytes(self, raw_bytes: bytes) -> Any:
        try:
            unpacker = msgpack.Unpacker(raw=False, strict_map_key=False)
            unpacker.feed(raw_bytes)
            parts = list(unpacker)
            if not parts:
                return None
            if len(parts) == 1:
                return parts[0]
            return parts
        except Exception:
            return None

    def _decode_text_bytes(self, raw_bytes: bytes) -> str:
        return raw_bytes.decode('utf-8', errors='replace')

    def _parse_possible_json(self, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            return value
        if stripped[0] not in '{["' and stripped not in {'true', 'false', 'null'}:
            return value
        try:
            return json.loads(stripped)
        except Exception:
            return value

    def _deep_decode(self, value: Any) -> Any:
        if isinstance(value, dict):
            normalized = {str(k): self._deep_decode(v) for k, v in value.items()}
            container = normalized.get('ValueContainer')
            if isinstance(container, list) and len(container) >= 2:
                return {
                    'type_name': container[0],
                    'decoded': self._try_decode_embedded_payload(container[1]),
                    'is_truncated': len(container) > 2 and bool(container[2]),
                }
            return normalized
        if isinstance(value, list):
            return [self._deep_decode(v) for v in value]
        if isinstance(value, tuple):
            return [self._deep_decode(v) for v in value]
        if isinstance(value, (bytes, bytearray)):
            return self._try_decode_embedded_payload(value)
        if isinstance(value, str):
            parsed = self._parse_possible_json(value)
            if parsed != value:
                return self._deep_decode(parsed)
            return value
        return self._json_safe(value)

    def _payload_preview(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._truncate_value(self._json_safe(payload), 1200)

    def _truncate_value(self, value: Any, limit: int) -> Any:
        text = json.dumps(self._json_safe(value), ensure_ascii=False)
        if len(text) <= limit:
            return self._json_safe(value)
        return {'preview': text[:limit] + '…', 'truncated': True}

    def _json_safe(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {str(k): self._json_safe(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._json_safe(v) for v in value]
        if isinstance(value, tuple):
            return [self._json_safe(v) for v in value]
        if isinstance(value, (bytes, bytearray)):
            return {'base64': base64.b64encode(bytes(value)).decode('ascii')}
        if hasattr(value, 'seconds') and hasattr(value, 'nanoseconds'):
            return self._coerce_timestamp(value).isoformat()
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return str(value)

    def _coerce_timestamp(self, value: Any) -> dt.datetime:
        if hasattr(value, 'seconds') and hasattr(value, 'nanoseconds'):
            return dt.datetime.fromtimestamp(value.seconds + (value.nanoseconds / 1_000_000_000), tz=dt.timezone.utc)
        if isinstance(value, dt.datetime):
            return value.astimezone(dt.timezone.utc)
        return dt.datetime.now(dt.timezone.utc)

    def _interpolate_timestamp(self, start: dt.datetime, end: dt.datetime, index: int, total: int) -> str:
        if end < start:
            end = start
        span = (end - start).total_seconds()
        ratio = 0 if total <= 1 else index / (total - 1)
        current = start + dt.timedelta(seconds=span * ratio)
        return current.isoformat()


def main() -> None:
    parser = argparse.ArgumentParser(description='Parse Copilot chat session logs into AgentTrace-like traces')
    parser.add_argument('--input', required=True, help='Directory containing session files')
    parser.add_argument('--json', help='Write normalized traces JSON here')
    parser.add_argument('--sqlite', help='Write AgentTrace-compatible SQLite DB here')
    args = parser.parse_args()

    cp = CopilotSessionParser()
    rows = cp.parse_directory(args.input)

    print(f'Parsed {len(rows)} trace rows from {args.input}')
    if args.json:
        out = cp.export_json(rows, args.json)
        print(f'Wrote JSON export: {out}')
    if args.sqlite:
        out = cp.export_sqlite(rows, args.sqlite)
        print(f'Wrote SQLite export: {out}')


if __name__ == '__main__':
    main()
