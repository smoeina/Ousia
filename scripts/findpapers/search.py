#!/usr/bin/env python3
"""Ousia literature-search bridge: runs findpapers and writes JSON results.

Usage:
    python search.py --payload <input.json> --out <output.json>

Input JSON: {query, databases, since, until, limit, openAccessOnly, email, apiKeys}
Output JSON: {papers: [...]} on success, or {error: "..."} on failure.
"""
import argparse
import datetime as dt
import json
import os


def parse_date(value):
    if not value:
        return None
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    with open(args.payload, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    try:
        import findpapers

        keys = payload.get("apiKeys") or {}
        engine = findpapers.Engine(
            ieee_api_key=keys.get("ieee") or os.environ.get("IEEE_API_KEY"),
            scopus_api_key=keys.get("scopus") or os.environ.get("SCOPUS_API_KEY"),
            pubmed_api_key=keys.get("pubmed") or os.environ.get("NCBI_API_KEY"),
            openalex_api_key=keys.get("openalex") or os.environ.get("OPENALEX_API_KEY"),
            semantic_scholar_api_key=keys.get("semantic_scholar") or os.environ.get("SEMANTIC_SCHOLAR_API_KEY"),
            wos_api_key=keys.get("wos") or os.environ.get("WOS_API_KEY"),
            email=payload.get("email") or os.environ.get("CROSSREF_MAILTO"),
        )
        result = engine.search(
            payload["query"],
            databases=payload.get("databases"),
            max_papers_per_database=payload.get("limit"),
            since=parse_date(payload.get("since")),
            until=parse_date(payload.get("until")),
            show_progress=False,
            verbose=False,
            enrichment_databases=payload.get("enrichment") or [],
        )
        data = result.to_dict()
        papers = data.get("papers") or []
        if payload.get("openAccessOnly"):
            papers = [paper for paper in papers if paper.get("is_open_access")]
        output = {"papers": papers, "metadata": data.get("metadata")}
    except Exception as exc:  # noqa: BLE001 - surface any failure to the caller
        output = {"error": f"{type(exc).__name__}: {exc}"}

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(output, handle)


if __name__ == "__main__":
    main()
