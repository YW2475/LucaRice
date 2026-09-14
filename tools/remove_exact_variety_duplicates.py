"""Remove exact duplicate rice-variety records, preserving first occurrence."""

import json
import sys
from pathlib import Path


def main() -> None:
    path = Path(sys.argv[1])
    records = json.loads(path.read_text(encoding="utf-8"))
    seen = set()
    unique = []
    for record in records:
        key = (record["name"], json.dumps(record["fields"], ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        if key not in seen:
            seen.add(key)
            unique.append(record)
    path.write_text(json.dumps(unique, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"removed {len(records) - len(unique)} exact duplicate records; kept {len(unique)} records")


if __name__ == "__main__":
    main()
