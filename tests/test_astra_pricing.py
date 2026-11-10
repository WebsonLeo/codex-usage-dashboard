"""GPT-6 Astra 价格估算的回归测试。"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "codex_usage_dashboard.py"
SPEC = importlib.util.spec_from_file_location("codex_usage_dashboard", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
dashboard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dashboard)

LAUNCHER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "open_dashboard.py"
LAUNCHER_SPEC = importlib.util.spec_from_file_location("open_dashboard", LAUNCHER_PATH)
assert LAUNCHER_SPEC is not None and LAUNCHER_SPEC.loader is not None
launcher = importlib.util.module_from_spec(LAUNCHER_SPEC)
LAUNCHER_SPEC.loader.exec_module(launcher)


class AstraPricingTests(unittest.TestCase):
    def test_standard_astra_request_uses_published_rates(self) -> None:
        usage = {
            "input_tokens": 200_000,
            "cached_input_tokens": 20_000,
            "cache_write_tokens": 20_000,
            "output_tokens": 100_000,
        }

        cost = dashboard.estimate_cost_usd(usage, "gpt-6-astra", "2026-09-04T00:00:00Z")

        # 160K * $10 + 20K * $1 + 20K * $12.5 + 100K * $50 = $6.87.
        self.assertEqual(cost, 6.87)

    def test_long_context_astra_request_uses_higher_rates(self) -> None:
        usage = {
            "input_tokens": 300_000,
            "cached_input_tokens": 30_000,
            "cache_write_tokens": 30_000,
            "output_tokens": 100_000,
        }

        cost = dashboard.estimate_cost_usd(usage, "openai/gpt-6-astra", "2026-09-04T00:00:00Z")

        # 240K * $20 + 30K * $2 + 30K * $25 + 100K * $75 = $13.11.
        self.assertEqual(cost, 13.11)

    def test_standard_gpt_6_1_sol_request_uses_published_rates(self) -> None:
        usage = {
            "input_tokens": 200_000,
            "cached_input_tokens": 20_000,
            "cache_write_tokens": 20_000,
            "output_tokens": 100_000,
        }

        cost = dashboard.estimate_cost_usd(usage, "gpt-6.1-sol", "2026-09-29T00:00:00Z")

        # 160K * $2 + 20K * $0.1 + 20K * $2.5 + 100K * $10 = $1.372.
        self.assertEqual(cost, 1.372)

    def test_long_context_gpt_6_1_sol_request_uses_higher_rates(self) -> None:
        usage = {
            "input_tokens": 300_000,
            "cached_input_tokens": 30_000,
            "cache_write_tokens": 30_000,
            "output_tokens": 100_000,
        }

        cost = dashboard.estimate_cost_usd(usage, "gpt-6.1-sol", "2026-09-29T00:00:00Z")

        # 240K * $4 + 30K * $0.2 + 30K * $5 + 100K * $15 = $2.616.
        self.assertEqual(cost, 2.616)

    def test_standard_gpt_6_sol_request_uses_published_rates(self) -> None:
        usage = {
            "input_tokens": 200_000,
            "cached_input_tokens": 20_000,
            "cache_write_tokens": 20_000,
            "output_tokens": 100_000,
        }

        cost = dashboard.estimate_cost_usd(usage, "gpt-6-sol", "2026-09-22T00:00:00Z")

        # 160K * $2 + 20K * $0.2 + 20K * $2.5 + 100K * $10 = $1.374.
        self.assertEqual(cost, 1.374)

    def test_standard_gpt_6_luna_request_uses_published_rates(self) -> None:
        usage = {"input_tokens": 100_000, "output_tokens": 100_000}

        cost = dashboard.estimate_cost_usd(usage, "gpt-6-luna", "2026-09-22T00:00:00Z")

        # 100K * $0.1 + 100K * $0.5 = $0.06.
        self.assertEqual(cost, 0.06)

    def test_standard_gpt_6_1_terra_request_uses_published_rates(self) -> None:
        usage = {"input_tokens": 100_000, "output_tokens": 100_000}

        cost = dashboard.estimate_cost_usd(usage, "gpt-6.1-terra", "2026-10-26T00:00:00Z")

        # 100K * $1 + 100K * $5 = $0.60.
        self.assertEqual(cost, 0.6)


class LauncherTests(unittest.TestCase):
    def test_select_python_interpreter_skips_unsupported_default(self) -> None:
        versions = {
            "/usr/bin/python3": (3, 9),
            "/opt/local/bin/python3.11": (3, 11),
        }

        selected = launcher.select_python_interpreter(
            candidates=list(versions),
            version_for=lambda executable: versions.get(executable),
        )

        self.assertEqual(selected, "/opt/local/bin/python3.11")


if __name__ == "__main__":
    unittest.main()
