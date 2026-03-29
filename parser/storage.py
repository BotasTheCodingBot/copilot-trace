from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_PATH = Path('out/copilot-trace-config.json')


@dataclass
class TraceStorageConfig:
    db_path: str = 'out/traces.db'
    json_path: str = 'out/traces.json'
    last_inputs: list[str] | None = None
    updated_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            'db_path': self.db_path,
            'json_path': self.json_path,
            'last_inputs': self.last_inputs or [],
            'updated_at': self.updated_at,
        }


class TraceStorageManager:
    def __init__(self, config_path: str | Path = DEFAULT_CONFIG_PATH):
        self.config_path = Path(config_path)

    def load(self) -> TraceStorageConfig:
        if not self.config_path.exists():
            return TraceStorageConfig()
        payload = json.loads(self.config_path.read_text(encoding='utf-8'))
        return TraceStorageConfig(
            db_path=payload.get('db_path', 'out/traces.db'),
            json_path=payload.get('json_path', 'out/traces.json'),
            last_inputs=list(payload.get('last_inputs') or []),
            updated_at=payload.get('updated_at'),
        )

    def save(self, config: TraceStorageConfig) -> Path:
        config.updated_at = datetime.now(timezone.utc).isoformat()
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(json.dumps(config.to_dict(), ensure_ascii=False, indent=2), encoding='utf-8')
        return self.config_path

    def update_paths(
        self,
        *,
        db_path: str | Path | None = None,
        json_path: str | Path | None = None,
        last_inputs: list[str] | None = None,
    ) -> TraceStorageConfig:
        config = self.load()
        if db_path is not None:
            config.db_path = str(db_path)
        if json_path is not None:
            config.json_path = str(json_path)
        if last_inputs is not None:
            config.last_inputs = [str(Path(item)) for item in last_inputs]
        self.save(config)
        return config

    def rotate_db(self, db_path: str | Path, *, suffix: str | None = None) -> Path | None:
        db_path = Path(db_path)
        if not db_path.exists():
            return None
        stamp = suffix or datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        rotated = db_path.with_name(f'{db_path.stem}.{stamp}{db_path.suffix}')
        db_path.parent.mkdir(parents=True, exist_ok=True)
        db_path.replace(rotated)
        return rotated
