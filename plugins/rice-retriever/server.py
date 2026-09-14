from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import time
import unicodedata
from collections import Counter, defaultdict
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Lock
from urllib.request import Request, urlopen

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from transformers import AutoModelForCausalLM, AutoTokenizer


RRF_K = 60
CANDIDATE_K = 30
FINAL_TOP_K = 10
RERANKER_INSTRUCTION = (
    "Given a rice production question, retrieve authoritative passages that directly "
    "and accurately support an answer. Prioritize exact pest, disease or weed entities, "
    "symptoms, growth stage, management objective, and regional conditions."
)
RERANKER_PREFIX = (
    '<|im_start|>system\nJudge whether the Document meets the requirements based on '
    'the Query and the Instruct provided. Note that the answer can only be "yes" or '
    '"no".<|im_end|>\n<|im_start|>user\n'
)
RERANKER_SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
CHINESE_RUN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]+")
LATIN_NUMBER = re.compile(
    r"[a-z]+(?:[-_][a-z0-9]+)*|\d+(?:\.\d+)?(?:%|kg|mg|g|ml|l|cm|mm|亩|天|日|代|龄|次)?",
    re.IGNORECASE,
)
ENTITY_FIELDS = ("diseases", "pests", "weeds", "rodents", "snails")


def as_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []


def metadata_values(chunk: dict[str, object], field: str) -> list[str]:
    value = chunk.get(field)
    if value is None:
        metadata = chunk.get("metadata")
        value = metadata.get(field) if isinstance(metadata, dict) else []
    return [str(item) for item in as_list(value)]


class ChineseSparseTokenizer:
    def __init__(self, domain_terms: set[str]) -> None:
        self.domain_terms = tuple(
            sorted(
                {self.normalize(term) for term in domain_terms if 2 <= len(self.normalize(term)) <= 24},
                key=lambda item: (-len(item), item),
            )
        )

    @staticmethod
    def normalize(text: object) -> str:
        return unicodedata.normalize("NFKC", str(text or "")).lower().strip()

    def tokenize(self, text: object) -> list[str]:
        normalized = self.normalize(text)
        tokens = [match.group(0) for match in LATIN_NUMBER.finditer(normalized)]
        for run in CHINESE_RUN.findall(normalized):
            if len(run) == 1:
                tokens.append(run)
                continue
            tokens.extend(run[index : index + 2] for index in range(len(run) - 1))
            if len(run) >= 3:
                tokens.extend(run[index : index + 3] for index in range(len(run) - 2))
        tokens.extend(term for term in self.domain_terms if term in normalized)
        return tokens


class RiceVarietyPackage:
    def __init__(self, data_path: Path) -> None:
        entries = json.loads(data_path.read_text(encoding="utf-8"))
        self.records = []
        self.search_texts = []
        for entry in entries:
            variety_name = str(entry["name"])
            fields = entry["fields"]
            approval_info = str(fields.get("审定情况", fields.get("审定信息", "")))
            record_text = "\n".join(f"**{key}**：{value}" for key, value in fields.items())
            record = {
                "matched_name": variety_name,
                "approval_info": approval_info,
                "approval_number": str(fields.get("审定编号", "")),
                "approval_source": approval_info,
                "parentage": str(fields.get("品种来源", fields.get("亲本来源", ""))),
                "breeding_org": fields.get("选育单位", fields.get("育种者", "")),
                "variety_type": fields.get("品种类型", ""),
                "characteristics": fields.get("特征特性", ""),
                "yield_performance": fields.get("产量表现", ""),
                "cultivation": fields.get("栽培技术要点", ""),
                "approval_opinion": fields.get("审定意见", ""),
                "source_org": "",
                "source": approval_info,
                "record_text": f"### {variety_name}\n{record_text}",
            }
            self.records.append(record)
            self.search_texts.append(self.normalize_name(f"{variety_name}\n{record_text}"))

    @staticmethod
    def normalize_name(name: str) -> str:
        return re.sub(r"\s+", "", unicodedata.normalize("NFKC", name)).casefold()

    def lookup(self, query: str) -> list[dict[str, str]]:
        normalized_query = self.normalize_name(query)
        return [record for record, search_text in zip(self.records, self.search_texts) if normalized_query in search_text]

    @staticmethod
    def export(records: list[dict[str, str]], export_dir: Path) -> str:
        export_dir.mkdir(parents=True, exist_ok=True)
        filename = f"rice_variety_results_{time.time_ns()}.csv"
        with (export_dir / filename).open("w", encoding="utf-8-sig", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=list(records[0]))
            writer.writeheader()
            writer.writerows(records)
        return filename


class RiceKnowledgePackage:
    def __init__(
        self,
        package_dir: Path,
        model_dir: Path,
        reranker_model_dir: Path,
        embedding_model: SentenceTransformer | None = None,
        reranker_tokenizer: object | None = None,
        reranker_model: object | None = None,
        device: str | None = None,
    ) -> None:
        manifest = json.loads((package_dir / "package_manifest.json").read_text(encoding="utf-8"))
        model_info = json.loads((package_dir / manifest["paths"]["model_info"]).read_text(encoding="utf-8"))
        index = json.loads((package_dir / manifest["paths"]["vector_index"]).read_text(encoding="utf-8"))
        chunks = {
            chunk["chunk_id"]: chunk
            for line in (package_dir / manifest["paths"]["chunks"]).read_text(encoding="utf-8").splitlines()
            for chunk in [json.loads(line)]
        }
        self.vectors = np.load(package_dir / index["vectors_path"], allow_pickle=False)
        chunk_ids = [""] * self.vectors.shape[0]
        for line in (package_dir / manifest["paths"]["embedding_manifest"]).read_text(encoding="utf-8").splitlines():
            embedding = json.loads(line)
            chunk_ids[embedding["embedding_row"]] = embedding["chunk_id"]
        self.chunk_ids = chunk_ids
        self.rows = [chunks[chunk_id] for chunk_id in chunk_ids]
        self.pesticide_rules = {
            rule["standard_name"]: rule
            for line in (package_dir / "safety_registry" / "safety_registry.jsonl").read_text(encoding="utf-8").splitlines()
            for rule in [json.loads(line)]
        }
        self.pesticide_aliases = {
            alias: standard_name
            for standard_name in self.pesticide_rules
            for alias in (standard_name, self.pesticide_rules[standard_name]["english_name"])
        }
        for line in (package_dir / "safety_registry" / "pesticide_synonyms.jsonl").read_text(encoding="utf-8").splitlines():
            synonym = json.loads(line)
            if synonym["standard_name"] in self.pesticide_rules:
                self.pesticide_aliases[synonym["synonym"]] = synonym["standard_name"]
        for line in (package_dir / "safety_registry" / "pesticide_entities.jsonl").read_text(encoding="utf-8").splitlines():
            entity = json.loads(line)
            canonical_name = entity.get("canonical", entity.get("canonical_name"))
            if canonical_name in self.pesticide_rules:
                for alias in as_list(entity.get("aliases")):
                    self.pesticide_aliases[str(alias)] = canonical_name

        self.device = device or (
            "cuda"
            if torch.cuda.is_available()
            else "mps"
            if torch.backends.mps.is_available()
            else "cpu"
        )
        self.embedding_model = embedding_model or SentenceTransformer(str(model_dir), device=self.device, local_files_only=True)
        self.normalize = model_info["query_normalize_embeddings"]
        self.instruction = model_info["instruction"]
        self.supports_prompt = bool(getattr(self.embedding_model, "prompts", None))

        if reranker_tokenizer is None:
            self.reranker_tokenizer = AutoTokenizer.from_pretrained(
                str(reranker_model_dir), local_files_only=True, padding_side="left"
            )
            self.reranker_tokenizer.pad_token = self.reranker_tokenizer.eos_token
            reranker_dtype = torch.float16 if self.device == "cuda" else torch.float32
            self.reranker_model = AutoModelForCausalLM.from_pretrained(
                str(reranker_model_dir), local_files_only=True, torch_dtype=reranker_dtype
            ).to(self.device).eval()
        else:
            self.reranker_tokenizer = reranker_tokenizer
            self.reranker_model = reranker_model
        self.reranker_prefix_tokens = self.reranker_tokenizer.encode(RERANKER_PREFIX, add_special_tokens=False)
        self.reranker_suffix_tokens = self.reranker_tokenizer.encode(RERANKER_SUFFIX, add_special_tokens=False)
        self.yes_token_id = self.reranker_tokenizer.convert_tokens_to_ids("yes")
        self.no_token_id = self.reranker_tokenizer.convert_tokens_to_ids("no")

        self.entity_terms = {
            ChineseSparseTokenizer.normalize(value)
            for chunk in self.rows
            for field in ENTITY_FIELDS
            for value in metadata_values(chunk, field)
        }
        domain_terms = {
            value
            for chunk in self.rows
            for field in (*ENTITY_FIELDS, "growth_stages", "technology_topics", "pesticide_entities", "fertilizer_entities", "varieties", "rice_types", "planting_systems")
            for value in metadata_values(chunk, field)
        }
        domain_terms.update(str(chunk["title"]) for chunk in self.rows if 2 <= len(str(chunk["title"])) <= 24)
        self.tokenizer = ChineseSparseTokenizer(domain_terms)
        self._build_bm25_index()

    def validate_pesticides(self, pesticide_names: list[str]) -> list[dict[str, object]]:
        validations = []
        for name in pesticide_names:
            standard_name = self.pesticide_aliases.get(name, name)
            rule = self.pesticide_rules.get(standard_name)
            validations.append(
                {
                    "input_name": name,
                    "standard_name": standard_name,
                    "safety_status": rule["ban_type"] if rule else "not_listed_in_banned_registry",
                    "rule": rule,
                }
            )
        return validations

    def search_web(self, query: str) -> dict[str, object]:
        request = Request(
            "https://api.tavily.com/search",
            data=json.dumps(
                {
                    "query": query,
                    "search_depth": "basic",
                    "max_results": 5,
                    "include_answer": False,
                    "include_raw_content": False,
                }
            ).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {os.environ['TAVILY_API_KEY']}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urlopen(request, timeout=30) as response:
            result = json.load(response)
        return {
            "results": [
                {
                    "title": item["title"],
                    "url": item["url"],
                    "content": item["content"],
                    "published_date": item.get("published_date"),
                }
                for item in result["results"]
            ]
        }

    def _build_bm25_index(self) -> None:
        self.document_lengths = np.zeros(len(self.rows), dtype=np.float32)
        self.inverted_index: dict[str, list[tuple[int, int]]] = defaultdict(list)
        document_frequency: Counter[str] = Counter()
        for row, chunk in enumerate(self.rows):
            frequencies = Counter(self.tokenizer.tokenize(f"{chunk['title']}\n{chunk['text']}"))
            self.document_lengths[row] = sum(frequencies.values())
            for term, frequency in frequencies.items():
                document_frequency[term] += 1
                self.inverted_index[term].append((row, frequency))
        self.average_document_length = float(np.mean(self.document_lengths))
        count = len(self.rows)
        self.idf = {
            term: math.log(1.0 + (count - frequency + 0.5) / (frequency + 0.5))
            for term, frequency in document_frequency.items()
        }

    def _embed_query(self, query: str) -> np.ndarray:
        if self.instruction and self.supports_prompt:
            vector = self.embedding_model.encode(
                [query], prompt_name="query", normalize_embeddings=self.normalize, batch_size=1, show_progress_bar=False
            )
        elif self.instruction:
            vector = self.embedding_model.encode(
                [f"Instruct: {self.instruction}\nQuery: {query}"],
                normalize_embeddings=self.normalize,
                batch_size=1,
                show_progress_bar=False,
            )
        else:
            vector = self.embedding_model.encode(
                [query], normalize_embeddings=self.normalize, batch_size=1, show_progress_bar=False
            )
        return np.asarray(vector, dtype=np.float32)[0]

    def _bm25_rows(self, query: str) -> list[int]:
        scores: dict[int, float] = defaultdict(float)
        for term, query_frequency in Counter(self.tokenizer.tokenize(query)).items():
            for row, term_frequency in self.inverted_index.get(term, []):
                length = float(self.document_lengths[row])
                denominator = term_frequency + 1.5 * (0.25 + 0.75 * length / self.average_document_length)
                scores[row] += self.idf[term] * (term_frequency * 2.5 / denominator) * query_frequency
        return [row for row, _ in sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:CANDIDATE_K]]

    def _rerank_scores(self, query: str, rows: list[int]) -> np.ndarray:
        pairs = [
            f"<Instruct>: {RERANKER_INSTRUCTION}\n<Query>: {query}\n<Document>: Title: {self.rows[row]['title']}\nDocument: {self.rows[row]['text']}"
            for row in rows
        ]
        content_limit = 512 - len(self.reranker_prefix_tokens) - len(self.reranker_suffix_tokens)
        scores: list[float] = []
        for start in range(0, len(pairs), 12):
            encoded = self.reranker_tokenizer(
                pairs[start : start + 12],
                padding=False,
                truncation="longest_first",
                return_attention_mask=False,
                max_length=content_limit,
            )
            input_ids = [self.reranker_prefix_tokens + ids + self.reranker_suffix_tokens for ids in encoded["input_ids"]]
            inputs = self.reranker_tokenizer.pad({"input_ids": input_ids}, padding=True, return_tensors="pt")
            inputs = {key: value.to(self.reranker_model.device) for key, value in inputs.items()}
            with torch.no_grad():
                logits = self.reranker_model(**inputs).logits[:, -1, :]
                binary_logits = torch.stack([logits[:, self.no_token_id], logits[:, self.yes_token_id]], dim=1)
                scores.extend(torch.nn.functional.softmax(binary_logits.float(), dim=1)[:, 1].cpu().tolist())
        return np.asarray(scores, dtype=np.float32)

    def _metadata_bonus(self, query: str, chunk: dict[str, object]) -> tuple[float, list[str]]:
        normalized_query = self.tokenizer.normalize(query)
        query_entities = {term for term in self.entity_terms if term in normalized_query}
        chunk_entities = {
            self.tokenizer.normalize(value)
            for field in ENTITY_FIELDS
            for value in metadata_values(chunk, field)
        }
        bonus = 0.0
        reasons: list[str] = []
        if query_entities.intersection(chunk_entities):
            bonus += 0.10
            reasons.append("entity_match")
        elif query_entities and chunk_entities:
            bonus -= 0.10
            reasons.append("entity_conflict")
        for field, weight, reason in (("growth_stages", 0.05, "growth_stage_match"), ("regions", 0.03, "region_match"), ("technology_topics", 0.05, "topic_match")):
            if any(self.tokenizer.normalize(value) in normalized_query for value in metadata_values(chunk, field)):
                bonus += weight
                reasons.append(reason)
        if str(chunk.get("source_tier") or "").upper() in {"S", "A", "B"}:
            bonus += 0.02
            reasons.append("high_source_tier")
        return bonus, reasons

    def search_diagnosis(self, observations: str) -> list[dict[str, object]]:
        preset_entities = sorted(entity for entity in self.entity_terms if entity in self.tokenizer.normalize(observations))
        if preset_entities:
            raise ValueError(f"Diagnosis observations must not contain pest names: {', '.join(preset_entities)}")
        return self.search(observations)

    def search(self, query: str) -> list[dict[str, object]]:
        dense_scores = self.vectors @ self._embed_query(query)
        dense_rows = np.argsort(dense_scores)[-CANDIDATE_K:][::-1].tolist()
        bm25_rows = self._bm25_rows(query)
        dense_ranks = {row: rank for rank, row in enumerate(dense_rows, start=1)}
        bm25_ranks = {row: rank for rank, row in enumerate(bm25_rows, start=1)}
        rrf_scores: dict[int, float] = defaultdict(float)
        for row, rank in dense_ranks.items():
            rrf_scores[row] += 1.0 / (RRF_K + rank)
        for row, rank in bm25_ranks.items():
            rrf_scores[row] += 1.0 / (RRF_K + rank)
        fused_rows = [row for row, _ in sorted(rrf_scores.items(), key=lambda item: (-item[1], self.chunk_ids[item[0]]))[:CANDIDATE_K]]
        reranker_scores = self._rerank_scores(query, fused_rows)
        reranker_by_row = dict(zip(fused_rows, reranker_scores, strict=True))
        reranked_rows = sorted(fused_rows, key=lambda row: (-reranker_by_row[row], self.chunk_ids[row]))[:FINAL_TOP_K]
        ranked = []
        for row in reranked_rows:
            metadata_bonus, metadata_reasons = self._metadata_bonus(query, self.rows[row])
            ranked.append((row, float(reranker_by_row[row] + metadata_bonus), metadata_bonus, metadata_reasons))
        ranked.sort(key=lambda item: (-item[1], self.chunk_ids[item[0]]))
        return [
            {
                "chunk_id": self.rows[row]["chunk_id"],
                "title": self.rows[row]["title"],
                "text": self.rows[row]["text"],
                "score": score,
                "source_org": self.rows[row].get("source_org"),
                "source_region": self.rows[row].get("source_region"),
                "source_url": self.rows[row].get("source_url"),
                "growth_stages": self.rows[row].get("growth_stages"),
                "technology_topics": self.rows[row].get("technology_topics"),
                "retrieval": {
                    "rrf_score": rrf_scores[row],
                    "dense_rank": dense_ranks.get(row),
                    "bm25_rank": bm25_ranks.get(row),
                    "reranker_score": float(reranker_by_row[row]),
                    "metadata_bonus": metadata_bonus,
                    "metadata_reasons": metadata_reasons,
                },
            }
            for row, score, metadata_bonus, metadata_reasons in ranked
        ]


class RiceRetrieverHandler(BaseHTTPRequestHandler):
    package: RiceKnowledgePackage
    packages: dict[str, RiceKnowledgePackage]
    varieties: RiceVarietyPackage
    export_dir: Path
    inference_lock = Lock()

    def do_GET(self) -> None:
        if self.path == "/ready":
            self.send_response(204)
            self.end_headers()
            return
        if not self.path.startswith("/exports/"):
            self.send_error(404)
            return
        export = self.export_dir / Path(self.path).name
        body = export.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{export.name}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path not in {"/search", "/search-diagnosis", "/lookup-variety", "/search-web", "/validate-pesticides"}:
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/search":
            with self.inference_lock:
                response = {"results": self.packages[request["domain"]].search(request["query"])}
        elif self.path == "/search-diagnosis":
            try:
                with self.inference_lock:
                    response = {"results": self.package.search_diagnosis(request["observations"])}
            except ValueError as error:
                body = json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8")
                self.send_response(422)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        elif self.path == "/lookup-variety":
            records = self.varieties.lookup(request["query"])
            page = request.get("page", 1)
            page_size = request.get("page_size", 8)
            start = (page - 1) * page_size
            response = {
                "found": bool(records),
                "query": request["query"],
                "total": len(records),
                "page": page,
                "page_size": page_size,
                "records": records[start : start + page_size],
                "download_url": f"/_lucarice/rice-variety-exports/{self.varieties.export(records, self.export_dir)}" if records else None,
            }
        elif self.path == "/search-web":
            response = self.package.search_web(request["query"])
        else:
            validations = self.package.validate_pesticides(request["pesticide_names"])
            response = {
                "can_recommend": not any(item["safety_status"] != "not_listed_in_banned_registry" for item in validations),
                "validations": validations,
            }
        body = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--domain", action="append", required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--reranker-model-dir", type=Path, required=True)
    parser.add_argument("--variety-data", type=Path, required=True)
    parser.add_argument("--export-dir", type=Path, required=True)
    parser.add_argument("--ready-file", type=Path, required=True)
    args = parser.parse_args()
    first_domain, first_package_dir = args.domain[0].split("=", 1)
    first_package = RiceKnowledgePackage(Path(first_package_dir), args.model_dir, args.reranker_model_dir)
    RiceRetrieverHandler.packages = {first_domain: first_package}
    for domain in args.domain[1:]:
        domain_name, package_dir = domain.split("=", 1)
        RiceRetrieverHandler.packages[domain_name] = RiceKnowledgePackage(
            Path(package_dir),
            args.model_dir,
            args.reranker_model_dir,
            first_package.embedding_model,
            first_package.reranker_tokenizer,
            first_package.reranker_model,
            first_package.device,
        )
    RiceRetrieverHandler.package = first_package
    RiceRetrieverHandler.varieties = RiceVarietyPackage(args.variety_data)
    RiceRetrieverHandler.export_dir = args.export_dir
    # The embedding and reranker are one shared CUDA model pair. Requests were
    # already serialized by inference_lock, so a threaded HTTP server brought
    # no real throughput gain and could move consecutive CUDA calls between
    # request threads. Keep inference on one stable server thread instead.
    server = HTTPServer(("127.0.0.1", 8765), RiceRetrieverHandler)
    args.ready_file.write_text("ready", encoding="utf-8")
    server.serve_forever()


if __name__ == "__main__":
    main()
