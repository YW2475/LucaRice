"""Store LucaRice field profiles and farm events in its business database."""

from __future__ import annotations

import argparse
import json
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from qcloud_cos import CosConfig, CosS3Client

PROFILE_KEYS = (
    "project_name", "field_name", "location", "latitude", "longitude", "planting_area", "planted_variety",
    "sowing_date", "transplant_date", "cultivation_method", "season_type", "target_yield", "soil_info", "irrigation_condition",
    "image_provider", "image_bucket", "image_region", "image_prefix",
)
EVENT_TYPES = {
    "sowing", "transplanting", "fertilization", "pesticide_application", "irrigation", "drainage", "drying_field",
    "weeding", "field_observation", "pest_observation", "disease_observation", "disaster_event", "harvest", "other",
}
DATA_LOCK = threading.RLock()


def get_json(url: str, token: str | None = None) -> dict[str, object]:
    headers = {} if token is None else {"authorization": token}
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        return json.load(response)


def public_field(field: dict[str, object]) -> dict[str, object]:
    return {
        key: field.get(key, "")
        for key in (
            *PROFILE_KEYS,
            "sensor_provider", "platform_name", "api_base_url", "device_addr",
            "camera_provider", "camera_api_base_url", "camera_device_id",
            "asset_provider", "asset_index_url", "image_provider", "image_bucket", "image_region", "image_prefix",
        )
    }


def events_in_range(events: list[dict[str, object]], start_date: str | None, end_date: str | None) -> list[dict[str, object]]:
    return [
        event for event in events
        if (start_date is None or str(event["event_date"]) >= start_date)
        and (end_date is None or str(event["event_date"]) <= end_date)
    ]


class FieldStore:
    """Owns field rows and imports the previous per-folder records once per user."""

    def __init__(self, data_root: Path) -> None:
        self.data_root = data_root
        self.connection = sqlite3.connect(data_root / "lucarice.sqlite3", check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.execute("PRAGMA busy_timeout = 5000")
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS field_profiles (
                id INTEGER PRIMARY KEY,
                user_id TEXT NOT NULL,
                storage_name TEXT NOT NULL,
                profile_json TEXT NOT NULL,
                UNIQUE (user_id, storage_name)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS field_events (
                id INTEGER PRIMARY KEY,
                field_id INTEGER NOT NULL REFERENCES field_profiles(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                event_json TEXT NOT NULL,
                UNIQUE (field_id, position)
            ) STRICT;
            CREATE TABLE IF NOT EXISTS imported_legacy_field_users (
                user_id TEXT PRIMARY KEY
            ) STRICT;
        """)
        self.connection.commit()

    def _legacy_fields(self, user_id: str) -> Path:
        return self.data_root / "users" / user_id / "fields"

    def ensure_user(self, user_id: str) -> None:
        if self.connection.execute("SELECT 1 FROM imported_legacy_field_users WHERE user_id = ?", (user_id,)).fetchone():
            return
        legacy = self._legacy_fields(user_id)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            if legacy.exists():
                for folder in legacy.iterdir():
                    field_file = folder / "field.json"
                    if not field_file.exists():
                        continue
                    profile = json.loads(field_file.read_text(encoding="utf-8"))
                    self.connection.execute(
                        "INSERT OR IGNORE INTO field_profiles (user_id, storage_name, profile_json) VALUES (?, ?, ?)",
                        (user_id, folder.name, json.dumps(profile, ensure_ascii=False)),
                    )
                    field_id = self.connection.execute(
                        "SELECT id FROM field_profiles WHERE user_id = ? AND storage_name = ?", (user_id, folder.name),
                    ).fetchone()["id"]
                    events_file = folder / "events.json"
                    events = [] if not events_file.exists() else json.loads(events_file.read_text(encoding="utf-8"))
                    for position, event in enumerate(events):
                        self.connection.execute(
                            "INSERT OR IGNORE INTO field_events (field_id, position, event_json) VALUES (?, ?, ?)",
                            (field_id, position, json.dumps(event, ensure_ascii=False)),
                        )
            self.connection.execute("INSERT INTO imported_legacy_field_users (user_id) VALUES (?)", (user_id,))
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise

    def fields(self, user_id: str) -> list[dict[str, object]]:
        self.ensure_user(user_id)
        return [
            {**json.loads(row["profile_json"]), "storage_name": row["storage_name"]}
            for row in self.connection.execute(
                "SELECT storage_name, profile_json FROM field_profiles WHERE user_id = ? ORDER BY rowid", (user_id,)
            )
        ]

    def write_fields(self, user_id: str, fields: list[dict[str, object]]) -> list[dict[str, object]]:
        self.ensure_user(user_id)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            names = set()
            for field in fields:
                storage_name = str(field.get("storage_name") or field["project_name"] or field["field_name"])
                names.add(storage_name)
                profile = {key: value for key, value in field.items() if key != "storage_name"}
                self.connection.execute("""
                    INSERT INTO field_profiles (user_id, storage_name, profile_json) VALUES (?, ?, ?)
                    ON CONFLICT(user_id, storage_name) DO UPDATE SET profile_json = excluded.profile_json
                """, (user_id, storage_name, json.dumps(profile, ensure_ascii=False)))
            for row in self.connection.execute("SELECT storage_name FROM field_profiles WHERE user_id = ?", (user_id,)):
                if row["storage_name"] not in names:
                    self.connection.execute("DELETE FROM field_profiles WHERE user_id = ? AND storage_name = ?", (user_id, row["storage_name"]))
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise
        return self.fields(user_id)

    def find_field(self, user_id: str, name: str) -> tuple[int, dict[str, object]]:
        for field in self.fields(user_id):
            if name in {field["project_name"], field["field_name"]}:
                row = self.connection.execute(
                    "SELECT id FROM field_profiles WHERE user_id = ? AND storage_name = ?", (user_id, field["storage_name"]),
                ).fetchone()
                return row["id"], field
        raise ValueError(f"未登记田块：{name}")

    def events(self, field_id: int) -> list[dict[str, object]]:
        return [json.loads(row["event_json"]) for row in self.connection.execute(
            "SELECT event_json FROM field_events WHERE field_id = ? ORDER BY position", (field_id,)
        )]

    def replace_events(self, field_id: int, events: list[dict[str, object]]) -> None:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute("DELETE FROM field_events WHERE field_id = ?", (field_id,))
            for position, event in enumerate(events):
                self.connection.execute("INSERT INTO field_events (field_id, position, event_json) VALUES (?, ?, ?)", (field_id, position, json.dumps(event, ensure_ascii=False)))
            self.connection.commit()
        except Exception:
            self.connection.rollback()
            raise

    def append_event(self, field_id: int, event: dict[str, object]) -> int:
        position = self.connection.execute("SELECT COUNT(*) AS count FROM field_events WHERE field_id = ?", (field_id,)).fetchone()["count"]
        self.connection.execute("INSERT INTO field_events (field_id, position, event_json) VALUES (?, ?, ?)", (field_id, position, json.dumps(event, ensure_ascii=False)))
        self.connection.commit()
        return position + 1

    def update_event(self, field_id: int, position: int, event: dict[str, object]) -> None:
        result = self.connection.execute("UPDATE field_events SET event_json = ? WHERE field_id = ? AND position = ?", (json.dumps(event, ensure_ascii=False), field_id, position))
        if result.rowcount == 0:
            raise IndexError("农事记录不存在")
        self.connection.commit()

    def update_profile(self, field_id: int, field: dict[str, object]) -> None:
        self.connection.execute("UPDATE field_profiles SET profile_json = ? WHERE id = ?", (json.dumps({key: value for key, value in field.items() if key != "storage_name"}, ensure_ascii=False), field_id))
        self.connection.commit()


def field_data(payload: dict[str, object], store: FieldStore, user_id: str) -> dict[str, object]:
    field_id, field = store.find_field(user_id, str(payload["field"]))
    events = events_in_range(store.events(field_id), payload.get("start_date"), payload.get("end_date"))
    if payload["operation"] == "events":
        return {"field": public_field(field), "events": events}
    return {"profile": public_field(field), "recent_events": events[-10:]}


def event_from_payload(payload: dict[str, object]) -> dict[str, object]:
    event_type = str(payload["event_type"])
    if event_type not in EVENT_TYPES:
        raise ValueError(f"不支持的事件类型：{event_type}")
    return {"event_type": event_type, "event_date": payload["event_date"], "details": payload["details"], "source": payload.get("source", "user_report")}


def record_event(payload: dict[str, object], store: FieldStore, user_id: str) -> dict[str, object]:
    field_id, field = store.find_field(user_id, str(payload["field"]))
    event = event_from_payload(payload)
    return {"field": field["project_name"], "recorded": True, "event": event, "event_count": store.append_event(field_id, event)}


def replace_events(payload: dict[str, object], store: FieldStore, user_id: str) -> dict[str, object]:
    field_id, field = store.find_field(user_id, str(payload["field"]))
    events = payload["events"]
    store.replace_events(field_id, events)
    return {"field": field["project_name"], "saved": True, "event_count": len(events)}


def update_event(payload: dict[str, object], store: FieldStore, user_id: str) -> dict[str, object]:
    field_id, field = store.find_field(user_id, str(payload["field"]))
    event = event_from_payload(payload)
    event_index = int(payload["event_index"])
    store.update_event(field_id, event_index, event)
    return {"field": field["project_name"], "updated": True, "event_index": event_index, "event": event}


def update_profile(payload: dict[str, object], store: FieldStore, user_id: str) -> dict[str, object]:
    field_id, field = store.find_field(user_id, str(payload["field"]))
    changes = payload["changes"]
    field.update({key: value for key, value in changes.items() if key in PROFILE_KEYS})
    store.update_profile(field_id, field)
    return {"field": public_field(field), "updated": list(changes)}


def current_data(name: str, store: FieldStore, user_id: str) -> dict[str, object]:
    _, field = store.find_field(user_id, name)
    base_url = str(field["api_base_url"]).rstrip("/")
    token_data = get_json(f"{base_url}/api/getToken?{urlencode({'loginName': field['api_username'], 'password': field['api_password']})}")
    if token_data["code"] != 1000:
        raise ValueError(token_data["message"])
    result = get_json(f"{base_url}/api/data/getRealTimeDataByDeviceAddr?{urlencode({'deviceAddrs': field['device_addr']})}", token_data["data"]["token"])
    if result["code"] != 1000:
        raise ValueError(result["message"])
    device = result["data"][0]
    metrics = [{"name": item["registerName"], "value": item["value"], "unit": item["unit"], "alarm_level": item["alarmLevel"]} for node in device["dataItem"] for item in node["registerItem"]]
    return {**public_field(field), "device_name": device["deviceName"], "device_addr": device["deviceAddr"], "device_status": device["deviceStatus"], "timestamp_ms": device["timeStamp"], "metrics": metrics}


def latest_images(name: str, store: FieldStore, user_id: str, cos_config_file: Path) -> dict[str, object]:
    _, field = store.find_field(user_id, name)
    if field.get("image_provider") != "tencent_cos":
        return {"field": public_field(field), "images": []}
    config = json.loads(cos_config_file.read_text(encoding="utf-8"))
    client = CosS3Client(CosConfig(Region=str(field["image_region"]), SecretId=str(config["secret_id"]), SecretKey=str(config["secret_key"]), Scheme="https"))
    bucket = str(field["image_bucket"])
    prefix = str(field["image_prefix"]).strip("/")
    entries = []
    for item in client.list_objects(Bucket=bucket, Prefix=f"{prefix}/").get("Contents", []):
        key = str(item["Key"])
        relative = key.removeprefix(f"{prefix}/")
        if Path(relative).suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
            date, _, image_name = relative.partition("/")
            entries.append({"date": date, "key": key, "name": image_name, "captured_at": str(item["LastModified"])})
    images = []
    for date in reversed(sorted({item["date"] for item in entries}, reverse=True)[:3]):
        item = max((entry for entry in entries if entry["date"] == date), key=lambda entry: entry["captured_at"])
        images.append({"date": date, "name": item["name"], "url": client.get_presigned_download_url(Bucket=bucket, Key=item["key"], Expired=600), "media_type": "image/png" if Path(item["name"]).suffix.lower() == ".png" else "image/jpeg"})
    return {"field": public_field(field), "images": images}


class Handler(BaseHTTPRequestHandler):
    store: FieldStore
    cos_config_file: Path

    def send_json(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def user_id(self) -> str:
        user_id = self.headers.get("x-lucarice-user-id")
        if not user_id:
            raise ValueError("缺少账户信息")
        return user_id

    def do_GET(self) -> None:
        try:
            if self.path == "/ready":
                self.send_response(204)
                self.end_headers()
            elif self.path == "/fields":
                with DATA_LOCK: self.send_json(200, {"fields": self.store.fields(self.user_id())})
            elif self.path == "/projects":
                with DATA_LOCK: self.send_json(200, {"fields": [public_field(field) for field in self.store.fields(self.user_id())]})
            else:
                self.send_error(404)
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def do_POST(self) -> None:
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            user_id = self.user_id()
            with DATA_LOCK:
                if self.path == "/fields": value = {"fields": self.store.write_fields(user_id, body["fields"])}
                elif self.path == "/field-data": value = field_data(body, self.store, user_id)
                elif self.path == "/record-event": value = record_event(body, self.store, user_id)
                elif self.path == "/events": value = replace_events(body, self.store, user_id)
                elif self.path == "/update-event": value = update_event(body, self.store, user_id)
                elif self.path == "/update-profile": value = update_profile(body, self.store, user_id)
                elif self.path == "/current": value = current_data(body["field"], self.store, user_id)
                elif self.path == "/field-images": value = latest_images(body["field"], self.store, user_id, self.cos_config_file)
                else:
                    self.send_error(404)
                    return
            self.send_json(200, value)
        except Exception as error:
            self.send_json(500, {"error": str(error)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--config-file", type=Path)
    parser.add_argument("--cos-config-file", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    args = parser.parse_args()
    args.data_root.mkdir(parents=True, exist_ok=True)
    Handler.store = FieldStore(args.data_root)
    Handler.cos_config_file = args.cos_config_file
    args.ready_file.write_text("ready", encoding="utf-8")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
