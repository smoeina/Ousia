#!/usr/bin/env bash
# Installs the findpapers literature-search engine into an isolated venv.
# findpapers needs Python 3.11 (distutils); prefers `uv`, falls back to venv+pip.
set -euo pipefail
cd "$(dirname "$0")/../.."

VENV=".ousia/findpapers-venv"
PACKAGE="git+https://github.com/jonatasgrosman/findpapers.git"

if command -v uv >/dev/null 2>&1; then
  uv venv "$VENV" --python 3.11 || uv venv "$VENV"
  uv pip install --python "$VENV/bin/python" "$PACKAGE"
else
  "${PYTHON:-python3.11}" -m venv "$VENV" || "${PYTHON:-python3}" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install "$PACKAGE"
fi

echo
echo "findpapers ready at $VENV"
echo "Optional: set OPENALEX_API_KEY, NCBI_API_KEY, SEMANTIC_SCHOLAR_API_KEY,"
echo "IEEE_API_KEY, SCOPUS_API_KEY, WOS_API_KEY, CROSSREF_MAILTO in .env.local"
echo "to unlock more databases and higher rate limits."
