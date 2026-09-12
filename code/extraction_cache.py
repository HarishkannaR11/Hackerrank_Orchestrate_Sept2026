import sqlite3
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / 'code' / 'extraction_cache.sqlite'

class ExtractionCache:
    def __init__(self, db_path=DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS cache (
                    item_id TEXT,
                    model_version TEXT,
                    result JSON,
                    PRIMARY KEY (item_id, model_version)
                )
            ''')
            conn.commit()

    def get(self, item_id, model_version):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                'SELECT result FROM cache WHERE item_id = ? AND model_version = ?',
                (item_id, model_version)
            )
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
            return None

    def set(self, item_id, model_version, result):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                'INSERT OR REPLACE INTO cache (item_id, model_version, result) VALUES (?, ?, ?)',
                (item_id, model_version, json.dumps(result))
            )
            conn.commit()
