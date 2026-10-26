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

function figureTex(fig, n) {
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    "  \\includegraphics[width=0.8\\textwidth]{figures/" + fig.file + "}",
    "  \\caption{" + escTex(fig.caption || "Figure " + n) + "}",
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
    "  \\caption{" + escTex(tab.caption || "Table " + n) + "}",
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

function itemsForChapter(S, chapterIndex) {
  const parts = [];
  S.figures.filter(f => f.chapter === chapterIndex).forEach((f, i) => parts.push(figureTex(f, i + 1)));
  S.tables.filter(t => t.chapter === chapterIndex).forEach((t, i) => parts.push(tableTex(t, i + 1)));
  S.equations.filter(e => e.chapter === chapterIndex).forEach((e, i) => parts.push(equationTex(e, i + 1)));
  return parts.join("\n\n");
}

function bibEntry(r) {
  const f = (k) => (r[k] || "").trim();
  const lines = [];
  const push = (k, v) => { if (v) lines.push("  " + k + " = {" + v.replace(/[{}]/g, "") + "},"); };
  push("author", f("author")); push("title", f("title"));
  if (r.type === "article") { push("journal", f("journal")); push("volume", f("volume")); push("pages", f("pages")); }
  if (r.type === "inproceedings") { push("booktitle", f("booktitle")); push("pages", f("pages")); }
  if (r.type === "book") { push("publisher", f("publisher")); }
  if (r.type === "phdthesis" || r.type === "mastersthesis") { push("school", f("school")); }
  push("year", f("year"));
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

function thesisChapters(S, cmd) {
  const body = [], appendix = [];
  S.chapters.forEach((ch, i) => {
    const text = cmd + "{" + escTex(ch.title || ("Chapter " + (i + 1))) + "}\n\n"
      + bodyToTex(ch.body) + itemsForChapter(S, i);
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
  const { body, appendix } = thesisChapters(S, "\\chapter");
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
  const { body, appendix } = thesisChapters(S, "\\chapter");
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
  const { body, appendix } = thesisChapters(S, "\\chapter");
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

function journalSections(S, cmd) {
  return S.chapters.map((ch, i) =>
    cmd + "{" + escTex(ch.title || ("Section " + (i + 1))) + "}\n\n"
    + bodyToTex(ch.body) + itemsForChapter(S, i)
  ).join("\n\n");
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
  lines.push(journalSections(S, "\\section"));
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
