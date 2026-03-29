from __future__ import annotations

import argparse
import json
from pathlib import Path

from parser.copilot_parser import CopilotSessionParser, TraceRow
from parser.storage import DEFAULT_CONFIG_PATH, TraceStorageManager


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='copilot-trace', description='Copilot Trace CLI')
    subparsers = parser.add_subparsers(dest='command', required=True)

    trace_parser = subparsers.add_parser('trace', help='Ingest one or more Copilot session directories into JSON + SQLite outputs')
    trace_parser.add_argument('inputs', nargs='+', help='One or more directories containing Copilot session files')
    trace_parser.add_argument('--db', help='SQLite output path. Defaults to configured db_path.')
    trace_parser.add_argument('--json', dest='json_path', help='JSON output path. Defaults to configured json_path.')
    trace_parser.add_argument('--config', default=str(DEFAULT_CONFIG_PATH), help='Config file path')
    trace_parser.add_argument('--rotate-db', action='store_true', help='Rotate the current SQLite db before writing a new one')

    config_parser = subparsers.add_parser('config', help='Inspect persisted CLI storage settings')
    config_parser.add_argument('--config', default=str(DEFAULT_CONFIG_PATH), help='Config file path')

    return parser


def ingest_directories(parser: CopilotSessionParser, inputs: list[str]) -> list[TraceRow]:
    rows: list[TraceRow] = []
    for item in inputs:
        rows.extend(parser.parse_directory(item))
    rows.sort(key=lambda row: (row.timestamp, row.session_id, row.id))
    return rows


def handle_trace(args: argparse.Namespace) -> int:
    storage = TraceStorageManager(args.config)
    config = storage.load()
    db_path = Path(args.db or config.db_path)
    json_path = Path(args.json_path or config.json_path)

    if args.rotate_db:
        rotated = storage.rotate_db(db_path)
        if rotated is not None:
            print(f'Rotated SQLite db: {rotated}')

    parser = CopilotSessionParser()
    rows = ingest_directories(parser, args.inputs)
    parser.export_sqlite(rows, db_path)
    parser.export_json(rows, json_path)
    updated = storage.update_paths(db_path=db_path, json_path=json_path, last_inputs=args.inputs)

    print(f'Parsed {len(rows)} trace rows from {len(args.inputs)} input director(ies)')
    print(f'SQLite: {db_path}')
    print(f'JSON:   {json_path}')
    print(f'Config: {Path(args.config)}')
    print(json.dumps(updated.to_dict(), ensure_ascii=False, indent=2))
    return 0


def handle_config(args: argparse.Namespace) -> int:
    storage = TraceStorageManager(args.config)
    print(json.dumps(storage.load().to_dict(), ensure_ascii=False, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == 'trace':
        return handle_trace(args)
    if args.command == 'config':
        return handle_config(args)
    parser.error(f'Unknown command: {args.command}')
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
