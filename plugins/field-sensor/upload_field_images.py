"""Upload one field's dated image folder to its Tencent COS prefix."""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from qcloud_cos import CosConfig, CosS3Client


def image_date(folder: Path) -> str:
    return datetime.strptime(f"2026-{folder.name}", "%Y-%m.%d").date().isoformat()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    args = parser.parse_args()

    credentials = json.loads(args.credentials.read_text(encoding="utf-8"))
    cos_config = CosConfig(
        Region=args.region,
        SecretId=credentials["secret_id"],
        SecretKey=credentials["secret_key"],
        Scheme="https",
    )
    client = CosS3Client(cos_config)
    prefix = args.prefix.strip("/")
    source_folders = sorted((folder for folder in args.source.iterdir() if folder.is_dir()), key=image_date)
    images = [image for folder in source_folders for image in sorted(folder.glob("*.jpg"))]
    def upload(image: Path) -> dict[str, str]:
        date = image_date(image.parent)
        key = f"{prefix}/{date}/{image.name}"
        CosS3Client(cos_config).upload_file(
            Bucket=args.bucket,
            Key=key,
            LocalFilePath=str(image),
            EnableMD5=False,
            ContentType="image/jpeg",
        )
        return {
            "date": date,
            "key": key,
            "name": image.name,
            "captured_at": datetime.fromtimestamp(image.stat().st_mtime).isoformat(),
        }

    manifest_images = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(upload, image) for image in images]
        for index, future in enumerate(as_completed(futures), start=1):
            manifest_images.append(future.result())
            print(f"uploaded {index}/{len(images)}", flush=True)
    manifest_images.sort(key=lambda image: (image["date"], image["captured_at"], image["name"]))
    manifest = {"field": "郴州市安仁县实验田", "images": manifest_images}
    client.put_object(
        Bucket=args.bucket,
        Key=f"{prefix}/manifest.json",
        Body=json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )
    print(f"uploaded {len(images)} images and manifest", flush=True)


if __name__ == "__main__":
    main()
