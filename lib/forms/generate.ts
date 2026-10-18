import { matrixFieldKeys, otherFieldKey } from "./columns.ts";
import { FORM_RUNTIME_CSS, FORM_RUNTIME_JS, withFormTheme } from "./runtime.ts";
import {
  FORM_DEFINITION_SCRIPT_ID,
  FORM_MARKER_CONTENT,
  HONEYPOT_KEY,
  OTHER_VALUE,
  type FormBlock,
  type FormDefinition,
  type QuestionBlock,
} from "./schema.ts";

/**
 * Renders a form definition as one self-contained HTML document: app-styled
 * markup, the canonical definition embedded as JSON (for the builder's
 * round-trip), and the vanilla-JS runtime. This is the ONLY renderer — the
 * visual builder, the create_form agent tool, and parseFormHtml all agree
 * because they all go through here.
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

// Lucide chevron paths, inlined so the runtime stays a single self-contained
// document with no external assets.
const CHEVRON_LEFT_SVG =
  '<svg class="bf-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const CHEVRON_RIGHT_SVG =
  '<svg class="bf-chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

// The Ousia mark (public/ousia-mark.png), inlined as a data URI for the same
// self-containment reason. The nav brand links back to the app root.
const BRAND_MARK_SVG =
  '<img src="data:image/png;base64,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" width="22" height="22" alt="" />';

function attributes(attributes: Record<string, string | number | undefined>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`)
    .join("");
}

function questionShell(block: QuestionBlock, inner: string): string {
  // The label is a div (not <legend>): legends render inside the fieldset's
  // border area in every engine, which puts the question text on the card
  // outline. aria-labelledby keeps the fieldset's accessible group name.
  const labelId = `${block.id}-label`;
  return (
    `<fieldset class="bf-block"${attributes({ "data-block": block.id, "data-type": block.type, "data-required": block.required ? "true" : undefined, "aria-labelledby": labelId })}>` +
    `<div class="bf-label" id="${escapeHtml(labelId)}">${escapeHtml(block.label)}${block.required ? '<span class="bf-req" aria-hidden="true">*</span>' : ""}</div>` +
    (block.help ? `<p class="bf-help">${escapeHtml(block.help)}</p>` : "") +
    `<div class="bf-controls">${inner}</div>` +
    `<p class="bf-error">This question is required.</p>` +
    `</fieldset>`
  );
}

function choiceInput(
  blockId: string,
  type: "radio" | "checkbox",
  value: string,
  label: string,
): string {
  return (
    `<label class="bf-choice"><input${attributes({ type, name: blockId, value })}>` +
    `<span>${escapeHtml(label)}</span></label>`
  );
}

function otherTextWrap(blockId: string): string {
  return (
    `<div class="bf-other-text" data-other-for="${escapeHtml(blockId)}">` +
    `<input${attributes({ type: "text", name: otherFieldKey(blockId), placeholder: "Other (please specify)", autocomplete: "off" })}>` +
    `</div>`
  );
}

function renderQuestion(block: FormBlock): string {
  switch (block.type) {
    case "shortText":
      return questionShell(
        block,
        `<input${attributes({ type: "text", name: block.id, placeholder: block.placeholder, autocomplete: "off" })}>`,
      );
    case "longText":
      return questionShell(
        block,
        `<textarea${attributes({ name: block.id, placeholder: block.placeholder })}></textarea>`,
      );
    case "email":
      return questionShell(
        block,
        `<input${attributes({ type: "email", name: block.id, autocomplete: "email" })}>`,
      );
    case "number":
      return questionShell(
        block,
        `<input${attributes({ type: "number", name: block.id, min: block.min, max: block.max })}>`,
      );
    case "date":
      return questionShell(block, `<input${attributes({ type: "date", name: block.id })}>`);
    case "multipleChoice": {
      const inputs = block.options
        .map((option) => choiceInput(block.id, "radio", option, option))
        .join("");
      const other = block.otherOption
        ? choiceInput(block.id, "radio", OTHER_VALUE, "Other:") + otherTextWrap(block.id)
        : "";
      return questionShell(block, inputs + other);
    }
    case "checkboxes": {
      const inputs = block.options
        .map((option) => choiceInput(block.id, "checkbox", option, option))
        .join("");
      const other = block.otherOption
        ? choiceInput(block.id, "checkbox", OTHER_VALUE, "Other:") + otherTextWrap(block.id)
        : "";
      return questionShell(block, inputs + other);
    }
    case "dropdown": {
      const options = block.options
        .map((option) => `<option${attributes({ value: option })}>${escapeHtml(option)}</option>`)
        .join("");
      return questionShell(
        block,
        `<select${attributes({ name: block.id })}><option value="" disabled selected>Select an option</option>${options}</select>`,
      );
    }
    case "linearScale": {
      const pills: string[] = [];
      for (let value = block.scale.from; value <= block.scale.to; value++) {
        pills.push(
          `<span class="bf-pill"><input${attributes({ type: "radio", name: block.id, value })}><span>${value}</span></span>`,
        );
      }
      // Labels sit in a caption row under the pills, pinned to the ends, so a
      // long label can never wrap the scale or swap the right label to the
      // left (the pills row itself never wraps).
      const captions =
        block.scale.fromLabel || block.scale.toLabel
          ? `<div class="bf-scale-captions"><span>${escapeHtml(block.scale.fromLabel ?? "")}</span><span>${escapeHtml(block.scale.toLabel ?? "")}</span></div>`
          : "";
      return questionShell(
        block,
        `<div class="bf-scale"><div class="bf-scale-pills">${pills.join("")}</div>${captions}</div>`,
      );
    }
    case "rating": {
      const stars: string[] = [];
      for (let value = 1; value <= (block.maxStars ?? 5); value++) {
        stars.push(
          `<span class="bf-star"><input${attributes({ type: "radio", name: block.id, value })}><span aria-hidden="true">★</span></span>`,
        );
      }
      return questionShell(block, `<div class="bf-stars">${stars.join("")}</div>`);
    }
    case "matrix": {
      const keys = matrixFieldKeys(block);
      const head = block.columns
        .map((column) => `<th scope="col">${escapeHtml(column)}</th>`)
        .join("");
      const body = block.rows
        .map((row, rowIndex) => {
          const cells = block.columns
            .map(
              (column) =>
                `<td><label><input${attributes({ type: "radio", name: keys[rowIndex], value: column, "aria-label": `${row}: ${column}` })}></label></td>`,
            )
            .join("");
          return `<tr><td class="bf-matrix-row-label">${escapeHtml(row)}</td>${cells}</tr>`;
        })
        .join("");
      return questionShell(
        block,
        `<div class="bf-matrix-wrap"><table class="bf-matrix"><thead><tr><th scope="col"></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      );
    }
    case "statement":
      return (
        `<div class="bf-block"${attributes({ "data-block": block.id, "data-type": "statement" })}>` +
        `<h3 class="bf-section-title">${escapeHtml(block.title)}</h3>` +
        (block.body ? `<p class="bf-help">${escapeHtml(block.body)}</p>` : "") +
        `</div>`
      );
    case "section":
      // Sections never render as blocks; they split pages (see page grouping).
      return "";
  }
}

type Page = {
  header: string;
  blocks: string[];
};

/** Groups blocks into pages: content before the first section is page one. */
function buildPages(definition: FormDefinition): Page[] {
  const pages: Page[] = [
    {
      header:
        `<div class="bf-form-header"><h1>${escapeHtml(definition.title)}</h1>` +
        (definition.description ? `<p>${escapeHtml(definition.description)}</p>` : "") +
        `</div>`,
      blocks: [],
    },
  ];
  for (const block of definition.blocks) {
    if (block.type === "section") {
      pages.push({
        header:
          `<div class="bf-form-header"><h2 class="bf-section-title">${escapeHtml(block.title)}</h2>` +
          (block.description ? `<p class="bf-section-desc">${escapeHtml(block.description)}</p>` : "") +
          `</div>`,
        blocks: [],
      });
      continue;
    }
    pages[pages.length - 1].blocks.push(renderQuestion(block));
  }
  return pages;
}

export function generateFormHtml(definition: FormDefinition): string {
  const pages = buildPages(definition);
  const pageMarkup = pages
    .map((page, index) => {
      const hidden = index > 0 ? " hidden" : "";
      return `<fieldset class="bf-page" data-page="${index}"${hidden}>${page.header}${page.blocks.join("")}</fieldset>`;
    })
    .join("");
  // "<" is escaped so user text can never close the script block early; JSON
  // parsers read \u003c back as "<", keeping the definition byte-identical.
  const definitionJson = JSON.stringify(definition, null, 2).replace(/</g, "\\u003c");

  return withFormTheme(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="ousia-form" content="${FORM_MARKER_CONTENT}">
<title>${escapeHtml(definition.title)}</title>
<style>
${FORM_RUNTIME_CSS}
</style>
</head>
<body>
<script type="application/json" id="${FORM_DEFINITION_SCRIPT_ID}">${definitionJson}</script>
<main class="bf-sheet">
<form id="ousia-form" novalidate>
${pageMarkup}
<div class="bf-nav">
<a class="bf-brand" href="/" target="_blank" rel="noopener">${BRAND_MARK_SVG}<span>Ousia</span></a>
<div class="bf-nav-actions">
<button type="button" class="bf-btn bf-btn-ghost" data-nav="back" hidden>${CHEVRON_LEFT_SVG}Back</button>
<button type="button" class="bf-btn bf-btn-ghost" data-nav="next"${pages.length > 1 ? "" : " hidden"}>Next${CHEVRON_RIGHT_SVG}</button>
<button type="submit" class="bf-btn bf-btn-primary" data-nav="submit">Submit</button>
</div>
</div>
<p class="bf-status" role="status" aria-live="polite"></p>
<input class="bf-hp" type="text" name="${HONEYPOT_KEY}" tabindex="-1" autocomplete="off" aria-hidden="true">
</form>
</main>
<script>
${FORM_RUNTIME_JS}
</script>
</body>
</html>
`);
}
