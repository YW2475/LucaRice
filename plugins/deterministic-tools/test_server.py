import json
import tempfile
import unittest
from pathlib import Path

from server import compute, date_math, export_table


class DeterministicToolsTest(unittest.TestCase):
    def test_hectare_to_mu(self):
        self.assertEqual(compute({"operation": "convert", "value": 1, "from_unit": "ha", "to_unit": "亩"})["result"], 15)

    def test_rate_conversion(self):
        self.assertEqual(compute({"operation": "convert", "value": 10, "from_unit": "kg/亩", "to_unit": "kg/ha"})["result"], 150)

    def test_mean_and_zero_division(self):
        self.assertEqual(compute({"operation": "mean", "values": [10, 20, 30]})["result"], 20)
        with self.assertRaisesRegex(ValueError, "divide by zero"):
            compute({"operation": "divide", "values": [1, 0]})

    def test_date_math(self):
        self.assertEqual(date_math({"operation": "add_days", "date": "2026-08-20", "days": 5})["result"], "2026-08-25")
        self.assertEqual(date_math({"operation": "difference", "start": "2026-08-12", "end": "2026-08-20"})["result"], 8)

    def test_table_pattern_searches_all_record_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            user_id = "test-user"
            source = root / "varieties.json"
            source.write_text(json.dumps([{
                "name": "广两优9号",
                "fields": {"品质产量": "两年区域试验平均亩产657.48公斤"},
            }], ensure_ascii=False), encoding="utf-8")
            result = export_table({
                "source": "rice_variety",
                "query": "广两优9号",
                "columns": [{
                    "header": "平均产量",
                    "field": "产量表现",
                    "pattern": r"(?:两年(?:区域)?试验|两年区试|两年)平均亩产\s*([0-9.]+)\s*(?:公斤|千克)",
                }],
            }, source, root, user_id)
            csv_text = (root / "users" / user_id / "exports" / Path(result["download_url"]).name).read_text(encoding="utf-8-sig")
            self.assertIn("657.48", csv_text)

    def test_table_can_export_all_matching_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            user_id = "test-user"
            source = root / "varieties.json"
            source.write_text(json.dumps([{
                "name": "示例品种",
                "fields": {"品质产量": "2014年平均亩产658.39公斤；两年区域试验平均亩产657.48公斤"},
            }], ensure_ascii=False), encoding="utf-8")
            result = export_table({
                "source": "rice_variety",
                "query": "示例品种",
                "columns": [{
                    "header": "全部平均产量",
                    "field": "record_text",
                    "pattern": r"平均亩产([0-9.]+)公斤",
                    "match_mode": "all",
                }],
            }, source, root, user_id)
            csv_text = (root / "users" / user_id / "exports" / Path(result["download_url"]).name).read_text(encoding="utf-8-sig")
            self.assertIn("658.39；657.48", csv_text)

    def test_table_accepts_evidence_backed_model_fill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            user_id = "test-user"
            source = root / "varieties.json"
            source.write_text(json.dumps([{
                "name": "广两优9号",
                "fields": {"品质产量": "两年区域试验平均亩产657.48公斤，比对照增产1.50%。"},
            }], ensure_ascii=False), encoding="utf-8")
            columns = [{"header": "平均产量", "field": "不存在的字段", "instruction": "两年区域试验平均亩产"}]
            prepared = export_table({"source": "rice_variety", "query": "广两优9号", "columns": columns, "mode": "prepare"}, source, root, user_id)
            self.assertEqual(len(prepared["pending"]), 1)
            result = export_table({
                "source": "rice_variety", "query": "广两优9号", "columns": columns,
                "mode": "finalize",
                "fills": [{"row": 0, "header": "平均产量", "value": "657.48公斤", "evidence": "平均亩产657.48公斤"}],
            }, source, root, user_id)
            csv_text = (root / "users" / user_id / "exports" / Path(result["download_url"]).name).read_text(encoding="utf-8-sig")
            self.assertIn("657.48公斤", csv_text)

if __name__ == "__main__":
    unittest.main()
