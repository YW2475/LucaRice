"""Read QWeather forecasts for configured fields or explicitly named locations."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def get_json(host: str, path: str, params: dict[str, str], key: str) -> dict[str, object]:
    url = f"https://{host}{path}?{urlencode(params)}"
    with urlopen(Request(url, headers={"X-QW-Api-Key": key}), timeout=30) as response:
        body = response.read()
        if response.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return json.loads(body)


def field_location(name: str, data_root: Path, user_id: str) -> dict[str, str]:
    connection = sqlite3.connect(data_root / "lucarice.sqlite3")
    connection.execute("PRAGMA busy_timeout = 5000")
    for row in connection.execute("SELECT profile_json FROM field_profiles WHERE user_id = ?", (user_id,)):
        field = json.loads(row[0])
        if name in {field["project_name"], field["field_name"]}:
            connection.close()
            return {
                "name": field["project_name"],
                "location": f"{field['longitude']},{field['latitude']}",
                "latitude": field["latitude"],
                "longitude": field["longitude"],
            }
    connection.close()
    raise ValueError(f"未登记田块：{name}")


def normalize_location(value: str) -> str:
    return re.sub(r"[\s省市县区旗]", "", value)


def location_label(item: dict[str, str]) -> str:
    return "".join((item.get("adm1", ""), item.get("adm2", ""), item["name"]))


def resolve_location(name: str, host: str, key: str) -> dict[str, object]:
    coordinates = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*", name)
    if coordinates:
        return {
            "status": "resolved",
            "name": name,
            "location": f"{coordinates.group(1)},{coordinates.group(2)}",
            "latitude": coordinates.group(2),
            "longitude": coordinates.group(1),
        }
    result = get_json(host, "/geo/v2/city/lookup", {"location": name, "range": "cn", "number": "10", "lang": "zh"}, key)
    if result["code"] != "200" or not result["location"]:
        return {"status": "not_found", "input": name}
    normalized = normalize_location(name)
    matches = [
        item for item in result["location"]
        if item["id"] == name or normalized in normalize_location(location_label(item))
    ]
    if len(matches) != 1:
        candidates = matches or result["location"]
        return {
            "status": "ambiguous",
            "input": name,
            "candidates": [
                {"label": location_label(item), "location_id": item["id"]}
                for item in candidates[:6]
            ],
        }
    item = matches[0]
    return {
        "status": "resolved",
        "name": location_label(item),
        "location_id": item["id"],
        "location": item["id"],
        "latitude": item["lat"],
        "longitude": item["lon"],
    }


def forecast(payload: dict[str, str], data_root: Path, user_id: str, host: str, key: str) -> dict[str, object]:
    location = field_location(payload["field"], data_root, user_id) if payload.get("field") else resolve_location(payload["location"], host, key)
    if location.get("status") != "resolved" and not payload.get("field"):
        return {"location": location}
    operation = payload["operation"]
    if operation == "current":
        path, params = "/v7/weather/now", {"location": location["location"], "lang": "zh", "unit": "m"}
    elif operation == "72h":
        path, params = "/v7/weather/72h", {"location": location["location"], "lang": "zh", "unit": "m"}
    elif operation == "7d":
        path, params = "/v7/weather/7d", {"location": location["location"], "lang": "zh", "unit": "m"}
    elif operation == "2h_rain":
        path, params = "/v7/minutely/5m", {"location": location["location"], "lang": "zh"}
    else:
        path, params = f"/weatheralert/v1/current/{location['latitude']}/{location['longitude']}", {"localTime": "true", "lang": "zh"}
    result = get_json(host, path, params, key)
    if result.get("code") not in {None, "200"}:
        raise ValueError(result.get("message", result["code"]))
    return {"location": location, "operation": operation, "weather": result}


class Handler(BaseHTTPRequestHandler):
    data_root: Path
    host: str
    key: str

    def send_json(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/ready":
            self.send_response(204)
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self) -> None:
        try:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            user_id = self.headers.get("x-lucarice-user-id")
            if not user_id:
                raise ValueError("缺少账户信息")
            self.send_json(200, forecast(payload, self.data_root, user_id, self.host, self.key))
        except Exception as error:
            self.send_json(500, {"error": str(error)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--fields-file", type=Path)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    args = parser.parse_args()
    load_env(args.env_file)
    Handler.data_root = args.data_root
    Handler.host = os.environ["QWEATHER_API_HOST"].strip()
    Handler.key = os.environ["QWEATHER_API_KEY"].strip()
    args.ready_file.write_text("ready", encoding="utf-8")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
