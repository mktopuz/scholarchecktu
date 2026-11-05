"use strict";
/*
 * Rule engine. Compares the parsed document model (docx.js) with a rule
 * set (profiles.js) and returns one result per rule:
 *   { label, status: pass|fail|warn|info, expected, found, where, fix }
 * Locations are section / paragraph numbers plus the first words of the
 * paragraph — a .docx stores no page numbers, so none are promised.
 */

const TWIPS_PER_INCH = 1440;

function twToIn(tw) { return tw == null ? null : tw / TWIPS_PER_INCH; }
function fmtIn(v) { return v == null ? "—" : v.toFixed(2) + " in"; }
function firstWords(text, n) {
  const w = (text || "").trim().split(/\s+/).filter(Boolean);
  return w.slice(0, n || 8).join(" ") + (w.length > (n || 8) ? "…" : "");
}
function dominant(pairs) {
  /* pairs: [{value, weight}] → {value, share, total} */
  const totals = new Map();
  let total = 0;
  for (const p of pairs) {
    if (p.value == null || p.value === "") continue;
    totals.set(p.value, (totals.get(p.value) || 0) + p.weight);
    total += p.weight;
  }
  let best = null, bestW = 0;
  for (const [v, w] of totals) if (w > bestW) { best = v; bestW = w; }
  return { value: best, share: total ? bestW / total : 0, total, totals };
}
function isHeadingPara(p) { return /^heading\s*[1234]$/i.test(p.styleName || "") || /^Heading[1234]$/.test(p.styleId || ""); }
function headingLevel(p) {
  const m = /heading\s*([1234])/i.exec(p.styleName || "") || /Heading([1234])/.exec(p.styleId || "");
  return m ? parseInt(m[1], 10) : null;
}
/* A section whose paragraph range holds no text at all (e.g. the empty
   transition section in the University of Tulsa template) carries no
   visible formatting, so page-setup checks skip it. */
function sectionHasText(model, i) {
  const secs = model.sections;
  if (secs[i].endParagraph == null) return true;
  const start = i === 0 ? 1 : (secs[i - 1].endParagraph || 0) + 1;
  const end = secs[i].endParagraph;
  return model.paragraphs.some((p) => p.index >= start && p.index <= end && p.text.trim().length > 0);
}
function effectiveMultiple(p, fallbackSizePt) {
  if (p.line == null) return null;
  if (!p.lineRule || p.lineRule === "auto") return p.line / 240;
  const linePt = p.line / 20; /* exact / atLeast: twentieths of a point */
  const size = dominant(p.runs.map((r) => ({ value: r.sizePt, weight: r.text.length }))).value || fallbackSizePt;
  return size ? linePt / size : null;
}

function normText(t) {
  return (t || "").trim().toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function captionMatch(text) {
  const m = /^(table|figure)\s+(\d+)\s*[:.>\-–—]?\s*(.*)$/i.exec((text || "").trim());
  if (!m) return null;
  return { kind: m[1].toLowerCase(), num: parseInt(m[2], 10), rest: m[3] || "" };
}
function isBlockQuotePara(p) {
  if (/quote|block/i.test(p.styleName || "")) return true;
  const ind = p.ind;
  return !!(ind && ind.left != null && ind.left >= 720);
}
/* A table-of-contents entry ends in a page number. Its heading text is
   the entry minus that number — but a heading that itself ends in a digit
   ("Introduction 1") is ambiguous, so both readings are tried. */
function tocEntryCore(text) {
  const m = /^(.*?)[\s ]*(\d{1,4})$/.exec(normText(text));
  if (!m) return null;
  return { core: m[1].trim(), num: m[2] };
}
/* Paragraphs of a Table of Contents field: after the "Table of Contents"
   heading, an entry's text (minus its page number) matches a styled
   Heading 1/2. Returns a Set of paragraph indices. */
function tocEntryIndices(paras, headings) {
  const hNorms = new Set(headings.filter((p) => headingLevel(p) === 1 || headingLevel(p) === 2).map((p) => normText(p.text)));
  if (!hNorms.size) return new Set();
  const tocAt = paras.findIndex((p) => normText(p.text) === "table of contents" || normText(p.text).startsWith("table of contents "));
  if (tocAt < 0) return new Set();
  const out = new Set();
  const STOP = ["list of tables", "list of figures", "acknowledgements", "acknowledgments", "abstract", "references", "bibliography", "works cited", "literature cited", "table of contents"];
  for (let i = tocAt + 1; i < paras.length; i++) {
    const p = paras[i];
    if (p.inTable) continue;
    const n = normText(p.text);
    if (!n) continue;
    if (isHeadingPara(p)) break; /* entries are never heading-styled */
    if (STOP.some((t) => n === t)) break;
    const c = tocEntryCore(p.text);
    if (c && (hNorms.has(c.core) || hNorms.has(c.core + c.num))) out.add(p.index);
  }
  return out;
}
/* Entries of a List of Tables / List of Figures: the paragraphs after its
   heading, up to the next Heading 1 or part title. */
function listEntryIndices(paras, listName) {
  const at = paras.findIndex((p) => normText(p.text) === listName);
  if (at < 0) return { at: -1, entries: [] };
  const entries = [];
  const STOP = ["list of tables", "list of figures", "acknowledgements", "acknowledgments", "abstract", "references", "bibliography", "works cited", "literature cited", "table of contents", "introduction", "chapter"];
  for (let i = at + 1; i < paras.length; i++) {
    const p = paras[i];
    if (p.inTable) continue;
    const n = normText(p.text);
    if (!n) continue;
    if (isHeadingPara(p)) break; /* entries are never heading-styled */
    if (STOP.some((t) => n === t)) break;
    entries.push({ index: p.index, text: n });
  }
  return { at, entries };
}

function runChecks(model, rules, docType) {
  const R = [];
  const paras = model.paragraphs;
  const bodyParas = paras.filter((p) => !p.inTable && !isHeadingPara(p) && p.text.trim().length > 0);
  const substantial = bodyParas.filter((p) => p.text.trim().length >= 20);

  /* Spacing exceptions: block quotes, captions and table-of-contents
     entries are single-spaced by design, so they are left out of the
     line-spacing population instead of counting as violations. */
  const headingsEarly = paras.filter(isHeadingPara);
  const tocSet = tocEntryIndices(paras, headingsEarly);
  const listSets = ["list of tables", "list of figures"].map((n) => listEntryIndices(paras, n).entries.map((e) => e.index));
  const listSet = new Set(listSets.flat());
  const quoteParas = substantial.filter(isBlockQuotePara);
  const captionParas = substantial.filter((p) => captionMatch(p.text) && !listSet.has(p.index));
  const spacingExcluded = new Set([...tocSet, ...listSet, ...quoteParas.map((p) => p.index), ...captionParas.map((p) => p.index)]);
  const spacingParas = substantial.filter((p) => !spacingExcluded.has(p.index));

  const skippedSections = [];
  model.sections.forEach((s, i) => { if (!sectionHasText(model, i)) skippedSections.push(i + 1); });

  /* --- page size --- */
  model.sections.forEach((s, i) => {
    if (skippedSections.includes(i + 1)) return;
    const w = twToIn(s.pageWidthTw), h = twToIn(s.pageHeightTw);
    if (w == null || h == null) {
      R.push({ label: "Page size", status: "warn", expected: rules.pageSize.name, found: "not specified", where: "Section " + (i + 1), fix: FIX.pageSize });
      return;
    }
    const ok = Math.abs(w - rules.pageSize.widthIn) <= 0.1 && Math.abs(h - rules.pageSize.heightIn) <= 0.1;
    R.push({
      label: "Page size", status: ok ? "pass" : "fail",
      expected: rules.pageSize.name + " (" + rules.pageSize.widthIn + " × " + rules.pageSize.heightIn + " in)",
      found: w.toFixed(2) + " × " + h.toFixed(2) + " in",
      where: "Section " + (i + 1), fix: FIX.pageSize
    });
  });

  /* --- margins --- */
  model.sections.forEach((s, i) => {
    if (skippedSections.includes(i + 1)) return;
    const sides = ["top", "right", "bottom", "left"];
    const bad = [];
    for (const side of sides) {
      const found = twToIn(s.marginsTw[side]);
      const exp = rules.marginsIn[side];
      if (found == null || Math.abs(found - exp) > rules.marginToleranceIn) {
        bad.push(side + ": expected " + fmtIn(exp) + ", found " + fmtIn(found));
      }
    }
    R.push({
      label: "Margins", status: bad.length ? "fail" : "pass",
      expected: sides.map((sd) => sd + " " + fmtIn(rules.marginsIn[sd])).join(", "),
      found: bad.length ? bad.join("; ") : "all sides within tolerance",
      where: "Section " + (i + 1), fix: FIX.margins
    });
  });
  if (skippedSections.length) {
    R.push({
      label: "Empty sections", status: "info",
      expected: "—",
      found: "Section " + skippedSections.join(", ") + " contain" + (skippedSections.length === 1 ? "s" : "") + " no text, so page size and margins were not judged there",
      where: "Sections " + skippedSections.join(", "), fix: "—"
    });
  }

  /* --- body font --- */
  const fontPairs = [];
  const sizePairs = [];
  for (const p of bodyParas) {
    for (const r of p.runs) {
      if (r.font) fontPairs.push({ value: r.font, weight: r.text.length });
      if (r.sizePt != null) sizePairs.push({ value: r.sizePt, weight: r.text.length });
    }
  }
  const domFont = dominant(fontPairs);
  const fontOk = domFont.value && rules.bodyFonts.some((f) => f.toLowerCase() === String(domFont.value).toLowerCase());
  R.push({
    label: "Body font",
    status: !domFont.value ? "warn" : fontOk ? (domFont.share >= 0.6 ? "pass" : "warn") : "fail",
    expected: rules.bodyFonts.join(" or "),
    found: domFont.value ? domFont.value + " (" + Math.round(domFont.share * 100) + "% of body text)" : "no fonts could be read",
    where: "Whole document", fix: FIX.bodyFont
  });

  /* --- body size --- */
  const domSize = dominant(sizePairs);
  const sizeOk = domSize.value != null && Math.abs(domSize.value - rules.bodySizePt) <= 0.25;
  R.push({
    label: "Body font size",
    status: domSize.value == null ? "warn" : sizeOk ? (domSize.share >= 0.6 ? "pass" : "warn") : "fail",
    expected: rules.bodySizePt + " pt",
    found: domSize.value != null ? domSize.value + " pt (" + Math.round(domSize.share * 100) + "% of body text)" : "no sizes could be read",
    where: "Whole document", fix: FIX.bodyFont
  });

  /* --- line spacing --- */
  const multPairs = [];
  for (const p of spacingParas) {
    const m = effectiveMultiple(p, rules.bodySizePt);
    if (m != null) multPairs.push({ value: Math.round(m * 20) / 20, weight: p.text.length });
  }
  const domMult = dominant(multPairs);
  const multOk = domMult.value != null && Math.abs(domMult.value - rules.lineSpacing) <= rules.lineSpacingTolerance;
  const offenders = spacingParas.filter((p) => {
    const m = effectiveMultiple(p, rules.bodySizePt);
    return m != null && Math.abs(Math.round(m * 20) / 20 - rules.lineSpacing) > rules.lineSpacingTolerance;
  });
  R.push({
    label: "Line spacing",
    status: domMult.value == null ? "warn" : multOk ? "pass" : "fail",
    expected: rules.lineSpacing.toFixed(1) + " (" + (rules.lineSpacing === 2 ? "double" : rules.lineSpacing === 1 ? "single" : "multiple") + ")",
    found: domMult.value != null
      ? domMult.value.toFixed(2) + " for most body text" +
        (offenders.length ? "; " + offenders.length + " of " + spacingParas.length + " paragraphs differ: " +
          offenders.slice(0, 5).map((p) => "¶" + p.index + " “" + firstWords(p.text, 5) + "”").join(", ") : "")
      : "no spacing settings could be resolved",
    where: "Whole document", fix: FIX.lineSpacing
  });

  if (spacingExcluded.size) {
    R.push({
      label: "Spacing exceptions", status: "info",
      expected: "Block quotes, captions and table-of-contents entries are single-spaced by design",
      found: quoteParas.length + " block-quote paragraph(s), " + captionParas.length + " caption(s), " + tocSet.size + " table-of-contents entr" + (tocSet.size === 1 ? "y" : "ies") + " and " + listSet.size + " list entr" + (listSet.size === 1 ? "y" : "ies") + " were left out of the spacing check",
      where: "Whole document", fix: "—"
    });
  }

  /* --- heading styles --- */
  const headings = paras.filter(isHeadingPara);
  const h1 = headings.filter((p) => headingLevel(p) === 1);
  const headingFound = headings.length
    ? headings.length + " styled headings (H1 × " + h1.length + ", H2 × " + headings.filter((p) => headingLevel(p) === 2).length + ", H3 × " + headings.filter((p) => headingLevel(p) === 3).length + ", H4 × " + headings.filter((p) => headingLevel(p) === 4).length + ")"
    : "no Heading 1/2/3/4 styles used anywhere";
  if (rules.requireHeadingStyles === false) {
    R.push({
      label: "Heading styles", status: "info",
      expected: "Not required by these rules — this school's spec formats headings directly (see its note above the report)",
      found: headingFound,
      where: "Whole document", fix: FIX.headingStyles
    });
  } else {
    R.push({
      label: "Heading styles",
      status: h1.length ? "pass" : "fail",
      expected: "Chapter titles use the Heading 1 style (sections Heading 2/3)",
      found: headingFound,
      where: "Whole document", fix: FIX.headingStyles
    });
  }

  /* --- pseudo-headings (bold text posing as headings) --- */
  const pseudo = bodyParas.filter((p) => {
    const t = p.text.trim();
    if (t.length < 3 || t.length > 90) return false;
    if (/[.!?:;,]$/.test(t)) return false;
    const chars = p.runs.reduce((a, r) => a + r.text.length, 0);
    const boldChars = p.runs.reduce((a, r) => a + (r.bold ? r.text.length : 0), 0);
    return chars > 0 && boldChars / chars >= 0.9;
  });
  if (pseudo.length) {
    R.push({
      label: "Possible unstyled headings",
      status: "warn",
      expected: "Titles use Heading styles, not just bold",
      found: pseudo.length + " bold, title-like paragraphs without a heading style, e.g. ¶" +
        pseudo[0].index + " “" + firstWords(pseudo[0].text, 6) + "”" +
        (pseudo[1] ? ", ¶" + pseudo[1].index + " “" + firstWords(pseudo[1].text, 6) + "”" : ""),
      where: "Paragraphs " + pseudo.slice(0, 6).map((p) => p.index).join(", "),
      fix: FIX.headingStyles
    });
  }

  /* --- heading font --- */
  if (rules.headingFontSameAsBody && headings.length) {
    const hFonts = new Set();
    for (const p of headings) for (const r of p.runs) if (r.font) hFonts.add(r.font);
    const odd = Array.from(hFonts).filter((f) => !rules.bodyFonts.some((b) => b.toLowerCase() === f.toLowerCase()));
    R.push({
      label: "Heading font",
      status: odd.length ? "fail" : "pass",
      expected: "Same as body: " + rules.bodyFonts.join(" or "),
      found: odd.length ? "also uses " + odd.join(", ") : Array.from(hFonts).join(", ") || "—",
      where: "Headings", fix: FIX.headingFont
    });
  }

  /* --- heading formats (per-level appearance, when the profile defines it) --- */
  if (rules.headingFormats) {
    for (const lvlKey of Object.keys(rules.headingFormats)) {
      const lvl = parseInt(lvlKey, 10);
      const spec = rules.headingFormats[lvlKey];
      const hs = headings.filter((p) => headingLevel(p) === lvl && p.text.trim().length > 0);
      if (!hs.length) continue;
      const problems = [];
      const notes = [];
      if (spec.jc) {
        const match = hs.filter((p) => {
          const j = p.jc || "left";
          return spec.jc === "center" ? j === "center" : (j === "left" || j === "start");
        }).length;
        const share = match / hs.length;
        notes.push("aligned " + (spec.jc === "center" ? "center" : "left") + " in " + Math.round(share * 100) + "%");
        if (share < 0.6) problems.push("alignment: expected " + spec.jc);
      }
      const frac = (key, chainKey) => {
        let tot = 0, on = 0;
        for (const p of hs) for (const r of p.runs) { tot += r.text.length; if (r[key] || p[chainKey]) on += r.text.length; }
        return tot ? on / tot : 0;
      };
      if (spec.bold != null) {
        const f = frac("bold", "chainBold");
        notes.push("bold in " + Math.round(f * 100) + "% of heading text");
        if (spec.bold && f < 0.6) problems.push("not bold");
        if (!spec.bold && f > 0.4) problems.push("should not be bold");
      }
      if (spec.italic != null) {
        const f = frac("italic", "chainItalic");
        notes.push("italic in " + Math.round(f * 100) + "% of heading text");
        if (spec.italic && f < 0.6) problems.push("not italic");
        if (!spec.italic && f > 0.4) problems.push("should not be italic");
      }
      if (spec.line != null) {
        const ms = hs.map((p) => effectiveMultiple(p, rules.bodySizePt)).filter((m) => m != null);
        if (ms.length) {
          const good = ms.filter((m) => Math.abs(m - spec.line) <= 0.15).length / ms.length;
          notes.push("line spacing as specified in " + Math.round(good * 100) + "%");
          if (good < 0.6) problems.push("line spacing: expected " + spec.line.toFixed(1));
        }
      }
      R.push({
        label: "Heading " + lvl + " format",
        status: problems.length ? "fail" : "pass",
        expected: [
          spec.jc ? "aligned " + spec.jc : null,
          spec.bold != null ? (spec.bold ? "bold" : "not bold") : null,
          spec.italic != null ? (spec.italic ? "italic" : "not italic") : null,
          spec.line != null ? "line spacing " + spec.line.toFixed(1) : null
        ].filter(Boolean).join(", "),
        found: problems.length ? problems.join("; ") + " (" + notes.join(", ") + ")" : notes.join(", "),
        where: hs.length + " Heading " + lvl + " paragraph" + (hs.length === 1 ? "" : "s"),
        fix: FIX.headingStyles
      });
    }
  }

  /* --- page numbers --- */
  const withPage = model.headerFooterParts.filter((x) => x.hasPage);
  if (!withPage.length) {
    R.push({
      label: "Page numbers", status: "fail",
      expected: "A page-number field in the " + (rules.pageNumbers.location === "either" ? "header or footer" : rules.pageNumbers.location),
      found: "no PAGE field in any header or footer",
      where: "Headers/footers", fix: FIX.pageNumbers
    });
  } else {
    const kinds = Array.from(new Set(withPage.map((x) => x.kind)));
    const locOk = rules.pageNumbers.location === "either" || kinds.includes(rules.pageNumbers.location);
    const part = withPage.find((x) => x.kind === rules.pageNumbers.location) || withPage[0];
    let status = locOk ? "pass" : "fail";
    let foundTxt = "PAGE field in " + kinds.join(" and ");
    if (locOk && rules.pageNumbers.alignment !== "either") {
      const a = part.alignment;
      if (a === rules.pageNumbers.alignment) { /* pass */ }
      else if (a == null) { status = "warn"; foundTxt += "; alignment not set explicitly (Word may use tab stops)"; }
      else { status = "fail"; foundTxt += "; aligned " + a; }
    } else if (part.alignment) {
      foundTxt += ", aligned " + part.alignment;
    }
    R.push({
      label: "Page numbers", status,
      expected: (rules.pageNumbers.location === "either" ? "header or footer" : rules.pageNumbers.location) +
        (rules.pageNumbers.alignment !== "either" ? ", aligned " + rules.pageNumbers.alignment : ""),
      found: foundTxt, where: "Headers/footers", fix: FIX.pageNumbers
    });
  }

  /* --- page-numbering format (when the profile defines a scheme) --- */
  if (rules.pageNumbering) {
    const spec = rules.pageNumbering;
    const textSecs = model.sections.filter((s, i) => sectionHasText(model, i));
    const fmts = textSecs.map((s) => (s.pgNumType && s.pgNumType.fmt) || null);
    const starts = textSecs.map((s) => (s.pgNumType && s.pgNumType.start) || null);
    const hasPrelim = fmts.some((f) => f === spec.preliminaryFmt);
    const lastFmt = fmts[fmts.length - 1];
    const lastStart = starts[starts.length - 1];
    let status, found;
    if (!textSecs.length || (fmts.every((f) => f == null) && starts.every((s) => s == null))) {
      status = "warn";
      found = "no section declares a page-number format, so the numbering scheme could not be verified";
    } else if (hasPrelim && lastFmt !== spec.preliminaryFmt && lastStart === spec.bodyStart) {
      status = "pass";
      found = "preliminary sections use " + spec.preliminaryFmt + "; the final section restarts at Arabic " + spec.bodyStart;
    } else if (!hasPrelim) {
      status = "fail";
      found = "no section uses " + spec.preliminaryFmt + " for the preliminary pages (found: " +
        fmts.map((f) => f || "decimal (default)").join(", ") + ")";
    } else if (lastFmt === spec.preliminaryFmt) {
      status = "fail";
      found = "the final section still uses " + spec.preliminaryFmt + " — the body should switch to Arabic numbering";
    } else {
      status = "warn";
      found = "preliminary pages use " + spec.preliminaryFmt + ", but the body section does not explicitly restart at " + spec.bodyStart;
    }
    R.push({
      label: "Page numbering format", status,
      expected: "Preliminary pages in " + spec.preliminaryFmt + ", body restarting at Arabic " + spec.bodyStart,
      found, where: "Sections", fix: FIX.pageNumbering
    });
  }

  /* --- required parts for the document type --- */
  const PART_SYNONYMS = [
    ["references", "bibliography", "works cited", "literature cited"],
    ["table of contents", "contents"],
    ["acknowledgements", "acknowledgments"]
  ];
  const aliasesFor = (name) => {
    const k = name.toLowerCase();
    return PART_SYNONYMS.find((g) => g.includes(k)) || [k];
  };
  const searchable = paras.map((p) => ({ p, norm: p.text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() }));
  const findPart = (name) => {
    const aliases = aliasesFor(name);
    const match = (x) => aliases.some((a) => x.norm === a || x.norm.startsWith(a + " "));
    /* A table-of-contents entry ("Bibliography … 42") must never count as
       the part itself, and a real heading still beats a passing mention. */
    const usable = (x) => match(x) && !tocSet.has(x.p.index);
    return searchable.find((x) => usable(x) && isHeadingPara(x.p)) || searchable.find(usable);
  };
  for (const partName of docType.requiredParts) {
    if (/^title page$/i.test(partName)) {
      R.push({
        label: "Required part: " + partName, status: "info",
        expected: "A title page following the school's template",
        found: "cannot be verified automatically — the first page's wording varies by template",
        where: "Page 1", fix: FIX.frontMatter
      });
      continue;
    }
    const hit = findPart(partName);
    R.push({
      label: "Required part: " + partName,
      status: hit ? "pass" : "fail",
      expected: "A “" + partName + "” section",
      found: hit ? "found at paragraph " + hit.p.index + " (“" + firstWords(hit.p.text, 5) + "”)" : "not found as a heading",
      where: hit ? "Paragraph " + hit.p.index : "Whole document", fix: FIX.frontMatter
    });
  }

  /* --- conditional parts: required only when the document has the feature --- */
  for (const cp of docType.conditionalParts || []) {
    const has = cp.when === "tables" ? (model.tableCount || 0) > 0
      : cp.when === "figures" ? (model.imageCount || 0) > 0 : false;
    const feature = cp.when === "tables" ? "tables" : "figures";
    if (!has) {
      R.push({
        label: "Required part: " + cp.name, status: "info",
        expected: "Required when the document has " + feature,
        found: "no " + feature + " detected, so a " + cp.name + " is not judged",
        where: "Whole document", fix: FIX.frontMatter
      });
      continue;
    }
    const hit = findPart(cp.name);
    R.push({
      label: "Required part: " + cp.name,
      status: hit ? "pass" : "fail",
      expected: "A “" + cp.name + "” section (the document has " + feature + ")",
      found: hit ? "found at paragraph " + hit.p.index + " (“" + firstWords(hit.p.text, 5) + "”)" : "not found as a heading, though the document has " + feature,
      where: hit ? "Paragraph " + hit.p.index : "Whole document", fix: FIX.frontMatter
    });
  }

  /* --- abstract word limit (when the profile sets one for this document type) --- */
  if (docType.abstractWordLimit) {
    const lim = docType.abstractWordLimit;
    const absHit = searchable.find((x) => (x.norm === "abstract" || x.norm.startsWith("abstract ")) && isHeadingPara(x.p))
      || searchable.find((x) => x.norm === "abstract" || x.norm.startsWith("abstract "));
    if (!absHit) {
      R.push({
        label: "Abstract word count", status: "warn",
        expected: "Abstract of " + lim + " words or fewer (" + (docType.label || "limit for this document type") + ")",
        found: "no Abstract heading found, so the word count could not be checked",
        where: "Whole document", fix: FIX.abstractWord
      });
    } else {
      /* A .docx stores no page breaks, so the abstract's end is the next
         Heading 1 style or a known part title — whichever comes first. */
      const NEXT_PARTS = [
        "table of contents", "contents", "acknowledgements", "acknowledgments",
        "references", "bibliography", "works cited", "literature cited",
        "list of figures", "list of tables", "introduction", "chapter"
      ];
      let words = 0, first = null, last = null;
      for (let i = absHit.p.index; i < paras.length; i++) {
        const p = paras[i];
        if (p.inTable) continue;
        const n = p.text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        if (!n) continue;
        if ((isHeadingPara(p) && headingLevel(p) === 1) ||
            NEXT_PARTS.some((t) => n === t || n.startsWith(t + " "))) break;
        words += p.text.trim().split(/\s+/).length;
        if (first == null) first = p.index;
        last = p.index;
      }
      const over = words > lim;
      R.push({
        label: "Abstract word count", status: over ? "fail" : "pass",
        expected: "Abstract of " + lim + " words or fewer (" + (docType.label || "limit for this document type") + ")",
        found: words + " words" +
          (first != null ? " in paragraphs " + first + "–" + last : ", no abstract text found after the heading") +
          (over ? " — " + (words - lim) + " over the limit" : ""),
        where: first != null ? "Paragraphs " + first + "–" + last : "Abstract",
        fix: FIX.abstractWord
      });
    }
  }

  /* --- front-matter order --- */
  {
    const seq = [];
    for (const name of docType.requiredParts) {
      if (/^title page$/i.test(name)) continue;
      seq.push(name);
      if (/table of contents/i.test(name)) {
        for (const cp of docType.conditionalParts || []) {
          const has = cp.when === "tables" ? (model.tableCount || 0) > 0
            : cp.when === "figures" ? (model.imageCount || 0) > 0 : false;
          if (has) seq.push(cp.name);
        }
      }
    }
    const found = seq.map((name) => ({ name, hit: findPart(name) })).filter((x) => x.hit);
    let outOfOrder = null;
    for (let i = 1; i < found.length; i++) {
      if (found[i].hit.p.index < found[i - 1].hit.p.index) { outOfOrder = [found[i - 1], found[i]]; break; }
    }
    R.push({
      label: "Front-matter order",
      status: found.length < 2 ? "info" : outOfOrder ? "fail" : "pass",
      expected: "Front matter in order: " + seq.join(" → "),
      found: found.length < 2
        ? "fewer than two front-matter parts could be located, so the order could not be judged"
        : outOfOrder
          ? "“" + outOfOrder[1].name + "” (¶" + outOfOrder[1].hit.p.index + ") comes before “" + outOfOrder[0].name + "” (¶" + outOfOrder[0].hit.p.index + ")"
          : "all located parts appear in order (" + found.map((x) => x.name).join(", ") + ")",
      where: "Front matter", fix: FIX.frontMatterOrder
    });
  }

  /* --- table of contents accuracy --- */
  {
    /* Only headings after the Table of Contents count: a contents list
       never has to list the front-matter parts themselves (Copyright,
       Abstract, the contents heading, …). */
    const tocHit = findPart("Table of Contents");
    const PART_NAMES = ["copyright", "acknowledgements", "acknowledgments", "abstract", "table of contents", "list of tables", "list of figures", "references", "bibliography", "works cited", "literature cited", "title page", "dedication", "vita", "preface"];
    const hs = paras.filter(isHeadingPara).filter((p) => (headingLevel(p) === 1 || headingLevel(p) === 2) && p.text.trim().length > 0
      && (!tocHit || p.index > tocHit.p.index)
      && !PART_NAMES.some((n) => normText(p.text) === n || normText(p.text).startsWith(n + " ")));
    if (tocHit) {
      const entryParas = paras.filter((p) => tocSet.has(p.index));
      const hNorms = new Set(hs.map((p) => normText(p.text)));
      const entryCores = entryParas.map((p) => {
        const c = tocEntryCore(p.text);
        if (!c) return "";
        if (hNorms.has(c.core)) return c.core;
        if (hNorms.has(c.core + c.num)) return c.core + c.num;
        return c.core;
      });
      const missing = hs.filter((p) => !entryCores.includes(normText(p.text)));
      const stale = entryCores.filter((c) => c && !hNorms.has(c));
      let status, found;
      if (!hs.length) {
        status = "warn";
        found = "no Heading 1/2 styles found, so the entries could not be matched against the document's headings";
      } else if (!entryParas.length) {
        status = "warn";
        found = "the Table of Contents heading is there but no entries could be read — the field may need updating in Word (right-click ▸ Update Field)";
      } else if (missing.length || stale.length) {
        status = "fail";
        found = (missing.length ? missing.length + " heading(s) missing from the contents: " + missing.slice(0, 3).map((p) => "“" + firstWords(p.text, 5) + "”").join(", ") : "") +
          (missing.length && stale.length ? "; " : "") +
          (stale.length ? stale.length + " entr" + (stale.length === 1 ? "y" : "ies") + " with no matching heading: " + stale.slice(0, 3).map((c) => "“" + c + "”").join(", ") : "");
      } else {
        status = "pass";
        found = "all " + hs.length + " Heading 1/2 titles appear in the contents, and every entry matches a heading";
      }
      R.push({ label: "Table of contents entries", status, expected: "Every Heading 1/2 title listed, nothing stale", found, where: "Table of Contents", fix: FIX.tocEntries });
    }
  }

  /* --- list of tables / figures accuracy --- */
  for (const [listName, kind] of [["List of Tables", "table"], ["List of Figures", "figure"]]) {
    const hasFeature = kind === "table" ? (model.tableCount || 0) > 0 : (model.imageCount || 0) > 0;
    if (!hasFeature) continue;
    const listHit = findPart(listName);
    if (!listHit) continue; /* a missing list is judged by the conditional-parts check */
    const caps = paras.filter((p) => { const c = captionMatch(p.text); return c && c.kind === kind && !listSet.has(p.index); });
    const { entries } = listEntryIndices(paras, listName.toLowerCase());
    const capNums = caps.map((p) => captionMatch(p.text).num);
    const entryNums = entries.map((e) => { const m = /^(table|figure)\s+(\d+)/.exec(e.text); return m ? parseInt(m[2], 10) : null; }).filter((n) => n != null);
    const missing = capNums.filter((n) => !entryNums.includes(n));
    const stale = entryNums.filter((n) => !capNums.includes(n));
    let status, found;
    if (!entries.length) {
      status = "warn";
      found = "the “" + listName + "” heading is there but no entries could be read — the field may need updating in Word (right-click ▸ Update Field)";
    } else if (missing.length || stale.length) {
      status = "fail";
      found = (missing.length ? "caption(s) missing from the list: " + kind + " " + missing.slice(0, 5).join(", ") : "") +
        (missing.length && stale.length ? "; " : "") +
        (stale.length ? "list entr" + (stale.length === 1 ? "y" : "ies") + " with no matching caption: " + kind + " " + stale.slice(0, 5).join(", ") : "");
    } else {
      status = "pass";
      found = "all " + capNums.length + " " + kind + " caption(s) listed, and every entry matches a caption";
    }
    R.push({ label: "List of " + kind + "s entries", status, expected: "Every " + kind + " caption listed, nothing stale", found, where: listName, fix: FIX.listEntries });
  }

  /* --- captions --- */
  {
    const caps = paras.filter((p) => captionMatch(p.text) && !listSet.has(p.index)).map((p) => ({ p, c: captionMatch(p.text) }));
    const parts = [];
    let status = "pass";
    for (const kind of ["table", "figure"]) {
      const count = kind === "table" ? (model.tableCount || 0) : (model.imageCount || 0);
      if (!count) continue;
      const list = caps.filter((x) => x.c.kind === kind);
      const name = kind === "table" ? "Table" : "Figure";
      if (!list.length) {
        status = "fail";
        parts.push(count + " " + kind + "(s) but no “" + name + " N” captions found");
        continue;
      }
      const nums = list.map((x) => x.c.num);
      const sequenced = nums.every((n, i) => n === i + 1);
      const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
      if (!sequenced || dupes.length) {
        status = "fail";
        parts.push(kind + " captions numbered " + nums.join(", ") + " — expected 1, 2, 3… in order");
      } else {
        parts.push(list.length + " " + kind + " caption(s), numbered 1–" + nums.length + " in order");
      }
    }
    if (parts.length) {
      R.push({ label: "Captions", status, expected: "Every table and figure has a numbered caption, in sequence", found: parts.join("; "), where: "Tables and figures", fix: FIX.captions });
    }
  }

  /* --- fonts used (full audit, not just the dominant font) --- */
  {
    const others = [...domFont.totals.entries()].filter(([f]) => !rules.bodyFonts.some((b) => b.toLowerCase() === String(f).toLowerCase()));
    const listed = others.filter(([, w]) => domFont.total && w / domFont.total >= 0.01)
      .map(([f, w]) => f + " " + Math.round((w / domFont.total) * 100) + "%");
    if (listed.length) {
      const worst = Math.max(...others.map(([, w]) => domFont.total ? w / domFont.total : 0));
      R.push({
        label: "Fonts used",
        status: worst >= 0.2 ? "fail" : "warn",
        expected: "Body text in " + rules.bodyFonts.join(" or ") + " only",
        found: "also uses " + listed.join(", ") + " (dominant: " + (domFont.value || "—") + " " + Math.round(domFont.share * 100) + "%)",
        where: "Whole document", fix: FIX.fontsUsed
      });
    }
  }

  /* --- citations vs bibliography --- */
  {
    const bibHit = findPart("Bibliography") || findPart("References");
    const bibStart = bibHit ? bibHit.p.index : null;
    const STOPWORDS = new Set(["see", "cf", "e.g", "i.e", "etc", "word", "figure", "table", "chapter", "section", "appendix", "eq", "et"]);
    const citeRe = /\(([^()]*)\)/g;
    const nameYearRe = /([A-Z][A-Za-z'’\-\u00c0-\u024f]{1,30})(?:\s+(?:and|&)\s+([A-Z][A-Za-z'’\-\u00c0-\u024f]{1,30}))?(?:\s+et al\.?)?,?\s+((?:19|20)\d{2})[a-z]?/g;
    const cites = new Map();
    for (const p of paras) {
      if (p.inTable || !p.text.trim()) continue;
      if (bibStart != null && p.index >= bibStart) continue;
      if (isHeadingPara(p)) continue;
      let m;
      citeRe.lastIndex = 0;
      while ((m = citeRe.exec(p.text)) !== null) {
        const inner = m[1];
        let n;
        nameYearRe.lastIndex = 0;
        while ((n = nameYearRe.exec(inner)) !== null) {
          for (const s of [n[1], n[2]]) {
            if (!s) continue;
            if (STOPWORDS.has(s.toLowerCase())) continue;
            cites.set(s + "|" + n[3], "(¶" + p.index + " “" + firstWords(p.text, 6) + "”)");
          }
        }
      }
    }
    if (bibHit && cites.size) {
      const entries = [];
      for (let i = bibHit.p.index; i < paras.length; i++) {
        const p = paras[i];
        if (p.inTable) continue;
        const t = p.text.trim();
        if (!t) continue;
        if (isHeadingPara(p) && headingLevel(p) === 1) break;
        if (/^(appendix|appendices)\b/i.test(t)) break;
        const sur = /^[A-Za-z'’\-\u00c0-\u024f]+/.exec(t);
        const yr = /\b((?:19|20)\d{2})[a-z]?\b/.exec(t);
        entries.push({ index: p.index, text: t, surname: sur ? sur[0] : null, year: yr ? yr[1] : null, ind: p.ind });
      }
      const have = new Set(entries.filter((e) => e.surname && e.year).map((e) => e.surname + "|" + e.year));
      const unmatchedCites = [...cites.keys()].filter((k) => !have.has(k));
      const citedKeys = new Set(cites.keys());
      const unmatchedRefs = entries.filter((e) => e.surname && e.year && !citedKeys.has(e.surname + "|" + e.year));
      const problems = [];
      if (unmatchedCites.length) problems.push(unmatchedCites.length + " citation(s) with no matching Bibliography entry: " + unmatchedCites.slice(0, 3).join(", "));
      if (unmatchedRefs.length) problems.push(unmatchedRefs.length + " Bibliography entr" + (unmatchedRefs.length === 1 ? "y" : "ies") + " never cited in the text: " + unmatchedRefs.slice(0, 3).map((e) => e.surname + " " + e.year).join(", "));
      R.push({ label: "Citation cross-check", status: problems.length ? "warn" : "pass", expected: "Every in-text citation has a Bibliography entry, and vice versa", found: problems.length ? problems.join("; ") : cites.size + " citation(s) checked against " + entries.length + " Bibliography entries — all match", where: "Body and Bibliography", fix: FIX.citations });
      /* Entries without a readable surname are skipped, so disorder
         always names two real entries. */
      const orderedEntries = entries.filter((e) => e.surname);
      let disorder = null;
      for (let i = 1; i < orderedEntries.length; i++) {
        if (orderedEntries[i].surname.toLowerCase() < orderedEntries[i - 1].surname.toLowerCase()) { disorder = [orderedEntries[i - 1], orderedEntries[i]]; break; }
      }
      R.push({ label: "Bibliography order", status: disorder ? "warn" : "pass", expected: "Bibliography entries in alphabetical order by first author's surname", found: disorder ? "“" + disorder[1].surname + "” (¶" + disorder[1].index + ") follows “" + disorder[0].surname + "” (¶" + disorder[0].index + ") — out of alphabetical order" : orderedEntries.length + " entries in alphabetical order", where: "Bibliography", fix: FIX.bibliographyOrder });
      const hanging = entries.filter((e) => e.ind && ((e.ind.firstLine != null && e.ind.firstLine < 0) || (e.ind.hanging != null && e.ind.hanging > 0))).length;
      R.push({ label: "Bibliography hanging indent", status: "info", expected: "—", found: hanging + " of " + entries.length + " entries use a hanging indent", where: "Bibliography", fix: "—" });
    }
  }

  /* --- table width vs margins --- */
  {
    const tables = model.tables || [];
    const textSecs = model.sections.filter((s, i) => sectionHasText(model, i));
    const sec = textSecs[0] || model.sections[0];
    if (tables.length && sec) {
      const pw = twToIn(sec.pageWidthTw), ml = twToIn(sec.marginsTw.left), mr = twToIn(sec.marginsTw.right);
      const avail = (pw != null && ml != null && mr != null) ? pw - ml - mr : null;
      const over = tables.map((t, i) => ({ i: i + 1, w: t.widthIn })).filter((t) => t.w != null && avail != null && t.w > avail + 0.1);
      const unknown = tables.filter((t) => t.widthIn == null).length;
      if (avail == null) {
        R.push({ label: "Table width", status: "warn", expected: "Tables fit inside the text width", found: "page size or margins are not stated, so table fit could not be verified", where: "Tables", fix: FIX.tableWidth });
      } else if (over.length || unknown) {
        R.push({ label: "Table width", status: over.length ? "fail" : "warn", expected: "Tables fit inside the text width (" + avail.toFixed(2) + " in)", found: (over.length ? over.slice(0, 3).map((t) => "table " + t.i + " is " + t.w.toFixed(2) + " in wide").join("; ") : "") + (unknown ? (over.length ? "; " : "") + unknown + " table(s) with no width information, so fit could not be verified" : ""), where: "Tables", fix: FIX.tableWidth });
      } else {
        R.push({ label: "Table width", status: "pass", expected: "Tables fit inside the text width (" + avail.toFixed(2) + " in)", found: tables.length + " table(s), all within the text width", where: "Tables", fix: FIX.tableWidth });
      }
    }
  }

  /* --- tables (informational) --- */
  const tableParas = paras.filter((p) => p.inTable && p.text.trim().length > 0);
  if (tableParas.length) {
    const tSizes = [];
    for (const p of tableParas) for (const r of p.runs) if (r.sizePt != null) tSizes.push({ value: r.sizePt, weight: r.text.length });
    const dt = dominant(tSizes);
    R.push({
      label: "Table text", status: "info",
      expected: "Most guides allow smaller type in tables — reported for information",
      found: dt.value != null ? "mostly " + dt.value + " pt across " + tableParas.length + " table paragraphs" : tableParas.length + " table paragraphs",
      where: "Tables", fix: "—"
    });
  }

  const wordCount = paras.reduce((a, p) => a + (p.text.trim() ? p.text.trim().split(/\s+/).length : 0), 0);
  return { results: R, stats: { paragraphs: paras.length, words: wordCount, sections: model.sections.length }, score: computeScore(R) };
}

/* ---------- overall score ----------
 * Rows are grouped by check label (a multi-section document produces one
 * row per section; the worst verdict in the group counts). Core formatting
 * rules weigh 3, structure and required parts weigh 2, the advisory
 * pseudo-heading warning weighs 1; informational rows never score.
 * Credit: pass 1, warn 0.5, fail 0. Bands are calibrated so a document the
 * school would accept lands at 90+. */
const SCORE_WEIGHTS = [
  [/^(Page size|Margins|Body font|Body font size|Line spacing|Page numbers|Page numbering format)$/, 3],
  [/^Table width$/, 3],
  [/^(Heading styles|Heading font|Abstract word count)$/, 2],
  [/^Heading [1234] format$/, 2],
  [/^Required part:/, 2],
  [/^(Front-matter order|Table of contents entries|List of tables entries|List of figures entries|Captions|Fonts used)$/, 2],
  [/^(Citation cross-check|Bibliography order)$/, 1],
  [/^Possible unstyled headings$/, 1]
];
function computeScore(results) {
  const rank = { fail: 0, warn: 1, pass: 2, info: 3 };
  const byLabel = new Map();
  for (const r of results) {
    const cur = byLabel.get(r.label);
    if (cur === undefined || rank[r.status] < rank[cur]) byLabel.set(r.label, r.status);
  }
  const weightOf = (label) => {
    for (const [re, weight] of SCORE_WEIGHTS) if (re.test(label)) return weight;
    return 0;
  };
  let total = 0, earned = 0;
  for (const [label, status] of byLabel) {
    if (status === "info") continue;
    const w = weightOf(label);
    if (!w) continue;
    total += w;
    earned += w * (status === "pass" ? 1 : status === "warn" ? 0.5 : 0);
  }
  if (!total) return null;
  /* Band caps — the trust fix: a document the school would reject must
     never score "Excellent". Any failed core rule caps the band at Good;
     a failed core rule plus a missing required part caps it at Needs work. */
  let value = Math.round((earned / total) * 100);
  let capped = false, capNote = "";
  const coreFail = [...byLabel.entries()].some(([label, status]) => status === "fail" && weightOf(label) === 3);
  const missingPart = [...byLabel.entries()].some(([label, status]) => status === "fail" && /^Required part:/.test(label));
  if (coreFail && missingPart && value > 74) {
    value = 74; capped = true;
    capNote = "Score capped at 74 — a failed core rule plus a missing required part limit the band to “Needs work”.";
  } else if (coreFail && value > 89) {
    value = 89; capped = true;
    capNote = "Score capped at 89 — a failed core formatting rule limits the band to “Good”.";
  }
  const band = value >= 90 ? "Excellent — ready to submit"
    : value >= 75 ? "Good — minor fixes"
    : value >= 50 ? "Needs work"
    : "Major rework needed";
  return { value, band, capped, capNote };
}
