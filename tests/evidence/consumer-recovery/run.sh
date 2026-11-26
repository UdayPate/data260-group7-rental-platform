#!/usr/bin/env bash
# Evidence script. See tests/evidence/README.md for what it needs, what it prints and what "pass" means.
# Use the same Python as the services:   PYTHON=.venv/bin/python tests/evidence/consumer-recovery/run.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
exec "${PYTHON:-python3}" "tests/evidence/consumer-recovery/run.py" "$@"
