#!/usr/bin/env bash
# Installs PyMuPDF (fitz) into an isolated venv for PDF-to-text extraction.
# Prefers `uv`, falls back to venv+pip.
set -euo pipefail
cd "$(dirname "$0")/../.."

VENV=".ousia/pdf-venv"

if command -v uv >/dev/null 2>&1; then
  uv venv "$VENV" --python 3.12 || uv venv "$VENV"
  uv pip install --python "$VENV/bin/python" pymupdf
else
  "${PYTHON:-python3}" -m venv "$VENV"
  "$VENV/bin/python" -m pip install --upgrade pip
  "$VENV/bin/python" -m pip install pymupdf
fi

echo
echo "PyMuPDF ready at $VENV"
