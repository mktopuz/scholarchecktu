/* Scholarly Creator — wizard state and UI. Everything runs in the browser. */
const S = {
  kind: "thesis",
  templateId: "tu",
  title: "", author: "", dept: "", degree: "Master of Science", advisor: "",
  committee: [], year: 2026, pages: 60,
  authorsText: "", keywords: "",
  abstract: "", acknowledgements: "", dedication: "",
  chapters: [{ title: "Introduction", body: "", appendix: false, sections: [] }],
  figures: [], tables: [], equations: [], references: [],
  ieeeMode: "conference", acmMode: "sigconf"
};
let step = 1;
let figCounter = 0, tabCounter = 0, eqCounter = 0;
const $ = id => document.getElementById(id);
const STEP_NAMES = ["Type", "Details", "Front matter", "Chapters", "Figures & tables", "References", "Review"];

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function templatesForKind(kind) {
  return TEMPLATES.filter(t => (kind === "article" ? t.kind === "article" : t.kind === "thesis"));
}

function syncTemplateSelect() {
  const sel = $("templateSelect");
  const list = templatesForKind(S.kind);
  sel.innerHTML = list.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("");
  if (!list.some(t => t.id === S.templateId)) S.templateId = list[0].id;
  sel.value = S.templateId;
  const t = TEMPLATES_BY_ID[S.templateId];
  $("templateDesc").textContent = t.desc;
  $("templateNote").textContent = t.kind === "article"
    ? "Journal templates use the publisher's official class, already in Overleaf's TeX Live."
    : "Thesis templates follow the school's own layout. The University of Tulsa option bundles its official style file.";
  $("overleafNote").textContent = t.overleafNote;
  renderModeWrap();
}

function renderModeWrap() {
  let wrap = $("modeWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "modeWrap";
    $("templateSelect").after(wrap);
  }
  if (S.templateId === "ieee") {
    wrap.innerHTML = `<label style="margin-top:10px">IEEE layout
      <select id="ieeeMode"><option value="conference">Conference paper</option><option value="journal">Journal article</option></select></label>`;
    $("ieeeMode").value = S.ieeeMode;
    $("ieeeMode").onchange = e => { S.ieeeMode = e.target.value; };
  } else if (S.templateId === "acm") {
    wrap.innerHTML = `<label style="margin-top:10px">ACM format
      <select id="acmMode"><option value="sigconf">Conference (sigconf)</option><option value="acmsmall">Journal (acmsmall)</option></select></label>`;
    $("acmMode").value = S.acmMode;
    $("acmMode").onchange = e => { S.acmMode = e.target.value; };
  } else {
    wrap.innerHTML = "";
  }
}

function renderSteps() {
  $("stepNav").innerHTML = STEP_NAMES.map((n, i) =>
    `<button type="button" data-goto="${i + 1}" class="${i + 1 === step ? "active" : i + 1 < step ? "done" : ""}">${i + 1}. ${n}</button>`).join("");
  document.querySelectorAll("[data-step]").forEach(el => { el.hidden = +el.dataset.step !== step; });
  $("prevBtn").disabled = step === 1;
  $("nextBtn").textContent = step === 7 ? "Done — review above" : "Next →";
  if (step === 5) { renderFigures(); renderTables(); renderEquations(); }
  if (step === 6) renderRefs();
  if (step === 7) refreshReview();
  if (step === 2) {
    $("thesisFields").hidden = S.kind === "article";
    $("articleFields").hidden = S.kind !== "article";
    $("f-pages-wrap").hidden = S.templateId !== "tu";
  }
}

function readForm() {
  if (S.kind === "article") {
    S.title = $("f-atitle").value; S.authorsText = $("f-authors").value; S.keywords = $("f-keywords").value;
  } else {
    S.title = $("f-title").value; S.author = $("f-author").value; S.dept = $("f-dept").value;
    S.degree = $("f-degree").value; S.advisor = $("f-advisor").value;
    S.year = parseInt($("f-year").value, 10) || 2026;
    S.pages = parseInt($("f-pages").value, 10) || 60;
    S.committee = $("f-committee").value.split("\n").map(s => s.trim()).filter(Boolean);
  }
  S.abstract = $("f-abstract").value;
  S.acknowledgements = $("f-ack").value;
  S.dedication = $("f-dedication").value;
}

/* Placement options for figures/tables/equations. Values are strings:
 * "c" for a whole chapter/section, "c:s" for subsection s of chapter c.
 * Labels use the chapter title (or "Chapter N"/"Section N" fallback), with
 * subsections shown as "<chapter> › <subsection title>". */
function chapterOptions(selected) {
  const sel = String(selected ?? "0");
  const out = [];
  S.chapters.forEach((c, i) => {
    const base = S.kind === "article" ? "Section " : "Chapter ";
    const chLabel = c.title || (base + (i + 1));
    out.push(`<option value="${i}" ${sel === String(i) ? "selected" : ""}>${escHtml(chLabel)}</option>`);
    (c.sections || []).forEach((s, j) => {
      const v = i + ":" + j;
      const subLabel = s.title || ("Subsection " + (j + 1));
      out.push(`<option value="${v}" ${sel === v ? "selected" : ""}>${escHtml(chLabel)} › ${escHtml(subLabel)}</option>`);
    });
  });
  return out.join("");
}


/* When a chapter or subsection is deleted, items placed there (or after it)
   are remapped so nothing silently drops out of the document. */
function remapPlacesAfterChapterDelete(items, ci) {
  items.forEach(it => {
    const p = String(it.place ?? it.chapter ?? "0");
    const parts = p.split(":");
    const cn = +parts[0];
    if (cn === ci) it.place = "0";
    else if (cn > ci) it.place = parts.length > 1 ? (cn - 1) + ":" + parts[1] : String(cn - 1);
    else it.place = p;
  });
}

function remapPlacesAfterSubsectionDelete(items, ci, si) {
  items.forEach(it => {
    const p = String(it.place ?? it.chapter ?? "0");
    const parts = p.split(":");
    if (+parts[0] === ci && parts.length > 1) {
      const sn = +parts[1];
      if (sn === si) it.place = String(ci);
      else if (sn > si) it.place = ci + ":" + (sn - 1);
    }
  });
}

/* Refresh the place dropdowns in the figure/table/equation lists without
   re-rendering them, so no input focus is lost. Call after any change to
   chapter/subsection structure or titles. */
function refreshPlaceSelects() {
  document.querySelectorAll("[data-fig-place]").forEach(el => { const it = S.figures[+el.dataset.figPlace]; if (it) el.innerHTML = chapterOptions(it.place); });
  document.querySelectorAll("[data-tab-ch]").forEach(el => { const it = S.tables[+el.dataset.tabCh]; if (it) el.innerHTML = chapterOptions(it.place); });
  document.querySelectorAll("[data-eq-ch]").forEach(el => { const it = S.equations[+el.dataset.eqCh]; if (it) el.innerHTML = chapterOptions(it.place); });
}

function renderChapters() {
  $("chapterList").innerHTML = S.chapters.map((ch, i) => `
    <div class="block">
      <div class="block-head"><strong>${S.kind === "article" ? "Section" : "Chapter"} ${i + 1}</strong>
        <button type="button" class="mini" data-del-ch="${i}">Remove</button></div>
      <label>Title <input type="text" value="${escHtml(ch.title)}" data-ch-title="${i}"></label>
      <label>Text <textarea rows="6" data-ch-body="${i}">${escHtml(ch.body)}</textarea></label>
      ${(ch.sections || []).map((sec, j) => `
      <div style="margin-left:18px">
        <div class="block-head"><strong>Subsection ${j + 1}</strong>
          <button type="button" class="mini" data-del-sec="${i}:${j}">Remove</button></div>
        <label>Subsection title <input type="text" value="${escHtml(sec.title)}" data-sec-title="${i}:${j}"></label>
        <label>Text <textarea rows="4" data-sec-body="${i}:${j}">${escHtml(sec.body)}</textarea></label>
      </div>`).join("")}
      <button type="button" class="mini" data-add-sec="${i}">+ Add subsection</button>
      ${S.kind !== "article" ? `<label><input type="checkbox" data-ch-app="${i}" ${ch.appendix ? "checked" : ""}> This is an appendix chapter</label>` : ""}
    </div>`).join("");
  document.querySelectorAll("[data-ch-title]").forEach(el => el.oninput = e => { S.chapters[+e.target.dataset.chTitle].title = e.target.value; refreshPlaceSelects(); });
  document.querySelectorAll("[data-ch-body]").forEach(el => el.oninput = e => { S.chapters[+e.target.dataset.chBody].body = e.target.value; });
  document.querySelectorAll("[data-ch-app]").forEach(el => el.onchange = e => { S.chapters[+e.target.dataset.chApp].appendix = e.target.checked; });
  document.querySelectorAll("[data-del-ch]").forEach(el => el.onclick = e => { const ci = +e.target.dataset.delCh; remapPlacesAfterChapterDelete(S.figures, ci); remapPlacesAfterChapterDelete(S.tables, ci); remapPlacesAfterChapterDelete(S.equations, ci); S.chapters.splice(ci, 1); if (!S.chapters.length) S.chapters.push({ title: "", body: "", appendix: false, sections: [] }); renderChapters(); refreshPlaceSelects(); });
  document.querySelectorAll("[data-sec-title]").forEach(el => el.oninput = e => { const [ci, si] = e.target.dataset.secTitle.split(":"); S.chapters[+ci].sections[+si].title = e.target.value; refreshPlaceSelects(); });
  document.querySelectorAll("[data-sec-body]").forEach(el => el.oninput = e => { const [ci, si] = e.target.dataset.secBody.split(":"); S.chapters[+ci].sections[+si].body = e.target.value; });
  document.querySelectorAll("[data-add-sec]").forEach(el => el.onclick = e => { const ci = +e.target.dataset.addSec; (S.chapters[ci].sections ||= []).push({ title: "", body: "" }); renderChapters(); refreshPlaceSelects(); });
  document.querySelectorAll("[data-del-sec]").forEach(el => el.onclick = e => { const [ci, si] = e.target.dataset.delSec.split(":"); remapPlacesAfterSubsectionDelete(S.figures, ci, si); remapPlacesAfterSubsectionDelete(S.tables, ci, si); remapPlacesAfterSubsectionDelete(S.equations, ci, si); S.chapters[+ci].sections.splice(+si, 1); renderChapters(); refreshPlaceSelects(); });
}

function renderFigures() {
  $("figureList").innerHTML = S.figures.map((f, i) => `
    <div class="block">
      <div class="block-head"><strong>${escHtml(f.file)}</strong>
        <button type="button" class="mini" data-del-fig="${i}">Remove</button></div>
      <label>Caption title (bold) <input type="text" value="${escHtml(f.capTitle || "")}" data-fig-title="${i}"></label>
      <label>Caption details / explanation <input type="text" value="${escHtml(f.capDetail || "")}" data-fig-detail="${i}"></label>
      <label>Place after <select data-fig-place="${i}">${chapterOptions(f.place)}</select></label>
    </div>`).join("") || `<p class="note">No figures yet — upload images above.</p>`;
  document.querySelectorAll("[data-fig-title]").forEach(el => el.oninput = e => { S.figures[+e.target.dataset.figTitle].capTitle = e.target.value; });
  document.querySelectorAll("[data-fig-detail]").forEach(el => el.oninput = e => { S.figures[+e.target.dataset.figDetail].capDetail = e.target.value; });
  document.querySelectorAll("[data-fig-place]").forEach(el => el.onchange = e => { S.figures[+e.target.dataset.figPlace].place = e.target.value; });
  document.querySelectorAll("[data-del-fig]").forEach(el => el.onclick = e => { S.figures.splice(+e.target.dataset.delFig, 1); renderFigures(); });
}

function renderTables() {
  $("tableList").innerHTML = S.tables.map((t, i) => {
    // Migrate older table shapes: place is a string ("c" or "c:s");
    // captions split into a bold title and an explanation detail.
    if (t.place === undefined) t.place = String(t.chapter ?? 0);
    if (t.capTitle === undefined) t.capTitle = t.caption || "";
    if (t.capDetail === undefined) t.capDetail = "";
    const cols = t.headers.length;
    return `
    <div class="block">
      <div class="block-head"><strong>Table ${i + 1}</strong>
        <button type="button" class="mini" data-del-tab="${i}">Remove</button></div>
      <label>Caption title (bold) <input type="text" value="${escHtml(t.capTitle)}" data-tab-captitle="${i}" placeholder="e.g. Summary of measurements"></label>
      <label>Caption details / explanation <input type="text" value="${escHtml(t.capDetail)}" data-tab-capdetail="${i}" placeholder="e.g. Means across three trials; see Methods for the setup."></label>
      <div class="table-dims">
        <label>Columns
          <select data-tab-cols="${i}">${[2, 3, 4, 5, 6].map(n => `<option ${n === cols ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Rows
          <input type="number" min="1" max="30" value="${t.rows.length}" data-tab-rows="${i}"></label>
      </div>
      <div class="table-grid" style="grid-template-columns: repeat(${cols}, 1fr) auto;">
        ${t.headers.map((h, j) => `<input type="text" placeholder="Header ${j + 1}" value="${escHtml(h)}" data-tab-h="${i}:${j}">`).join("")}<span></span>
        ${t.rows.map((r, ri) => r.map((c, j) => `<input type="text" placeholder="Row ${ri + 1}, col ${j + 1}" value="${escHtml(c)}" data-tab-c="${i}:${ri}:${j}">`).join("") + `<button type="button" class="mini" data-tab-delrow="${i}:${ri}" title="Remove row ${ri + 1}">×</button>`).join("")}
      </div>
      <button type="button" class="mini" data-tab-row="${i}">+ Add row</button>
      <div class="paste-area">
        <label>Paste a table (from a spreadsheet or document)
          <textarea rows="4" placeholder="Paste rows here — tabs or commas separate columns" data-tab-paste="${i}"></textarea></label>
        <label class="paste-check"><input type="checkbox" checked data-tab-paste-hdr="${i}"> First row is header</label>
        <button type="button" class="mini" data-tab-paste-btn="${i}">Fill table from pasted text</button>
      </div>
      <label>Place after <select data-tab-ch="${i}">${chapterOptions(t.place)}</select></label>
    </div>`;
  }).join("") || `<p class="note">No tables yet.</p>`;
  document.querySelectorAll("[data-tab-captitle]").forEach(el => el.oninput = e => {
    const t = S.tables[+e.target.dataset.tabCaptitle];
    t.capTitle = e.target.value;
  });
  document.querySelectorAll("[data-tab-capdetail]").forEach(el => el.oninput = e => { S.tables[+e.target.dataset.tabCapdetail].capDetail = e.target.value; });
  document.querySelectorAll("[data-tab-cols]").forEach(el => el.onchange = e => {
    const t = S.tables[+e.target.dataset.tabCols], n = +e.target.value;
    t.headers = Array.from({ length: n }, (_, j) => t.headers[j] || "");
    t.rows = t.rows.map(r => Array.from({ length: n }, (_, j) => r[j] || ""));
    renderTables();
  });
  document.querySelectorAll("[data-tab-rows]").forEach(el => el.onchange = e => {
    const t = S.tables[+e.target.dataset.tabRows];
    let n = parseInt(e.target.value, 10);
    if (Number.isNaN(n)) n = t.rows.length;
    n = Math.max(1, Math.min(30, n));
    while (t.rows.length < n) t.rows.push(Array(t.headers.length).fill(""));
    if (t.rows.length > n) t.rows.length = n;
    renderTables();
  });
  document.querySelectorAll("[data-tab-h]").forEach(el => el.oninput = e => { const [i, j] = e.target.dataset.tabH.split(":"); S.tables[+i].headers[+j] = e.target.value; });
  document.querySelectorAll("[data-tab-c]").forEach(el => el.oninput = e => { const [i, ri, j] = e.target.dataset.tabC.split(":"); S.tables[+i].rows[+ri][+j] = e.target.value; });
  document.querySelectorAll("[data-tab-row]").forEach(el => el.onclick = e => { const t = S.tables[+e.target.dataset.tabRow]; t.rows.push(Array(t.headers.length).fill("")); renderTables(); });
  document.querySelectorAll("[data-tab-delrow]").forEach(el => el.onclick = e => {
    const [i, ri] = e.target.dataset.tabDelrow.split(":");
    const t = S.tables[+i];
    t.rows.splice(+ri, 1);
    if (!t.rows.length) t.rows.push(Array(t.headers.length).fill(""));
    renderTables();
  });
  document.querySelectorAll("[data-tab-paste-btn]").forEach(el => el.onclick = e => {
    const i = +e.target.dataset.tabPasteBtn;
    const area = document.querySelector(`[data-tab-paste="${i}"]`);
    const hdr = document.querySelector(`[data-tab-paste-hdr="${i}"]`);
    const text = area ? area.value : "";
    if (!text.trim()) return;
    const parsed = parsePastedTable(text, hdr ? hdr.checked : true);
    if (!parsed.headers.length && !parsed.rows.length) return;
    S.tables[i].headers = parsed.headers;
    S.tables[i].rows = parsed.rows;
    renderTables();
  });
  document.querySelectorAll("[data-tab-ch]").forEach(el => el.onchange = e => { S.tables[+e.target.dataset.tabCh].place = e.target.value; });
  document.querySelectorAll("[data-del-tab]").forEach(el => el.onclick = e => { S.tables.splice(+e.target.dataset.delTab, 1); renderTables(); });
}

const SNIPPETS = ["\\frac{a}{b}", "\\sqrt{x}", "\\sum_{i=1}^{n}", "\\int_{a}^{b}", "\\alpha", "\\beta", "\\gamma", "\\times", "\\leq", "\\rightarrow", "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}"];

function renderEquations() {
  $("eqList").innerHTML = S.equations.map((eq, i) => `
    <div class="block">
      <div class="block-head"><strong>Equation ${i + 1}</strong>
        <button type="button" class="mini" data-del-eq="${i}">Remove</button></div>
      <div class="snippet-row">${SNIPPETS.map(s => `<button type="button" class="mini" data-snip="${i}" data-s="${escHtml(s)}">${escHtml(s)}</button>`).join("")}</div>
      <label>LaTeX math (no $ signs) <input type="text" value="${escHtml(eq.tex)}" data-eq-tex="${i}" placeholder="e.g. E = mc^2"></label>
      <label>Place after <select data-eq-ch="${i}">${chapterOptions(eq.place)}</select></label>
    </div>`).join("") || `<p class="note">No equations yet.</p>`;
  document.querySelectorAll("[data-eq-tex]").forEach(el => el.oninput = e => { S.equations[+e.target.dataset.eqTex].tex = e.target.value; });
  document.querySelectorAll("[data-eq-ch]").forEach(el => el.onchange = e => { S.equations[+e.target.dataset.eqCh].place = e.target.value; });
  document.querySelectorAll("[data-del-eq]").forEach(el => el.onclick = e => { S.equations.splice(+e.target.dataset.delEq, 1); renderEquations(); });
  document.querySelectorAll("[data-snip]").forEach(el => el.onclick = e => {
    const i = +e.target.dataset.snip;
    const input = document.querySelector(`[data-eq-tex="${i}"]`);
    input.value += e.target.dataset.s;
    S.equations[i].tex = input.value;
  });
}

/* Extra fields shown per reference type, as [field, label, placeholder].
 * Common fields (key, type, author, title, year) are always shown. */
function refExtraFields(r) {
  if (r.type === "article") return [["journal", "Journal", "e.g. Nature"], ["volume", "Volume", "e.g. 12"], ["pages", "Pages", "e.g. 123–145"]];
  if (r.type === "inproceedings") return [["booktitle", "Proceedings / book title", "e.g. Proc. ACM Conf."], ["pages", "Pages", "e.g. 123–130"]];
  if (r.type === "book") return [["publisher", "Publisher", "e.g. Oxford University Press"]];
  if (r.type === "phdthesis" || r.type === "mastersthesis") return [["school", "School", "e.g. University of Tulsa"]];
  return [];
}

function renderRefs() {
  const pasteEl = $("bibPaste");
  const savedPaste = pasteEl ? pasteEl.value : "";
  const statusEl = $("bibPasteStatus");
  const savedStatus = statusEl ? statusEl.textContent : "";
  $("refList").innerHTML = S.references.map((r, i) => `
    <div class="block">
      <div class="block-head"><strong>Reference ${i + 1}</strong>
        <button type="button" class="mini" data-del-ref="${i}">Remove</button></div>
      <div class="grid-2">
        <label>Key (for \\cite) <input type="text" value="${escHtml(r.key)}" data-ref-key="${i}" placeholder="e.g. smith2024"></label>
        <label>Type <select data-ref-type="${i}">
          <option value="article" ${r.type === "article" ? "selected" : ""}>Journal article</option>
          <option value="book" ${r.type === "book" ? "selected" : ""}>Book</option>
          <option value="inproceedings" ${r.type === "inproceedings" ? "selected" : ""}>Conference paper</option>
          <option value="phdthesis" ${r.type === "phdthesis" ? "selected" : ""}>Dissertation</option>
          <option value="mastersthesis" ${r.type === "mastersthesis" ? "selected" : ""}>Thesis</option>
        </select></label>
        <label>Author(s) <input type="text" value="${escHtml(r.author)}" data-ref-f="${i}:author"></label>
        <label>Title <input type="text" value="${escHtml(r.title)}" data-ref-f="${i}:title"></label>
        <label>Year <input type="text" value="${escHtml(r.year)}" data-ref-f="${i}:year"></label>
        ${refExtraFields(r).map(([f, label, ph]) => `<label>${label} <input type="text" value="${escHtml(r[f] || "")}" data-ref-f="${i}:${f}" placeholder="${ph}"></label>`).join("")}
      </div>
    </div>`).join("") || `<p class="note">No references yet.</p>`;
  $("refList").innerHTML += `
    <div class="block">
      <div class="block-head"><strong>Paste BibTeX</strong></div>
      <p class="note">Have a reference list already? Paste whole BibTeX entries here (from Google Scholar, a .bib file, or a reference manager) and add them all at once. Pasted entries appear as normal rows below, which you can still edit.</p>
      <label>Paste BibTeX entries <textarea id="bibPaste" rows="6" placeholder="@article{smith2024,&#10;  author = {Smith, J.},&#10;  title = {A Paper},&#10;  journal = {J. Testing},&#10;  year = {2024}&#10;}"></textarea></label>
      <button type="button" id="addPasted">Add pasted references</button>
      <p class="note" id="bibPasteStatus"></p>
    </div>`;
  document.querySelectorAll("[data-ref-key]").forEach(el => el.oninput = e => { S.references[+e.target.dataset.refKey].key = e.target.value; });
  document.querySelectorAll("[data-ref-type]").forEach(el => el.onchange = e => { S.references[+e.target.dataset.refType].type = e.target.value; renderRefs(); });
  document.querySelectorAll("[data-ref-f]").forEach(el => el.oninput = e => { const [i, f] = e.target.dataset.refF.split(":"); S.references[+i][f] = e.target.value; });
  document.querySelectorAll("[data-del-ref]").forEach(el => el.onclick = e => { S.references.splice(+e.target.dataset.delRef, 1); renderRefs(); });
  $("bibPaste").value = savedPaste;
  $("bibPasteStatus").textContent = savedStatus;
  $("addPasted").onclick = () => {
    const parsed = parseBibtex($("bibPaste").value);
    S.references.push(...parsed);
    if (parsed.length) $("bibPaste").value = "";
    $("bibPasteStatus").textContent = "Added " + parsed.length + " references (" + (parsed.skipped || 0) + " skipped).";
    renderRefs();
  };
}

function refreshReview() {
  readForm();
  const { mainTex, files } = buildProject(S);
  $("texPreview").textContent = mainTex;
  $("fileList").textContent = "Your .zip will contain: " + files.map(f => f.path).join(", ") + ".";
}

function goto(n) {
  readForm();
  step = Math.max(1, Math.min(7, n));
  renderSteps();
}

function init() {
  document.querySelectorAll("[data-kind]").forEach(btn => btn.onclick = () => {
    S.kind = btn.dataset.kind;
    document.querySelectorAll("[data-kind]").forEach(b => b.classList.toggle("selected", b === btn));
    if (S.kind === "thesis") S.degree = S.degree || "Master of Science";
    if (S.kind === "dissertation") S.degree = "Doctor of Philosophy";
    syncTemplateSelect();
    renderSteps();
    refreshPlaceSelects();
  });
  document.querySelector("[data-kind='thesis']").classList.add("selected");
  $("templateSelect").onchange = e => { S.templateId = e.target.value; syncTemplateSelect(); renderSteps(); };
  $("stepNav").onclick = e => { const b = e.target.closest("[data-goto]"); if (b) goto(+b.dataset.goto); };
  $("prevBtn").onclick = () => goto(step - 1);
  $("nextBtn").onclick = () => { if (step < 7) goto(step + 1); };
  $("addChapter").onclick = () => { S.chapters.push({ title: "", body: "", appendix: false, sections: [] }); renderChapters(); refreshPlaceSelects(); };
  $("addTable").onclick = () => { S.tables.push({ id: ++tabCounter, capTitle: "", capDetail: "", headers: ["", ""], rows: [["", ""]], place: "0" }); renderTables(); };
  $("addEq").onclick = () => { S.equations.push({ id: ++eqCounter, tex: "", place: "0" }); renderEquations(); };
  $("addRef").onclick = () => { S.references.push({ key: "", type: "article", author: "", title: "", year: "", journal: "", volume: "", pages: "", booktitle: "", publisher: "", school: "" }); renderRefs(); };
  $("figUpload").onchange = async e => {
    for (const file of e.target.files) {
      const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
      figCounter++;
      S.figures.push({ id: figCounter, file: "fig" + figCounter + "." + ext, dataUrl, capTitle: "", capDetail: "", place: "0" });
    }
    e.target.value = "";
    renderFigures();
  };
  $("f-abstract").oninput = () => {
    const w = wordCount($("f-abstract").value);
    let hint = w + " words";
    if (S.templateId === "tu") hint += S.kind === "dissertation" ? " (dissertation limit: 350)" : " (thesis limit: 150)";
    $("abstractCount").textContent = hint;
  };
  $("downloadZip").onclick = async () => {
    readForm();
    const { files } = buildProject(S);
    if (typeof JSZip === "undefined") { alert("The zip library did not load — check your connection and try again."); return; }
    const zip = new JSZip();
    for (const f of files) {
      if (f.base64 !== undefined) zip.file(f.path, f.base64, { base64: true });
      else zip.file(f.path, f.text);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scholarly-creator-" + S.templateId + ".zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $("copyTex").onclick = async () => {
    readForm();
    const { mainTex } = buildProject(S);
    try { await navigator.clipboard.writeText(mainTex); $("copyTex").textContent = "Copied!"; setTimeout(() => $("copyTex").textContent = "Copy main.tex", 2000); }
    catch (_) { alert("Copy was blocked — select the text in the preview instead."); }
  };
  syncTemplateSelect();
  renderChapters();
  renderFigures();
  renderTables();
  renderEquations();
  renderRefs();
  renderSteps();
}

document.addEventListener("DOMContentLoaded", init);
