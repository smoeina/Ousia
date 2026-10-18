"use server";

import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { integerEnv } from "@/lib/env-config";
import { replaceBibtexEntry } from "@/lib/bibtex";
import {
  appendLiteratureItem,
  findCitationEntry,
  hasCitationIdentity,
  hasCitationKey,
} from "@/lib/bibliography-store";
import { fileStem, identitySuffix } from "@/lib/literature/citation-identity";
import {
  PROJECT_BIBLIOGRAPHY_NAME,
  REFERENCES_DIRECTORY,
} from "@/lib/project-bibliography";
import {
  createSaveToken,
  literatureItemSchema,
  verifySaveToken,
} from "@/lib/literature/save-token";
import { lookupLiteratureMetrics, searchLiteratureProviders } from "@/lib/literature/search";
import { LITERATURE_SOURCES } from "@/lib/literature/types";
import {
  AgentWorkspaceError,
  createAgentWorkspaceDirectory,
  listAgentWorkspaceFiles,
  readAgentWorkspaceFile,
  readAgentWorkspaceTextOrNull,
  writeAgentWorkspaceFile,
} from "@/lib/workspace-files";
import { getOwnedProject } from "./actions";

const searchInputSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  query: z.string().trim().min(2).max(300),
  source: z.union([z.literal("all"), z.enum(LITERATURE_SOURCES)]),
  openAccessOnly: z.boolean(),
  page: z.number().int().min(1).max(50).default(1),
});

const saveInputSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  item: literatureItemSchema,
});

const literatureIdentitySchema = literatureItemSchema.pick({
  id: true,
  title: true,
  authors: true,
  year: true,
  doi: true,
  pmid: true,
});

const savedStateInputSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  items: z.array(literatureIdentitySchema).max(1_500),
});

const metricsInputSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  dois: z.array(z.string().trim().min(4).max(500)).min(1).max(10),
});


const LITERATURE_PDF_MAX_REDIRECTS = integerEnv("LITERATURE_PDF_MAX_REDIRECTS", 12, 0);
const LITERATURE_PDF_TIMEOUT_MS = integerEnv("LITERATURE_PDF_TIMEOUT_MS", 30_000, 1_000);
const LITERATURE_PER_SOURCE_RESULTS = integerEnv("LITERATURE_PER_SOURCE_RESULTS", 8, 1);
const DEFAULT_MAX_PDF_BYTES = 50_000_000;

async function requireOwnedProject(projectId: string) {
  const user = await requireUser();
  const project = await getOwnedProject(user, projectId);
  if (!project) throw new Error("Project not found.");
  return user;
}

export async function searchLiterature(input: unknown) {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("Enter a search query between 2 and 300 characters.");
  const { projectId, query, source, openAccessOnly, page } = parsed.data;
  await requireOwnedProject(projectId);
  const result = await searchLiteratureProviders({
    query,
    source,
    openAccessOnly,
    perSource: LITERATURE_PER_SOURCE_RESULTS,
    page,
  });
  return {
    providers: result.providers,
    page: result.page,
    hasMore: result.hasMore,
    items: result.items.map((item) => ({
      ...item,
      saveToken: createSaveToken(projectId, item),
    })),
  };
}

// Live citation count / open-access status for citations already in
// references.bib, looked up by DOI (e.g. for the citation details popover).
export async function fetchLiteratureMetrics(input: unknown) {
  const parsed = metricsInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("The literature metrics request is invalid.");
  const { projectId, dois } = parsed.data;
  await requireOwnedProject(projectId);
  return lookupLiteratureMetrics(dois);
}

export async function getLiteratureSavedState(input: unknown) {
  const parsed = savedStateInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("The literature results are invalid.");
  const { projectId, items } = parsed.data;
  const user = await requireOwnedProject(projectId);

  let existing;
  try {
    existing = await listAgentWorkspaceFiles(user.id, projectId, REFERENCES_DIRECTORY);
  } catch (error) {
    if (error instanceof AgentWorkspaceError && error.status === 404) {
      return { citationIds: [] as string[], pdfPaths: {} as Record<string, string> };
    }
    throw error;
  }

  const names = new Set(existing.map((entry) => entry.name));
  const bibliographyPath = path.posix.join(REFERENCES_DIRECTORY, PROJECT_BIBLIOGRAPHY_NAME);
  const bibliography = names.has(PROJECT_BIBLIOGRAPHY_NAME)
    ? await (await readAgentWorkspaceFile(user.id, projectId, bibliographyPath)).text()
    : "";
  const citationIds: string[] = [];
  const pdfPaths: Record<string, string> = {};
  for (const item of items) {
    const stem = fileStem(item);
    const suffix = identitySuffix(item);
    const legacyCitation = existing.find((entry) => entry.name.endsWith(`-${suffix}.bib`));
    if (hasCitationKey(bibliography, stem) || hasCitationIdentity(bibliography, suffix) || legacyCitation) {
      citationIds.push(item.id);
    }
    const pdf = existing.find((entry) => entry.name.endsWith(`-${suffix}.pdf`));
    if (pdf) pdfPaths[item.id] = path.posix.join(REFERENCES_DIRECTORY, pdf.name);
  }
  return { citationIds, pdfPaths };
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224;
}

function isPrivateIp(address: string) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLocaleLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
}

async function assertPublicPdfUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("The open-access download URL is not a safe HTTPS address.");
  }
  const hostname = url.hostname.toLocaleLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("The open-access download URL points to a local address.");
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("The open-access download URL points to a private address.");
  }
  return url;
}

async function fetchMetadata(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Ousia/0.1 (literature-search)" },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value = await response.json();
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function pdfUrlFromLocation(value: unknown, key: "pdf_url" | "url_for_pdf") {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function zenodoRecordId(doi: string | undefined, pageUrl: string | undefined) {
  const fromDoi = doi?.match(/^10\.5281\/zenodo\.(\d+)$/i);
  if (fromDoi) return fromDoi[1];
  const fromUrl = pageUrl?.match(/zenodo\.org\/(?:records|record)\/(\d+)/i) ?? pageUrl?.match(/zenodo\.org\/doi\/10\.5281\/zenodo\.(\d+)/i);
  return fromUrl?.[1];
}

// Resolves a direct PDF via OpenAlex and Unpaywall, which know the real
// open-access file even when a provider only exposes the landing page. Falls
// back to an OpenAlex title lookup when the item has no DOI, and to the Zenodo
// records API for repository items.
async function resolveOpenAccessPdfUrls(doi: string | undefined, title: string, pageUrl?: string): Promise<string[]> {
  const email = process.env.CROSSREF_MAILTO?.trim();
  const urls = new Set<string>();
  const collect = (work: Record<string, unknown>) => {
    const locations = [work.best_oa_location, work.primary_location, ...(Array.isArray(work.locations) ? work.locations : [])];
    for (const location of locations) {
      const pdf = pdfUrlFromLocation(location, "pdf_url");
      if (pdf) urls.add(pdf);
    }
  };
  const zenodoId = zenodoRecordId(doi, pageUrl);
  if (zenodoId) {
    try {
      const record = await fetchMetadata(`https://zenodo.org/api/records/${zenodoId}`);
      if (Array.isArray(record.files)) {
        for (const file of record.files) {
          if (!file || typeof file !== "object") continue;
          const entry = file as Record<string, unknown>;
          const key = typeof entry.key === "string" ? entry.key : "";
          if (!/\.pdf$/i.test(key)) continue;
          const links = entry.links && typeof entry.links === "object" ? entry.links as Record<string, unknown> : undefined;
          const download = (typeof links?.content === "string" && links.content)
            || (typeof links?.self === "string" && links.self)
            || (typeof entry.download === "string" && entry.download);
          if (typeof download === "string" && download) urls.add(download);
        }
      }
    } catch { /* resolution is best-effort */ }
  }
  if (doi) {
    const encoded = encodeURIComponent(doi);
    try {
      collect(await fetchMetadata(`https://api.openalex.org/works/https://doi.org/${encoded}${email ? `?mailto=${encodeURIComponent(email)}` : ""}`));
    } catch { /* resolution is best-effort */ }
    if (email) {
      try {
        const unpaywall = await fetchMetadata(`https://api.unpaywall.org/v2/${encoded}?email=${encodeURIComponent(email)}`);
        const best = pdfUrlFromLocation(unpaywall.best_oa_location, "url_for_pdf");
        if (best) urls.add(best);
        if (Array.isArray(unpaywall.oa_locations)) {
          for (const location of unpaywall.oa_locations) {
            const pdf = pdfUrlFromLocation(location, "url_for_pdf");
            if (pdf) urls.add(pdf);
          }
        }
      } catch { /* resolution is best-effort */ }
    }
  } else if (title) {
    try {
      const search = await fetchMetadata(`https://api.openalex.org/works?search=${encodeURIComponent(title.slice(0, 300))}&per-page=3${email ? `&mailto=${encodeURIComponent(email)}` : ""}`);
      const results = Array.isArray(search.results) ? search.results : [];
      for (const work of results.slice(0, 3)) if (work && typeof work === "object") collect(work as Record<string, unknown>);
    } catch { /* resolution is best-effort */ }
  }
  return [...urls];
}

async function downloadPdf(value: string) {
  const configuredLimit = Number(process.env.MAX_LITERATURE_PDF_BYTES || DEFAULT_MAX_PDF_BYTES);
  const maximumBytes = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? configuredLimit
    : DEFAULT_MAX_PDF_BYTES;
  let url = await assertPublicPdfUrl(value);
  for (let redirects = 0; redirects <= LITERATURE_PDF_MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, {
      headers: {
        accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        referer: `${url.origin}/`,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(LITERATURE_PDF_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === LITERATURE_PDF_MAX_REDIRECTS) throw new Error("The paper download redirected too many times.");
      url = await assertPublicPdfUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
        throw new Error("The paper host requires an interactive browser challenge.");
      }
      throw new Error(`The paper host returned HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
      throw new Error("The paper exceeds the configured PDF size limit.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maximumBytes) throw new Error("The paper exceeds the configured PDF size limit.");
    const pdfHeaderOffset = buffer.subarray(0, 1_024).indexOf("%PDF-");
    if (pdfHeaderOffset < 0) {
      // Publisher landing pages advertise the real file in a citation_pdf_url
      // meta tag or a .pdf link; follow the first safe one instead of failing.
      const html = buffer.toString("utf8", 0, Math.min(buffer.byteLength, 500_000));
      const candidates: string[] = [];
      const meta = html.match(/<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i);
      if (meta) candidates.push(meta[1]);
      for (const match of html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) candidates.push(match[1]);
      let followed = false;
      if (redirects < LITERATURE_PDF_MAX_REDIRECTS) {
        for (const candidate of candidates.slice(0, 10)) {
          try {
            url = await assertPublicPdfUrl(new URL(candidate, url.toString()).toString());
            followed = true;
            break;
          } catch { /* try the next link */ }
        }
      }
      if (followed) continue;
      throw new Error("The open-access link did not return a PDF file.");
    }
    return buffer;
  }
  throw new Error("The paper could not be downloaded.");
}

export async function saveLiteratureCitation(input: unknown) {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: "The literature item is invalid." };
  const { projectId, item } = parsed.data;
  const user = await requireOwnedProject(projectId);
  if (!verifySaveToken(projectId, item)) {
    return { success: false as const, error: "This search result expired. Run the search again before saving." };
  }

  try {
    const citationPath = path.posix.join(REFERENCES_DIRECTORY, PROJECT_BIBLIOGRAPHY_NAME);
    // A 404 on the read answers existence; the directory listing and the
    // unconditional directory placeholder it replaced said nothing the bib
    // content doesn't.
    const existingBibliography = await readAgentWorkspaceTextOrNull(user.id, projectId, citationPath);
    const currentBibliography = existingBibliography ?? "";
    const result = appendLiteratureItem(currentBibliography, item);
    if (!result.alreadyExisted) {
      if (existingBibliography === null) {
        await createAgentWorkspaceDirectory(user.id, projectId, REFERENCES_DIRECTORY);
      }
      await writeAgentWorkspaceFile(user.id, projectId, citationPath, result.content);
    }
    revalidatePath(`/${projectId}`);
    return {
      success: true as const,
      citationPath,
      citationKey: result.citationKey,
      alreadyExisted: result.alreadyExisted,
      bibliographyContent: result.content,
    };
  } catch (error) {
    console.error("[literature-citation-save] failed", error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "The citation could not be saved.",
    };
  }
}

export async function saveLiteraturePdf(input: unknown) {
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: "The literature item is invalid." };
  const { projectId, item } = parsed.data;
  const user = await requireOwnedProject(projectId);
  if (!verifySaveToken(projectId, item)) {
    return { success: false as const, error: "This search result expired. Run the search again before saving." };
  }
  // Order candidates: direct PDF links, then URLs resolved through OpenAlex /
  // Unpaywall, then the open-access landing page (whose citation_pdf_url meta
  // tag the downloader may follow).
  const resolvedPdfUrls = await resolveOpenAccessPdfUrls(item.doi, item.title, item.url).catch(() => []);
  const doiUrl = item.doi ? `https://doi.org/${encodeURIComponent(item.doi)}` : undefined;
  const pdfUrls = [...new Set([
    ...(item.pdfUrls || []),
    ...(item.pdfUrl ? [item.pdfUrl] : []),
    ...resolvedPdfUrls,
    ...(doiUrl ? [doiUrl] : []),
    ...(item.openAccessUrl ? [item.openAccessUrl] : []),
    ...(item.url ? [item.url] : []),
  ])];
  if (pdfUrls.length === 0) {
    return { success: false as const, error: "This result does not include an open-access PDF." };
  }

  try {
    await createAgentWorkspaceDirectory(user.id, projectId, REFERENCES_DIRECTORY);
    const existing = await listAgentWorkspaceFiles(user.id, projectId, REFERENCES_DIRECTORY);
    const stem = fileStem(item);
    const pdfName = `${stem}.pdf`;
    const existingPdf = existing.find((entry) => entry.name.endsWith(`-${identitySuffix(item)}.pdf`));
    const pdfPath = path.posix.join(REFERENCES_DIRECTORY, existingPdf?.name || pdfName);
    const alreadyExisted = Boolean(existingPdf);
    if (!alreadyExisted) {
      let downloadedPdf: Buffer | undefined;
      let lastError: unknown;
      for (const pdfUrl of pdfUrls) {
        try {
          downloadedPdf = await downloadPdf(pdfUrl);
          break;
        } catch (error) {
          lastError = error;
          console.warn(
            "[literature-pdf-save] candidate failed",
            new URL(pdfUrl).hostname,
            error instanceof Error ? error.message : error,
          );
        }
      }
      if (!downloadedPdf) {
        throw new Error(
          "No direct PDF could be downloaded for this open-access article. The publisher may block automated downloads; open the article page from the result instead." +
          (lastError instanceof Error ? ` (${lastError.message})` : ""),
        );
      }
      await writeAgentWorkspaceFile(user.id, projectId, pdfPath, Uint8Array.from(downloadedPdf));
    }

    // Saving the PDF also keeps references.bib in sync: the citation entry is
    // appended when missing, and its Linked File field always points at the
    // stored PDF — including entries saved earlier without a PDF.
    const citationPath = path.posix.join(REFERENCES_DIRECTORY, PROJECT_BIBLIOGRAPHY_NAME);
    const currentBibliography = existing.some((entry) => entry.name === PROJECT_BIBLIOGRAPHY_NAME)
      ? await (await readAgentWorkspaceFile(user.id, projectId, citationPath)).text()
      : "";
    const fileField = `${pdfPath}:PDF`;
    const citationEntry = findCitationEntry(currentBibliography, item);
    let citationAdded = false;
    let citationLinked = false;
    let bibliographyContent = currentBibliography;
    if (!citationEntry) {
      const result = appendLiteratureItem(currentBibliography, item, fileField);
      bibliographyContent = result.content;
      if (!result.alreadyExisted) {
        await writeAgentWorkspaceFile(
          user.id,
          projectId,
          citationPath,
          bibliographyContent,
        );
        citationAdded = true;
      }
    } else if (citationEntry.fields.file?.trim() !== fileField) {
      bibliographyContent = replaceBibtexEntry(currentBibliography, citationEntry, {
        type: citationEntry.type,
        key: citationEntry.key,
        fields: { ...citationEntry.fields, file: fileField },
      });
      await writeAgentWorkspaceFile(
        user.id,
        projectId,
        citationPath,
        bibliographyContent,
      );
      citationLinked = true;
    }
    revalidatePath(`/${projectId}`);
    return {
      success: true as const,
      pdfPath,
      alreadyExisted,
      citationKey: citationEntry?.key || stem,
      citationAdded,
      citationLinked,
      bibliographyContent,
    };
  } catch (error) {
    console.error("[literature-pdf-save] failed", error);
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "The PDF could not be saved.",
    };
  }
}
