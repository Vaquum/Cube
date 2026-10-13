#!/usr/bin/env python3
"""Run the repository's static CI checks with the same checked-in inputs."""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*argv):
    subprocess.run(argv, cwd=ROOT, check=True)


def main():
    files = subprocess.check_output(
        ["git", "ls-files", "--", "src/*.js", "tests/*.js", "tests/*.mjs", "tools/*.js", "tools/*.mjs"],
        cwd=ROOT, text=True,
    ).splitlines()
    for name in files:
        if not name.startswith(("tests/fixtures/", "tools/encoding-parts/")):
            run("node", "--check", name)
    run("python3", "-m", "py_compile", "tools/cube_bridge.py", "tools/market_state_reader.py",
        "tools/build.py", "tools/rally_bridge.py", "tools/investigation_store.py", "tools/check-static.py")
    run("docker", "compose", "config", "-q")


if __name__ == "__main__":
    main()
