"use strict";
/*
 * Minimal .docx reader. A .docx is a ZIP of XML parts; this reads the parts
 * that carry formatting: document.xml (body, sections), styles.xml (style
 * definitions and document defaults), theme1.xml (theme fonts) and the
 * header/footer parts (page-number fields).
 *
 * Everything happens in memory in the browser tab. The file is never
 * uploaded or stored.
 */

function xmlParse(text) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("A document part could not be read as XML.");
  return doc;
}
function kids(el, tag) {
  const out = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1 && n.tagName === tag) out.push(n);
  }
  return out;
}
function kid(el, tag) { return kids(el, tag)[0] || null; }
function attr(el, name) { return el ? el.getAttribute(name) : null; }
function allText(el, tag) {
  const nodes = el.getElementsByTagName(tag);
  let s = "";
  for (let i = 0; i < nodes.length; i++) s += nodes[i].textContent;
  return s;
}
function isDescendantOf(el, tag) {
  let n = el.parentNode;
  while (n && n.nodeType === 1) {
    if (n.tagName === tag) return true;
    n = n.parentNode;
  }
  return false;
}

/* ---------- styles ---------- */

function readRPr(rPr) {
  if (!rPr) return {};
  const out = {};
  const fonts = kid(rPr, "w:rFonts");
  if (fonts) {
    out.font = attr(fonts, "w:ascii") || attr(fonts, "w:hAnsi") || null;
    if (!out.font) {
      /* Word's built-in styles name fonts through theme references
         (w:asciiTheme="majorHAnsi"). Keep a token here; parseDocx resolves
         it against theme1.xml where the theme is known. */
      const themeName = attr(fonts, "w:asciiTheme") || attr(fonts, "w:hAnsiTheme");
      if (themeName) out.font = /^major/.test(themeName) ? "theme:major" : "theme:minor";
    }
  }
  const sz = kid(rPr, "w:sz");
  if (sz) out.sizePt = parseInt(attr(sz, "w:val"), 10) / 2;
  if (kid(rPr, "w:b")) out.bold = true;
  if (kid(rPr, "w:i")) out.italic = true;
  return out;
}
function readPPr(pPr) {
  if (!pPr) return {};
  const out = {};
  const spacing = kid(pPr, "w:spacing");
  if (spacing) {
    if (attr(spacing, "w:line")) out.line = parseInt(attr(spacing, "w:line"), 10);
    if (attr(spacing, "w:lineRule")) out.lineRule = attr(spacing, "w:lineRule");
  }
  const jc = kid(pPr, "w:jc");
  if (jc) out.jc = attr(jc, "w:val");
  const ind = kid(pPr, "w:ind");
  if (ind) {
    const tw = (name) => { const v = attr(ind, name); return v == null ? null : parseInt(v, 10); };
    out.ind = { left: tw("w:left"), firstLine: tw("w:firstLine"), hanging: tw("w:hanging") };
  }
  return out;
}

function buildStyleModel(stylesDoc) {
  const model = { defaults: { rPr: {}, pPr: {} }, byId: {} };
  if (!stylesDoc) return model;
  const defaults = kid(stylesDoc.documentElement, "w:docDefaults");
  if (defaults) {
    const rPrDefault = kid(defaults, "w:rPrDefault");
    const pPrDefault = kid(defaults, "w:pPrDefault");
    model.defaults.rPr = readRPr(rPrDefault ? kid(rPrDefault, "w:rPr") : null);
    model.defaults.pPr = readPPr(pPrDefault ? kid(pPrDefault, "w:pPr") : null);
  }
  const styles = stylesDoc.getElementsByTagName("w:style");
  for (let i = 0; i < styles.length; i++) {
    const st = styles[i];
    const id = attr(st, "w:styleId");
    if (!id) continue;
    const nameEl = kid(st, "w:name");
    const basedOnEl = kid(st, "w:basedOn");
    model.byId[id] = {
      id,
      name: nameEl ? (attr(nameEl, "w:val") || "") : id,
      basedOn: basedOnEl ? attr(basedOnEl, "w:val") : null,
      rPr: readRPr(kid(st, "w:rPr")),
      pPr: readPPr(kid(st, "w:pPr"))
    };
  }
  return model;
}

/* Walk the basedOn chain; nearest definition wins. */
function resolveChain(styleModel, styleId, pick) {
  let id = styleId, guard = 0;
  while (id && guard++ < 20) {
    const st = styleModel.byId[id];
    if (!st) break;
    const v = pick(st);
    if (v !== undefined && v !== null) return v;
    id = st.basedOn;
  }
  return null;
}
function styleNameOf(styleModel, styleId) {
  const st = styleModel.byId[styleId];
  return st ? st.name : (styleId || "");
}

/* ---------- theme fonts ---------- */

function buildThemeFonts(themeDoc) {
  const theme = { major: null, minor: null };
  if (!themeDoc) return theme;
  const major = themeDoc.getElementsByTagName("a:majorFont")[0];
  const minor = themeDoc.getElementsByTagName("a:minorFont")[0];
  if (major) { const l = kid(major, "a:latin"); if (l) theme.major = attr(l, "typeface"); }
  if (minor) { const l = kid(minor, "a:latin"); if (l) theme.minor = attr(l, "typeface"); }
  return theme;
}
function resolveFontName(raw, theme) {
  if (!raw) return null;
  if (raw === "theme:major" || raw === "+mj-lt" || raw === "+mj-ea" || raw === "+mj-cs") return theme.major;
  if (raw === "theme:minor" || raw === "+mn-lt" || raw === "+mn-ea" || raw === "+mn-cs") return theme.minor;
  return raw;
}

/* ---------- document ---------- */

async function parseDocx(file) {
  if (typeof JSZip === "undefined") throw new Error("The ZIP reader did not load. Check your connection and reload the page.");
  const zip = await JSZip.loadAsync(file);
  const part = async (path) => {
    const f = zip.file(path);
    return f ? await f.async("string") : null;
  };
  const documentXml = await part("word/document.xml");
  if (!documentXml) throw new Error("This file has no word/document.xml — it is not a Word .docx document.");
  const doc = xmlParse(documentXml);
  const stylesXml = await part("word/styles.xml");
  const styleModel = buildStyleModel(stylesXml ? xmlParse(stylesXml) : null);
  const themeXml = await part("word/theme/theme1.xml");
  const theme = buildThemeFonts(themeXml ? xmlParse(themeXml) : null);

  /* --- paragraphs --- */
  const pEls = Array.prototype.slice.call(doc.getElementsByTagName("w:p"));
  const paragraphs = pEls.map((p, i) => {
    const pPr = kid(p, "w:pPr");
    const pStyleEl = pPr ? kid(pPr, "w:pStyle") : null;
    const styleId = pStyleEl ? attr(pStyleEl, "w:val") : null;
    const styleName = styleNameOf(styleModel, styleId);
    const directP = readPPr(pPr);
    const chainLine = resolveChain(styleModel, styleId, (st) => st.pPr.line);
    const chainLineRule = resolveChain(styleModel, styleId, (st) => st.pPr.lineRule);
    const line = directP.line != null ? directP.line
      : chainLine != null ? chainLine
      : styleModel.defaults.pPr.line != null ? styleModel.defaults.pPr.line : null;
    const lineRule = directP.lineRule || chainLineRule || styleModel.defaults.pPr.lineRule || "auto";
    const jc = directP.jc || resolveChain(styleModel, styleId, (st) => st.pPr.jc) || styleModel.defaults.pPr.jc || null;
    const ind = directP.ind || resolveChain(styleModel, styleId, (st) => st.pPr.ind) || styleModel.defaults.pPr.ind || null;
    const chainBold = !!resolveChain(styleModel, styleId, (st) => st.rPr.bold);
    const chainItalic = !!resolveChain(styleModel, styleId, (st) => st.rPr.italic);

    const runs = [];
    const rEls = p.getElementsByTagName("w:r");
    for (let r = 0; r < rEls.length; r++) {
      const runEl = rEls[r];
      const rPr = kid(runEl, "w:rPr");
      const direct = readRPr(rPr);
      const chainFont = resolveChain(styleModel, styleId, (st) => st.rPr.font);
      const chainSize = resolveChain(styleModel, styleId, (st) => st.rPr.sizePt);
      const font = resolveFontName(
        direct.font || chainFont || styleModel.defaults.rPr.font, theme);
      const sizePt = direct.sizePt != null ? direct.sizePt
        : chainSize != null ? chainSize
        : styleModel.defaults.rPr.sizePt != null ? styleModel.defaults.rPr.sizePt : null;
      const text = allText(runEl, "w:t");
      if (text) runs.push({ text, font, sizePt, bold: !!direct.bold, italic: !!direct.italic });
    }
    const text = runs.map((r) => r.text).join("");
    return {
      index: i + 1,
      styleId, styleName,
      inTable: isDescendantOf(p, "w:tbl"),
      text, runs, line, lineRule,
      jc, ind, chainBold, chainItalic
    };
  });

  /* --- sections (a sectPr inside a paragraph's pPr ends that section at
        that paragraph; the body-level sectPr closes the final section) --- */
  const sectEls = Array.prototype.slice.call(doc.getElementsByTagName("w:sectPr"));
  const sections = sectEls.map((s) => {
    const pgSz = kid(s, "w:pgSz");
    const pgMar = kid(s, "w:pgMar");
    const tw = (el, name) => (el && attr(el, name) ? parseInt(attr(el, name), 10) : null);
    let endParagraph = paragraphs.length;
    let anc = s.parentNode;
    while (anc && anc.nodeType === 1 && anc.tagName !== "w:p") anc = anc.parentNode;
    if (anc && anc.tagName === "w:p") {
      const ix = pEls.indexOf(anc);
      if (ix >= 0) endParagraph = ix + 1;
    }
    const pgNum = kid(s, "w:pgNumType");
    return {
      pageWidthTw: tw(pgSz, "w:w"), pageHeightTw: tw(pgSz, "w:h"),
      orient: pgSz ? attr(pgSz, "w:orient") : null,
      endParagraph,
      pgNumType: pgNum ? {
        fmt: attr(pgNum, "w:fmt") || null,
        start: attr(pgNum, "w:start") ? parseInt(attr(pgNum, "w:start"), 10) : null
      } : null,
      marginsTw: pgMar ? {
        top: tw(pgMar, "w:top"), right: tw(pgMar, "w:right"),
        bottom: tw(pgMar, "w:bottom"), left: tw(pgMar, "w:left")
      } : { top: null, right: null, bottom: null, left: null }
    };
  });

  /* --- headers / footers (page-number fields) --- */
  const relsXml = await part("word/_rels/document.xml.rels");
  const hfParts = [];
  if (relsXml) {
    const rels = xmlParse(relsXml);
    const relEls = rels.getElementsByTagName("Relationship");
    for (let i = 0; i < relEls.length; i++) {
      const type = attr(relEls[i], "Type") || "";
      const target = attr(relEls[i], "Target") || "";
      const kind = type.endsWith("/header") ? "header" : type.endsWith("/footer") ? "footer" : null;
      if (!kind) continue;
      const name = target.split("/").pop();
      const xml = await part("word/" + name);
      if (!xml) continue;
      const hfDoc = xmlParse(xml);
      const raw = xml;
      const hasPage = /PAGE/.test(allText(hfDoc, "w:instrText")) ||
        Array.prototype.some.call(hfDoc.getElementsByTagName("w:fldSimple"),
          (f) => /PAGE/.test(attr(f, "w:instr") || ""));
      let alignment = null;
      if (hasPage) {
        const ps = hfDoc.getElementsByTagName("w:p");
        for (let j = 0; j < ps.length; j++) {
          const pXml = new XMLSerializer().serializeToString(ps[j]);
          if (/PAGE/.test(pXml)) {
            const pPr = kid(ps[j], "w:pPr");
            const jcEl = pPr ? kid(pPr, "w:jc") : null;
            alignment = jcEl ? attr(jcEl, "w:val") : null;
            break;
          }
        }
      }
      hfParts.push({ kind, name, hasPage, alignment, rawLength: raw.length });
    }
  }

  const tableCount = doc.getElementsByTagName("w:tbl").length;
  const imageCount = doc.getElementsByTagName("a:blip").length + doc.getElementsByTagName("w:pict").length;

  /* Table widths, from the grid columns (twips -> inches); falls back to
     the table's own width setting. A width the file never states stays null
     and the width check reports it as unverifiable rather than guessing. */
  const tables = [];
  const tblEls = doc.getElementsByTagName("w:tbl");
  for (let t = 0; t < tblEls.length; t++) {
    const tbl = tblEls[t];
    let widthIn = null;
    const grid = kid(tbl, "w:tblGrid");
    if (grid) {
      let sum = 0, n = 0;
      for (const gc of kids(grid, "w:gridCol")) {
        const w = attr(gc, "w:w");
        if (w != null) { sum += parseInt(w, 10); n++; }
      }
      if (n) widthIn = sum / 1440;
    }
    if (widthIn == null) {
      const tblPr = kid(tbl, "w:tblPr");
      const tblW = tblPr ? kid(tblPr, "w:tblW") : null;
      if (tblW && attr(tblW, "w:type") === "dxa" && attr(tblW, "w:w")) widthIn = parseInt(attr(tblW, "w:w"), 10) / 1440;
    }
    tables.push({ widthIn });
  }

  return { paragraphs, sections, headerFooterParts: hfParts, styleModel, theme, tableCount, imageCount, tables };
}
