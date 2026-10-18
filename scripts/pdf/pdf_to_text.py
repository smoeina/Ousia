#!/usr/bin/env python3
"""Extracts text from a PDF with PyMuPDF and writes it as UTF-8.

Handles right-to-left (Persian/Arabic) text: the default text extraction keeps
the correct reading order, and the lam-alef ligature (a zero-width ALEF drawn
before the LAM glyph) is reordered to the logical LAM + ALEF.

Usage:
    python pdf_to_text.py --input <file.pdf> --out <file.txt>
"""
import argparse
import sys

LAM = "\u0644"
ALEF = "\u0627"


def fix_line(chars):
    out = []
    index = 0
    count = len(chars)
    while index < count:
        char = chars[index]
        width = char["bbox"][2] - char["bbox"][0]
        if char["c"] == ALEF and width < 0.5 and index + 1 < count and chars[index + 1]["c"] == LAM:
            out.append(LAM)
            out.append(ALEF)
            index += 2
            continue
        out.append(char["c"])
        index += 1
    return "".join(out)


def page_text(page):
    data = page.get_text("rawdict")
    blocks = []
    for block in data["blocks"]:
        if block.get("type", 0) != 0:
            continue
        lines = []
        for line in block.get("lines", []):
            chars = [char for span in line.get("spans", []) for char in span.get("chars", [])]
            if chars:
                lines.append(fix_line(chars))
        if lines:
            blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    try:
        try:
            import pymupdf as fitz
        except ImportError:
            import fitz

        doc = fitz.open(args.input)
        try:
            text = "\n\n".join(page_text(page) for page in doc)
        finally:
            doc.close()
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)
    except Exception as exc:  # noqa: BLE001 - surface a concise error to the caller
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
