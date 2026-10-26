/* Scholarly Creator — LaTeX generation.
 * Input: the app state S (see app.js). Output: { mainTex, files, notes }.
 * files: [{ path, text }] or [{ path, base64 }] for images. */

function wordCount(text) {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}

/* Escape plain text for LaTeX, preserving $...$ math and \cite{...}. */
function escTex(s) {
  s = String(s || "");
  const saved = [];
  s = s.replace(/\$[^$]+\$|\\cite\{[^}]*\}/g, m => {
    saved.push(m);
    return "\u0001" + (saved.length - 1) + "\u0001";
  });
  s = s.replace(/\\/g, "\\textbackslash{}")
       .replace(/&/g, "\\&").replace(/%/g, "\\%").replace(/#/g, "\\#")
       .replace(/_/g, "\\_").replace(/{/g, "\\{").replace(/}/g, "\\}")
       .replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
  s = s.replace(/\*\*([^*]+)\*\*/g, "\\textbf{$1}")
       .replace(/\*([^*]+)\*/g, "\\textit{$1}");
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => saved[+i]);
  return s;
}

function bodyToTex(body) {
  const paras = String(body || "").split(/\n\s*\n/);
  const out = [];
  for (const p of paras) {
    const lines = p.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every(l => l.startsWith("- "))) {
      out.push("\\begin{itemize}");
      for (const l of lines) out.push("  \\item " + escTex(l.slice(2)));
      out.push("\\end{itemize}");
    } else {
      out.push(lines.map(escTex).join("\n"));
    }
  }
  return out.join("\n\n");
}

function figExt(dataUrl) {
  const m = /^data:image\/(\w+);base64,/.exec(dataUrl || "");
  if (!m) return "png";
  const t = m[1].toLowerCase();
  return t === "jpeg" ? "jpg" : t;
}

/* Two-part caption: bold title + explanation/detail.
 * both parts    -> \caption{\textbf{Title.} Detail} (a period is added
 *                  after the title when it lacks terminal punctuation)
 * title only    -> \caption{\textbf{Title}}
 * detail only   -> \caption{Detail}
 * neither       -> \caption{fallback} ("Figure N" / "Table N")
 * Both parts are escaped with escTex; only the title is bold. */
function captionTex(title, detail, fallback) {
  const t = (title || "").trim();
  const d = (detail || "").trim();
  if (t && d) {
    const titled = /[.!?]$/.test(t) ? t : t + ".";
    return "\\caption{\\textbf{" + escTex(titled) + "} " + escTex(d) + "}";
  }
  if (t) return "\\caption{\\textbf{" + escTex(t) + "}}";
  if (d) return "\\caption{" + escTex(d) + "}";
  return "\\caption{" + escTex(fallback) + "}";
}

function figureTex(fig, n) {
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    "  \\includegraphics[width=0.8\\textwidth]{figures/" + fig.file + "}",
    "  " + captionTex(fig.capTitle, fig.capDetail, "Figure " + n),
    "  \\label{fig:fig" + n + "}",
    "\\end{figure}"
  ].join("\n");
}

function tableTex(tab, n) {
  const cols = tab.headers.length;
  const spec = Array(cols).fill("l").join(" ");
  const row = r => r.map(c => escTex(c)).join(" & ") + " \\\\";
  return [
    "\\begin{table}[htbp]",
    "  \\centering",
    "  " + captionTex(tab.capTitle, tab.capDetail, "Table " + n),
    "  \\label{tab:tab" + n + "}",
    "  \\begin{tabular}{" + spec + "}",
    "    \\toprule",
    "    " + row(tab.headers),
    "    \\midrule",
    ...tab.rows.map(r => "    " + row(r)),
    "    \\bottomrule",
    "  \\end{tabular}",
    "\\end{table}"
  ].join("\n");
}

function equationTex(eq, n) {
  return "\\begin{equation}\n  \\label{eq:eq" + n + "}\n  " + (eq.tex || "x = y") + "\n\\end{equation}";
}

/* Item placement: each figure/table/equation carries `place`, a string:
 * "c" for chapter-level (inside chapter c, before its subsections) or
 * "c:s" for subsection s of chapter c. Legacy integer `chapter` fields are
 * still honoured as place "c" so old fixtures keep working. */
function placeOf(it) {
  if (it.place !== undefined && it.place !== null) return String(it.place);
  return String(it.chapter ?? "0");
}

/* Render the items at one place. Counters are shared across a chapter's
 * places (chapter body + all its subsections) so \label numbers stay unique
 * within a chapter; omit `counters` for a fresh per-place count. */
function itemsAtPlace(S, place, counters) {
  const c = counters || { fig: 0, tab: 0, eq: 0 };
  const parts = [];
  S.figures.filter(f => placeOf(f) === place).forEach(f => parts.push(figureTex(f, ++c.fig)));
  S.tables.filter(t => placeOf(t) === place).forEach(t => parts.push(tableTex(t, ++c.tab)));
  S.equations.filter(e => placeOf(e) === place).forEach(e => parts.push(equationTex(e, ++c.eq)));
  return parts.join("\n\n");
}

/* Backwards-compatible alias: chapter-level items of chapter `chapterIndex`. */
function itemsForChapter(S, chapterIndex) {
  return itemsAtPlace(S, String(chapterIndex));
}

/* Fields emitted per entry type, in output order. Every supplied field in
 * the type's list is emitted (braces stripped, as before); empty fields
 * are omitted. Unknown types fall back to author/title/year. */
const BIB_FIELDS = {
  article: ["author", "title", "journal", "volume", "pages", "year"],
  inproceedings: ["author", "title", "booktitle", "pages", "year"],
  book: ["author", "title", "publisher", "year"],
  phdthesis: ["author", "title", "school", "year"],
  mastersthesis: ["author", "title", "school", "year"]
};

function bibEntry(r) {
  const lines = [];
  const fields = BIB_FIELDS[r.type] || ["author", "title", "year"];
  for (const k of fields) {
    const v = (r[k] || "").trim();
    if (v) lines.push("  " + k + " = {" + v.replace(/[{}]/g, "") + "},");
  }
  return "@" + r.type + "{" + (r.key || "ref") + ",\n" + lines.join("\n") + "\n}";
}

function buildBib(S) {
  return S.references.map(bibEntry).join("\n\n");
}

function readmeText(S, template) {
  return [
    "Scholarly Creator — Overleaf project",
    "Template: " + template.name,
    "",
    "HOW TO OPEN IN OVERLEAF",
    "1. CREATE A FREE ACCOUNT (one time only). Go to",
    "   https://www.overleaf.com/register and sign up with your email",
    "   address, or with Google. The free plan is all you need - no credit",
    "   card is asked for.",
    "2. DOWNLOAD THIS .ZIP FILE (you already have it - it is the file this",
    "   guide came in).",
    "3. UPLOAD IT TO OVERLEAF. In Overleaf, click New Project, then Upload",
    "   Project, and choose this .zip file. Everything the template needs",
    "   is already inside - there is nothing else to upload.",
    "4. PRESS RECOMPILE and wait a few seconds. Your PDF appears on the",
    "   right side of the screen. If you see an error on the first compile,",
    "   press Recompile once more - references and page numbers settle on",
    "   the second pass.",
    "5. GET YOUR PDF. Click the download icon above the preview (or Menu",
    "   -> Download PDF). To keep editing, change the text on the left",
    "   and press Recompile again.",
    "",
    "NOTES",
    ...templateReadmeNotes(S, template),
    "",
    "Generated in your browser by Scholarly Creator. Nothing was uploaded anywhere."
  ].join("\n");
}

function templateReadmeNotes(S, template) {
  if (template.id === "tu") return [
    "- The TU style file (TUthesis_2026.sty) is included, so the project compiles as-is.",
    "- Update \\numofpages in main.tex to your final page count after your first compile — it prints on the abstract page.",
    "- Abstract word count is checked by TU: 150 max for a thesis, 350 for a dissertation."
  ];
  if (template.id === "mit") return [
    "- The mitthesis class is part of Overleaf's TeX Live, so nothing extra is needed.",
    "- If you graduate in a month other than May, change \\degreemonth in main.tex."
  ];
  if (template.id === "generic") return [
    "- Uses only standard LaTeX packages, so it compiles anywhere."
  ];
  return ["- The " + template.name.split(" (")[0] + " class is part of Overleaf's TeX Live."];
}

function zipFiles(S, mainTex, template) {
  const files = [{ path: "main.tex", text: mainTex }];
  if (S.references.length) files.push({ path: "references.bib", text: buildBib(S) });
  if (template.id === "tu") {
    const sty = tuStyText();
    if (sty) files.push({ path: "TUthesis_2026.sty", text: sty });
  }
  S.figures.forEach(f => {
    const b64 = (f.dataUrl || "").split(",")[1] || "";
    files.push({ path: "figures/" + f.file, base64: b64 });
  });
  files.push({ path: "README-OVERLEAF.txt", text: readmeText(S, template) });
  return files;
}

/* ---------- thesis builders ---------- */

function thesisChapters(S, cmd, subCmd) {
  const body = [], appendix = [];
  S.chapters.forEach((ch, i) => {
    const counters = { fig: 0, tab: 0, eq: 0 };
    let text = cmd + "{" + escTex(ch.title || ("Chapter " + (i + 1))) + "}\n\n"
      + bodyToTex(ch.body) + itemsAtPlace(S, String(i), counters);
    (ch.sections || []).forEach((sec, j) => {
      text += "\n\n" + subCmd + "{" + escTex(sec.title || ("Section " + (j + 1))) + "}\n\n"
        + bodyToTex(sec.body);
      const secItems = itemsAtPlace(S, i + ":" + j, counters);
      if (secItems) text += "\n\n" + secItems;
    });
    (ch.appendix ? appendix : body).push(text);
  });
  return { body: body.join("\n\n"), appendix: appendix.join("\n\n") };
}

function buildTu(S) {
  const t = TEMPLATES_BY_ID.tu;
  const committee = (S.committee || []).filter(Boolean);
  const numbered = S.chapters.filter(c => !c.appendix);
  const last = numbered.length ? numbered[numbered.length - 1].title : "";
  const members = ["\\secondmember", "\\thirdmember", "\\fourthmember", "\\fifthmember", "\\sixthmember"];
  const lines = [];
  lines.push("\\documentclass[12pt,letterpaper]{report}");
  lines.push("\\usepackage{graphicx}");
  lines.push("\\usepackage{booktabs}");
  lines.push("\\usepackage{amsmath}");
  lines.push("\\RequirePackage{TUthesis_2026}");
  lines.push("");
  lines.push("\\begin{document}");
  lines.push("");
  lines.push("\\titleoneline{" + escTex(S.title) + "}");
  lines.push("\\title{" + escTex(S.title) + "}");
  lines.push("\\author{" + escTex(S.author) + "}");
  lines.push("\\degreename{" + escTex(S.degree) + "}");
  lines.push("\\dept{" + escTex(S.dept) + "}");
  lines.push("\\submityear{" + (S.year || new Date().getFullYear()) + "}");
  lines.push("\\coadvisorfalse");
  lines.push("\\committeesize=" + (1 + committee.length));
  lines.push("\\advisor{" + escTex(S.advisor) + "}");
  committee.slice(0, 5).forEach((m, i) => lines.push(members[i] + "{" + escTex(m) + "}"));
  lines.push("\\numofpages{" + (S.pages || 60) + "}");
  lines.push("\\numofchapters=" + numbered.length);
  lines.push("\\lastchapter{" + escTex(last) + "}");
  lines.push("\\numofabstractwords{" + wordCount(S.abstract) + "}");
  lines.push(S.kind === "dissertation" ? "\\thesisfalse" : "\\thesistrue");
  lines.push("\\copyrighttrue");
  lines.push(S.figures.length ? "\\figurespagetrue" : "\\figurespagefalse");
  lines.push(S.tables.length ? "\\tablespagetrue" : "\\tablespagefalse");
  lines.push("");
  lines.push("\\beforeabstract");
  lines.push("\\abstractp");
  lines.push("");
  lines.push(bodyToTex(S.abstract));
  if (S.acknowledgements.trim()) {
    lines.push("");
    lines.push("\\acknowledgementsp");
    lines.push("");
    lines.push(bodyToTex(S.acknowledgements));
    lines.push("");
    lines.push("\\afteracknowledgementsp");
  }
  if (S.dedication.trim()) {
    lines.push("");
    lines.push("\\chapter*{Dedication}");
    lines.push("");
    lines.push(escTex(S.dedication));
  }
  const { body, appendix } = thesisChapters(S, "\\chapter", "\\section");
  lines.push("");
  lines.push(body);
  lines.push("");
  lines.push("\\bibliographyp");
  lines.push("\\bibliography{references}");
  lines.push("\\bibliographystyle{unsrt}");
  if (appendix) {
    lines.push("");
    lines.push("\\appendixpages");
    lines.push("");
    lines.push(appendix);
  }
  lines.push("");
  lines.push("\\end{document}");
  const mainTex = lines.join("\n");
  return { mainTex, files: zipFiles(S, mainTex, t) };
}

function buildMit(S) {
  const t = TEMPLATES_BY_ID.mit;
  const lines = [];
  lines.push("\\documentclass{mitthesis}");
  lines.push("\\usepackage{graphicx}");
  lines.push("\\usepackage{booktabs}");
  lines.push("\\usepackage{amsmath}");
  lines.push("\\title{" + escTex(S.title) + "}");
  lines.push("\\author{" + escTex(S.author) + "}");
  lines.push("\\department{" + escTex(S.dept) + "}");
  lines.push("\\degree{" + escTex(S.degree) + "}");
  lines.push("\\degreemonth{May}");
  lines.push("\\degreeyear{" + (S.year || new Date().getFullYear()) + "}");
  lines.push("\\thesisdate{" + (S.year || new Date().getFullYear()) + "}");
  if (S.advisor.trim()) lines.push("\\supervisor{" + escTex(S.advisor) + "}{Professor}");
  lines.push("\\maketitle");
  lines.push("");
  lines.push("\\begin{abstract}");
  lines.push(bodyToTex(S.abstract));
  lines.push("\\end{abstract}");
  lines.push("");
  lines.push("\\tableofcontents");
  if (S.figures.length) lines.push("\\listoffigures");
  if (S.tables.length) lines.push("\\listoftables");
  const { body, appendix } = thesisChapters(S, "\\chapter", "\\section");
  lines.push("");
  lines.push(body);
  if (appendix) {
    lines.push("");
    lines.push("\\appendix");
    lines.push("");
    lines.push(appendix);
  }
  if (S.references.length) {
    lines.push("");
    lines.push("\\bibliographystyle{plain}");
    lines.push("\\bibliography{references}");
  }
  lines.push("");
  lines.push("\\end{document}");
  const mainTex = lines.join("\n");
  return { mainTex, files: zipFiles(S, mainTex, t) };
}

function buildGeneric(S) {
  const t = TEMPLATES_BY_ID.generic;
  const lines = [];
  lines.push("\\documentclass[12pt,letterpaper]{report}");
  lines.push("\\usepackage[margin=1in]{geometry}");
  lines.push("\\usepackage{graphicx}");
  lines.push("\\usepackage{booktabs}");
  lines.push("\\usepackage{amsmath}");
  lines.push("\\usepackage{mathptmx}");
  lines.push("\\usepackage{setspace}");
  lines.push("\\doublespacing");
  lines.push("");
  lines.push("\\begin{document}");
  lines.push("");
  lines.push("\\begin{titlepage}");
  lines.push("  \\centering");
  lines.push("  {\\LARGE " + escTex(S.title) + "}\\\\[2em]");
  lines.push("  {\\large " + escTex(S.author) + "}\\\\[1em]");
  lines.push("  " + escTex(S.degree) + "\\\\");
  lines.push("  " + escTex(S.dept) + "\\\\");
  lines.push("  " + (S.year || new Date().getFullYear()));
  lines.push("\\end{titlepage}");
  lines.push("");
  lines.push("\\begin{abstract}");
  lines.push(bodyToTex(S.abstract));
  lines.push("\\end{abstract}");
  lines.push("");
  lines.push("\\tableofcontents");
  if (S.figures.length) lines.push("\\listoffigures");
  if (S.tables.length) lines.push("\\listoftables");
  const { body, appendix } = thesisChapters(S, "\\chapter", "\\section");
  lines.push("");
  lines.push(body);
  if (S.references.length) {
    lines.push("");
    lines.push("\\bibliographystyle{plain}");
    lines.push("\\bibliography{references}");
  }
  if (appendix) {
    lines.push("");
    lines.push("\\appendix");
    lines.push("");
    lines.push(appendix);
  }
  lines.push("");
  lines.push("\\end{document}");
  const mainTex = lines.join("\n");
  return { mainTex, files: zipFiles(S, mainTex, t) };
}

/* ---------- journal builders ---------- */

function parseAuthors(text) {
  return String(text || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/—|-/).map(p => p.trim());
    return { name: parts[0] || "", aff: parts[1] || "", email: parts[2] || "" };
  });
}

function journalSections(S, cmd, subCmd) {
  return S.chapters.map((ch, i) => {
    const counters = { fig: 0, tab: 0, eq: 0 };
    let text = cmd + "{" + escTex(ch.title || ("Section " + (i + 1))) + "}\n\n"
      + bodyToTex(ch.body) + itemsAtPlace(S, String(i), counters);
    (ch.sections || []).forEach((sec, j) => {
      text += "\n\n" + subCmd + "{" + escTex(sec.title || ("Subsection " + (j + 1))) + "}\n\n"
        + bodyToTex(sec.body);
      const secItems = itemsAtPlace(S, i + ":" + j, counters);
      if (secItems) text += "\n\n" + secItems;
    });
    return text;
  }).join("\n\n");
}

function buildJournal(S) {
  const t = TEMPLATES_BY_ID[S.templateId];
  const authors = parseAuthors(S.authorsText);
  const lines = [];
  if (t.id === "ieee") {
    lines.push("\\documentclass[" + (S.ieeeMode || "conference") + "]{IEEEtran}");
    lines.push("\\usepackage{graphicx}");
    lines.push("\\usepackage{booktabs}");
    lines.push("\\usepackage{amsmath}");
    lines.push("\\title{" + escTex(S.title) + "}");
    const blocks = authors.map(a => "\\IEEEauthorblockN{" + escTex(a.name) + "}\n\\IEEEauthorblockA{" + escTex(a.aff) + (a.email ? "\\\\" + escTex(a.email) : "") + "}").join(" \\and\n");
    lines.push("\\author{" + blocks + "}");
    lines.push("\\maketitle");
    lines.push("");
    lines.push("\\begin{abstract}");
    lines.push(bodyToTex(S.abstract));
    lines.push("\\end{abstract}");
    lines.push("");
    lines.push("\\begin{IEEEkeywords}");
    lines.push(escTex(S.keywords));
    lines.push("\\end{IEEEkeywords}");
  } else if (t.id === "acm") {
    lines.push("\\documentclass[" + (S.acmMode || "sigconf") + "]{acmart}");
    lines.push("\\usepackage{graphicx}");
    lines.push("\\usepackage{booktabs}");
    lines.push("\\usepackage{amsmath}");
    lines.push("\\title{" + escTex(S.title) + "}");
    authors.forEach(a => {
      lines.push("\\author{" + escTex(a.name) + "}");
      if (a.aff) lines.push("\\affiliation{\\institution{" + escTex(a.aff) + "}}");
      if (a.email) lines.push("\\email{" + escTex(a.email) + "}");
    });
    lines.push("\\begin{abstract}");
    lines.push(bodyToTex(S.abstract));
    lines.push("\\end{abstract}");
    lines.push("\\maketitle");
  } else {
    lines.push("\\documentclass[preprint,12pt]{elsarticle}");
    lines.push("\\usepackage{graphicx}");
    lines.push("\\usepackage{booktabs}");
    lines.push("\\usepackage{amsmath}");
    lines.push("\\title{" + escTex(S.title) + "}");
    authors.forEach((a, i) => {
      lines.push("\\author[" + (i + 1) + "]{" + escTex(a.name) + "}");
      if (a.aff) lines.push("\\address[" + (i + 1) + "]{" + escTex(a.aff) + "}");
    });
    lines.push("\\begin{abstract}");
    lines.push(bodyToTex(S.abstract));
    lines.push("\\end{abstract}");
    lines.push("\\begin{keyword}");
    lines.push(escTex(S.keywords));
    lines.push("\\end{keyword}");
  }
  lines.push("");
  lines.push(journalSections(S, "\\section", "\\subsection"));
  if (S.references.length) {
    lines.push("");
    lines.push("\\bibliographystyle{" + (t.id === "ieee" ? "IEEEtran" : t.id === "acm" ? "ACM-Reference-Format" : "elsarticle-num") + "}");
    lines.push("\\bibliography{references}");
  }
  lines.push("");
  lines.push("\\end{document}");
  const mainTex = lines.join("\n");
  return { mainTex, files: zipFiles(S, mainTex, t) };
}

function buildProject(S) {
  if (S.templateId === "tu") return buildTu(S);
  if (S.templateId === "mit") return buildMit(S);
  if (S.templateId === "generic") return buildGeneric(S);
  return buildJournal(S);
}

/* Parse pasted spreadsheet/document text into table headers + rows.
 * Pure function: no DOM, no state. Lines split on \r\n, \r or \n; cells
 * split on tabs when a line contains tabs, otherwise on commas; cells are
 * trimmed. Blank lines are skipped. Ragged rows are padded with "" to the
 * widest row. When firstRowIsHeader is true the first row becomes headers;
 * otherwise headers are "Column 1..N" and every row is data. */
function parsePastedTable(text, firstRowIsHeader) {
  const lines = String(text || "").split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const splitRow = line => (line.indexOf("\t") !== -1 ? line.split("\t") : line.split(",")).map(c => c.trim());
  const grid = lines.map(splitRow);
  const cols = Math.max.apply(null, grid.map(r => r.length));
  const pad = r => Array.from({ length: cols }, (_, i) => (r[i] === undefined ? "" : r[i]));
  if (firstRowIsHeader) {
    return { headers: pad(grid[0]), rows: grid.slice(1).map(pad) };
  }
  return { headers: Array.from({ length: cols }, (_, i) => "Column " + (i + 1)), rows: grid.map(pad) };
}

/* Parse pasted BibTeX into ref objects. Returns an array of
 * {key, type, author, title, year, journal, volume, pages, booktitle,
 * publisher, school}; the array also carries a `.skipped` count of
 * entries that looked like BibTeX entries but were malformed or of an
 * unsupported type and were not added. Unknown fields are ignored.
 * Values may be braced (with nesting, e.g. {A {Nested} Title}), quoted,
 * or bare (e.g. year = 2024); commas inside values are handled. */
function parseBibtex(text) {
  const s = String(text || "");
  const KNOWN = ["author", "title", "year", "journal", "volume", "pages", "booktitle", "publisher", "school"];
  const TYPES = ["article", "book", "inproceedings", "phdthesis", "mastersthesis"];
  const entries = [];
  let skipped = 0;
  let i = 0;
  while (i < s.length) {
    const at = s.indexOf("@", i);
    if (at === -1) break;
    const m = /^@\s*([A-Za-z]+)\s*\{/.exec(s.slice(at));
    if (!m) { i = at + 1; continue; } // "@" that is not an entry start; not counted
    const rawType = m[1].toLowerCase();
    let j = at + m[0].length; // just past the entry's opening brace
    const comma = s.indexOf(",", j);
    if (comma === -1) { skipped++; break; }
    const key = s.slice(j, comma).trim();
    j = comma + 1;
    const fields = {};
    let ok = true;
    while (j < s.length) {
      while (j < s.length && /[\s,]/.test(s[j])) j++;
      if (j >= s.length) { ok = false; break; }
      if (s[j] === "}") { j++; break; }
      const fm = /^[A-Za-z][A-Za-z0-9_-]*\s*=/.exec(s.slice(j));
      if (!fm) { ok = false; break; }
      const name = fm[0].replace(/\s*=$/, "").toLowerCase();
      j += fm[0].length;
      while (j < s.length && /\s/.test(s[j])) j++;
      let value = "";
      if (s[j] === "{") {
        let depth = 0, k = j;
        do {
          if (s[k] === "\\") { k += 2; continue; }
          if (s[k] === "{") depth++;
          else if (s[k] === "}") depth--;
          k++;
        } while (k < s.length && depth > 0);
        if (depth !== 0) { ok = false; break; }
        value = s.slice(j + 1, k - 1);
        j = k;
      } else if (s[j] === '"') {
        let k = j + 1, depth = 0;
        while (k < s.length) {
          if (s[k] === "\\") { k += 2; continue; }
          if (s[k] === "{") depth++;
          else if (s[k] === "}") depth--;
          else if (s[k] === '"' && depth === 0) break;
          k++;
        }
        if (k >= s.length) { ok = false; break; }
        value = s.slice(j + 1, k);
        j = k + 1;
      } else {
        let k = j;
        while (k < s.length && s[k] !== "," && s[k] !== "}") k++;
        value = s.slice(j, k).trim();
        j = k;
      }
      if (KNOWN.includes(name)) fields[name] = value.trim();
    }
    if (ok && key && TYPES.includes(rawType)) {
      entries.push(Object.assign(
        { key: "", type: rawType, author: "", title: "", year: "", journal: "", volume: "", pages: "", booktitle: "", publisher: "", school: "" },
        fields, { key, type: rawType }));
    } else {
      skipped++;
    }
    i = j > at ? j : at + 1;
  }
  entries.skipped = skipped;
  return entries;
}
