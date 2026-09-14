"""Small deterministic utilities for the LucaRice agent."""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import time
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


UNITS = {
    "亩": ("area", 1 / 15), "mu": ("area", 1 / 15),
    "公顷": ("area", 1), "ha": ("area", 1),
    "平方米": ("area", 0.0001), "m2": ("area", 0.0001), "㎡": ("area", 0.0001),
    "g": ("weight", 0.001), "kg": ("weight", 1), "斤": ("weight", 0.5), "吨": ("weight", 1000),
    "mL": ("volume", 0.001), "ml": ("volume", 0.001), "L": ("volume", 1), "l": ("volume", 1), "m3": ("volume", 1000), "m³": ("volume", 1000),
    "mm": ("length", 0.001), "cm": ("length", 0.01), "m": ("length", 1),
    "kg/亩": ("weight_area", 15), "kg/mu": ("weight_area", 15),
    "kg/ha": ("weight_area", 1), "kg/公顷": ("weight_area", 1),
    "L/亩": ("volume_area", 15), "L/mu": ("volume_area", 15),
    "L/ha": ("volume_area", 1), "L/公顷": ("volume_area", 1),
    "mL/亩": ("volume_area", 0.015), "mL/mu": ("volume_area", 0.015),
    "mL/ha": ("volume_area", 0.001), "mL/公顷": ("volume_area", 0.001),
}


def require_values(data: dict, count: int = 1) -> list[float]:
    values = data["values"]
    if len(values) < count:
        raise ValueError(f"values requires at least {count} number(s)")
    return values


def compute(data: dict) -> dict:
    operation = data["operation"]
    if operation == "convert":
        from_kind, from_factor = UNITS[data["from_unit"]]
        to_kind, to_factor = UNITS[data["to_unit"]]
        if from_kind != to_kind:
            raise ValueError("units are not convertible")
        return {"result": data["value"] * from_factor / to_factor, "unit": data["to_unit"]}
    if operation == "rainfall_volume":
        return {"result": data["rainfall_mm"] * data["area_ha"] * 10, "unit": "m3"}

    values = require_values(data)
    if operation == "add" or operation == "sum":
        result = sum(values)
    elif operation == "subtract":
        require_values(data, 2)
        result = values[0] - sum(values[1:])
    elif operation == "multiply":
        result = math.prod(values)
    elif operation == "divide":
        require_values(data, 2)
        if values[1] == 0:
            raise ValueError("cannot divide by zero")
        result = values[0] / values[1]
    elif operation == "percentage":
        require_values(data, 2)
        if values[1] == 0:
            raise ValueError("cannot divide by zero")
        result = values[0] / values[1] * 100
    elif operation == "ratio":
        require_values(data, 2)
        if values[1] == 0:
            raise ValueError("cannot divide by zero")
        result = values[0] / values[1]
    elif operation == "mean":
        result = statistics.mean(values)
    elif operation == "median":
        result = statistics.median(values)
    elif operation == "min":
        result = min(values)
    elif operation == "max":
        result = max(values)
    elif operation == "count":
        result = len(values)
    elif operation == "standard_deviation":
        result = statistics.pstdev(values)
    elif operation == "percentage_above_threshold":
        result = sum(value > data["threshold"] for value in values) / len(values) * 100
    elif operation == "percentage_below_threshold":
        result = sum(value < data["threshold"] for value in values) / len(values) * 100
    else:
        raise ValueError(f"unsupported compute operation: {operation}")
    return {"result": result, **({"unit": "%"} if operation.startswith("percentage") else {})}


def parse_datetime(value: str) -> date | datetime:
    return date.fromisoformat(value) if len(value) == 10 else datetime.fromisoformat(value)


def date_math(data: dict) -> dict:
    operation = data["operation"]
    if operation == "add_days":
        return {"result": (date.fromisoformat(data["date"]) + timedelta(days=data["days"])).isoformat(), "unit": "date"}
    if operation == "difference":
        difference = parse_datetime(data["end"]) - parse_datetime(data["start"])
        unit = data.get("unit", "days")
        hours = difference.total_seconds() / 3600
        result = hours if unit == "hours" else hours / 24 if unit == "days" else hours / 168 if unit == "weeks" else None
        if result is None:
            raise ValueError(f"unsupported time unit: {unit}")
        return {"result": result, "unit": unit}
    if operation == "relation":
        first, second = parse_datetime(data["first"]), parse_datetime(data["second"])
        return {"result": "before" if first < second else "after" if first > second else "same"}
    if operation == "overlap":
        first_start, first_end = parse_datetime(data["first_start"]), parse_datetime(data["first_end"])
        second_start, second_end = parse_datetime(data["second_start"]), parse_datetime(data["second_end"])
        return {"result": first_start <= second_end and second_start <= first_end}
    raise ValueError(f"unsupported date operation: {operation}")


def export_table(data: dict, variety_data: Path, data_root: Path, user_id: str) -> dict:
    if data["source"] != "rice_variety":
        raise ValueError(f"unsupported table source: {data['source']}")

    query = normalize_text(data["query"])
    records = [
        entry
        for entry in json.loads(variety_data.read_text(encoding="utf-8"))
        if query in normalize_text(f"{entry['name']}\n" + "\n".join(str(value) for value in entry["fields"].values()))
    ]
    columns = data["columns"]
    rows = []
    for index, entry in enumerate(records, start=1):
        row = {}
        for column in columns:
            header = column["header"]
            if column.get("type") == "index":
                row[header] = index
                continue
            value = table_value(entry, column["field"])
            pattern = column.get("pattern")
            if pattern:
                matches = list(re.finditer(pattern, str(value)))
                if not matches and column["field"] != "record_text":
                    matches = list(re.finditer(pattern, table_value(entry, "record_text")))
                if column.get("match_mode") != "all":
                    matches = matches[:1]
                values = []
                for match in matches:
                    if column.get("calculation") == "group1/group2":
                        divisor = float(match.group(2))
                        values.append(str(float(match.group(1)) / divisor) if divisor else "")
                    else:
                        values.append(match.group(1))
                value = "；".join(values)
            row[header] = value
        rows.append(row)

    pending = [
        {"row": row_index, "column": column, "record": {"name": entry["name"], "fields": entry["fields"]}}
        for column in columns
        if column.get("type") != "index"
        for row_index, (row, entry) in enumerate(zip(rows, records))
        if not row[column["header"]]
    ]
    if data.get("mode") == "prepare":
        return {"rows": rows, "pending": pending}

    llm_filled = 0
    unresolved = 0
    for fill in data.get("fills", []):
        row_index = fill["row"]
        header = fill["header"]
        value = fill.get("value", "")
        evidence = fill.get("evidence", "")
        record_text = table_value(records[row_index], "record_text")
        if value and evidence and evidence in record_text and value in evidence:
            rows[row_index][header] = value
            llm_filled += 1
        else:
            unresolved += 1
    for row in rows:
        for column in columns:
            if not row.get(column["header"]):
                row[column["header"]] = "无数据"

    export_dir = data_root / "users" / user_id / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    filename = f"table_{time.time_ns()}.csv"
    with (export_dir / filename).open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=[column["header"] for column in columns])
        writer.writeheader()
        writer.writerows(rows)
    return {
        "total": len(rows),
        "columns": [column["header"] for column in columns],
        "llm_filled": llm_filled,
        "unresolved": unresolved,
        "download_url": f"/_lucarice/exports/{filename}",
    }


def table_value(entry: dict, field: str) -> str:
    fields = entry["fields"]
    if field in ("name", "matched_name"):
        return entry["name"]
    if field == "parentage":
        return fields.get("品种来源", fields.get("亲本来源", ""))
    if field == "record_text":
        return "\n".join(f"{key}：{value}" for key, value in fields.items())
    return fields.get(field, "")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", value).casefold()


class Handler(BaseHTTPRequestHandler):
    variety_data: Path
    data_root: Path

    def do_GET(self) -> None:
        if self.path == "/ready":
            self.send_response(204)
            self.end_headers()
            return
        if not self.path.startswith("/exports/"):
            self.send_error(404)
            return
        user_id = self.headers.get("x-lucarice-user-id")
        if not user_id:
            self.send_error(401)
            return
        output = self.data_root / "users" / user_id / "exports" / Path(self.path.removeprefix("/exports/")).name
        body = output.read_bytes()
        self.send_response(200)
        self.send_header("content-type", "text/csv; charset=utf-8")
        self.send_header("content-disposition", f'attachment; filename="{output.name}"')
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            length = int(self.headers["content-length"])
            payload = json.loads(self.rfile.read(length))
            if self.path == "/compute":
                result = compute({"operation": payload["operation"], **payload["data"]})
            elif self.path == "/date-math":
                result = date_math({"operation": payload["operation"], **payload["data"]})
            elif self.path == "/export-table":
                user_id = self.headers.get("x-lucarice-user-id")
                if not user_id:
                    raise ValueError("缺少账户信息")
                result = export_table(payload, self.variety_data, self.data_root, user_id)
            else:
                self.send_error(404)
                return
            body = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(200)
        except (KeyError, ValueError, TypeError, IndexError) as error:
            body = json.dumps({"error": str(error)}, ensure_ascii=False).encode()
            self.send_response(400)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    parser.add_argument("--variety-data", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    args = parser.parse_args()
    Handler.variety_data = args.variety_data
    Handler.data_root = args.data_root
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    args.ready_file.write_text(str(args.port), encoding="utf-8")
    server.serve_forever()


if __name__ == "__main__":
    main()
