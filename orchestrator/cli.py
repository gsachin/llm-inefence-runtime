from __future__ import annotations

import argparse
import os
import subprocess
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILES_PATH = REPO_ROOT / "profiles.yaml"
DEFAULT_CHART_PATH = REPO_ROOT / "charts" / "llm-vllm"


def _load_profiles(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict) or "profiles" not in data or not isinstance(data["profiles"], dict):
        raise ValueError(f"Invalid profiles file shape: {path}")
    return data["profiles"]


def _generate_values(profile: dict[str, Any]) -> dict[str, Any]:
    resources = profile.get("resources") or {}
    env_vars = profile.get("env") or {}
    return {
        "model": profile.get("model", ""),
        "image": profile.get("image", ""),
        "gpuCount": int(profile.get("gpu_count", 0) or 0),
        "vllmFlags": profile.get("vllm_flags", "") or "",
        "runtime": {
            "commandStyle": profile.get("command_style", "serve") or "serve",
        },
        "resources": {
            "cpuRequest": resources.get("cpu_request", "") or "",
            "cpuLimit": resources.get("cpu_limit", "") or "",
            "memRequest": resources.get("mem_request", "") or "",
            "memLimit": resources.get("mem_limit", "") or "",
        },
        "probes": {
            "enabled": True,
            "livenessPath": profile.get("health_live", "/health"),
            "readinessPath": profile.get("health_ready", "/health"),
        },
        "env": [{"name": k, "value": str(v)} for k, v in env_vars.items()],
    }


def _run(cmd: list[str], *, env: dict[str, str]) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True, env=env)


def main() -> None:
    parser = argparse.ArgumentParser(description="Single-trigger deploy for llm-vllm via Helm")
    parser.add_argument("--profiles", default=str(DEFAULT_PROFILES_PATH), help="Path to profiles.yaml")
    parser.add_argument("--profile", required=True, help="Profile name under profiles: ...")
    parser.add_argument("--release", required=True, help="Helm release name (and InferenceService name)")
    parser.add_argument("--namespace", default="llm", help="Kubernetes namespace")
    parser.add_argument("--chart", default=str(DEFAULT_CHART_PATH), help="Path to Helm chart")
    parser.add_argument(
        "--values-out",
        default="",
        help="Write generated values yaml here (default: orchestrator/generated/<release>.yaml)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print commands, do not execute")

    args = parser.parse_args()

    profiles_path = Path(args.profiles)
    chart_path = Path(args.chart)

    profiles = _load_profiles(profiles_path)
    if args.profile not in profiles:
        known = ", ".join(sorted(profiles.keys()))
        raise SystemExit(f"Unknown profile '{args.profile}'. Known: {known}")

    values = _generate_values(profiles[args.profile])
    missing = [k for k in ("model", "image") if not values.get(k)]
    if missing:
        raise SystemExit(f"Profile '{args.profile}' missing required fields: {', '.join(missing)}")

    values_out = Path(args.values_out) if args.values_out else (Path(__file__).parent / "generated" / f"{args.release}.yaml")
    values_out.parent.mkdir(parents=True, exist_ok=True)
    values_out.write_text(yaml.safe_dump(values, sort_keys=False))
    print(f"Wrote generated values: {values_out}")

    env = os.environ.copy()

    base_cmd = [
        "helm",
        "upgrade",
        "--install",
        args.release,
        str(chart_path),
        "-n",
        args.namespace,
        "--create-namespace",
        "-f",
        str(values_out),
    ]

    if args.dry_run:
        base_cmd.extend(["--dry-run=client", "--debug"])

    print("Using KUBECONFIG:", env.get("KUBECONFIG", "(default)"))
    _run(base_cmd, env=env)


if __name__ == "__main__":
    main()
