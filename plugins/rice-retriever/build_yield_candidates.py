"""Build evidence-linked rice variety yield candidates from the raw package."""

import json
import re
import sys
from pathlib import Path


YIELD_VALUE = re.compile(r"(?P<label>平均亩产|亩产)\s*(?P<value>[0-9]+(?:\.[0-9]+)?)\s*(?P<unit>公斤|千克|[kK][gG])")
YEAR = re.compile(r"(?:19|20)\d{2}")


def build_candidates(records: list[dict]) -> list[dict]:
    output = []
    for record_index, record in enumerate(records):
        candidates = []
        for field, value in record["fields"].items():
            for sentence in re.split(r"(?<=[。；])", str(value)):
                for match in YIELD_VALUE.finditer(sentence):
                    candidates.append({
                        "kind": "average_yield" if match.group("label") == "平均亩产" else "yield",
                        "value_kg_per_mu": float(match.group("value")),
                        "years": YEAR.findall(sentence),
                        "source_field": field,
                        "evidence": sentence.strip(),
                    })
        if candidates:
            output.append({
                "record_index": record_index,
                "name": record["name"],
                "candidates": candidates,
            })
    return output


def main() -> None:
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    records = json.loads(source.read_text(encoding="utf-8"))
    result = {"records": build_candidates(records)}
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(result['records'])} records with yield candidates")


if __name__ == "__main__":
    main()
