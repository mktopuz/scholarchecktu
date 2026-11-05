"use strict";
/* UI wiring: file intake, rule selection, report rendering, CSV export,
   and the optional AI review. All state lives in this tab only. */

const $ = (id) => document.getElementById(id);
let currentFile = null;
let lastResults = null;
let lastModel = null;
let lastMeta = null;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- rule selection ---------- */

const USER_PROFILES_KEY = "tfc_user_profiles";
let userProfiles = loadUserProfiles();

function loadUserProfiles() {
  try {
    const v = JSON.parse(localStorage.getItem(USER_PROFILES_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function persistUserProfiles() {
  localStorage.setItem(USER_PROFILES_KEY, JSON.stringify(userProfiles));
}
function allProfiles() { return PROFILES.concat(userProfiles); }

function renderSchoolOptions(selectId) {
  const sel = $("schoolSelect");
  sel.innerHTML = allProfiles().map((p) => {
    const tag = p.userDefined ? " (your saved guidelines)" : p.verified ? "" : " (values unverified)";
    return "<option value=\"" + esc(p.id) + "\">" + esc(p.school) + tag + "</option>";
  }).join("");
  if (selectId && allProfiles().some((p) => p.id === selectId)) sel.value = selectId;
  updateProfileNote();
}
function initProfiles() {
  $("schoolSelect").addEventListener("change", updateProfileNote);
  renderSchoolOptions();
  renderSavedSchools();
}
function currentProfile() {
  return allProfiles().find((p) => p.id === $("schoolSelect").value) || PROFILES[0];
}
function updateProfileNote() {
  const p = currentProfile();
  $("profileNote").textContent = p.note || "";
  $("customRulesBox").open = p.id === "custom";
}
function customRules() {
  const num = (id) => parseFloat($(id).value) || 0;
  return {
    pageSize: { name: "Letter", widthIn: 8.5, heightIn: 11 },
    marginsIn: {
      top: num("cr-marginTop"), right: num("cr-marginRight"),
      bottom: num("cr-marginBottom"), left: num("cr-marginLeft")
    },
    marginToleranceIn: 0.06,
    lineSpacing: parseFloat($("cr-lineSpacing").value),
    lineSpacingTolerance: 0.15,
    bodyFonts: [$("cr-bodyFont").value],
    bodySizePt: num("cr-bodySize"),
    headingFontSameAsBody: true,
    requireHeadingStyles: true,
    pageNumbers: { location: $("cr-pageNumLoc").value, alignment: $("cr-pageNumAlign").value }
  };
}
function currentRulesAndType() {
  const p = currentProfile();
  const typeKey = $("docTypeSelect").value;
  const rules = p.id === "custom" ? customRules() : p.rules;
  const baseType = p.docTypes[typeKey] || p.docTypes.thesis;
  /* The custom-rules abstract limit lives on the doc type (it is per
     document type in profiles), so it is attached to a copy here. */
  const docType = p.id === "custom"
    ? Object.assign({}, baseType, { abstractWordLimit: parseInt($("cr-abstractLimit").value, 10) || null })
    : baseType;
  return { profile: p, rules, docType, typeKey };
}

/* ---------- file intake ---------- */

function initFileIntake() {
  const dz = $("dropzone");
  const input = $("fileInput");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setFile(f);
  });
  input.addEventListener("change", () => { if (input.files[0]) setFile(input.files[0]); });
}
function setFile(f) {
  if (!/\.docx$/i.test(f.name)) {
    $("fileInfo").hidden = false;
    $("fileInfo").textContent = "“" + f.name + "” is not a .docx file. Old .doc and PDF files cannot be checked — open the document in Word and use File ▸ Save As ▸ Word Document (.docx) first.";
    currentFile = null;
    $("checkBtn").disabled = true;
    return;
  }
  currentFile = f;
  $("fileInfo").hidden = false;
  $("fileInfo").textContent = "Selected: " + f.name + " (" + (f.size / 1024).toFixed(0) + " KB). It will be read here in the tab — nothing is uploaded.";
  $("checkBtn").disabled = false;
}

/* ---------- checking ---------- */

async function doCheck() {
  if (!currentFile) return;
  const { profile, rules, docType, typeKey } = currentRulesAndType();
  $("checkStatus").textContent = "Reading the document…";
  $("checkBtn").disabled = true;
  try {
    const model = await parseDocx(currentFile);
    const { results, stats, score } = runChecks(model, rules, docType);
    lastModel = model;
    lastResults = results;
    lastMeta = {
      file: currentFile.name,
      school: profile.school + (profile.id === "custom" ? "" : profile.verified ? "" : " (built-in values, unverified)"),
      docType: docType.label,
      stats,
      score
    };
    renderReport();
    $("checkStatus").textContent = "Done. The document was checked in this tab only.";
    $("reportCard").hidden = false;
    $("reportCard").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    $("checkStatus").textContent = "Could not check this file: " + err.message;
  } finally {
    $("checkBtn").disabled = false;
  }
}

function renderReport() {
  const counts = { pass: 0, fail: 0, warn: 0, info: 0 };
  for (const r of lastResults) counts[r.status] = (counts[r.status] || 0) + 1;
  $("reportMeta").textContent =
    lastMeta.file + " · " + lastMeta.school + " · " + lastMeta.docType + " · " +
    lastMeta.stats.paragraphs + " paragraphs, about " + lastMeta.stats.words.toLocaleString() + " words, " +
    lastMeta.stats.sections + " section(s). Checked " + new Date().toLocaleString() + ".";
  $("reportSummary").innerHTML =
    (lastMeta.score ? "<span class=\"score\">Score: <strong>" + lastMeta.score.value + "/100</strong> — " + esc(lastMeta.score.band) + "</span>" + (lastMeta.score.capped ? " <span class=\"capnote\">" + esc(lastMeta.score.capNote) + "</span>" : "") + " · " : "") +
    "<strong>" + counts.fail + "</strong> to fix · <strong>" + counts.warn + "</strong> to review · " +
    "<strong>" + counts.pass + "</strong> passing" + (counts.info ? " · " + counts.info + " informational" : "");
  const label = { pass: "✓ Pass", fail: "✗ Fix", warn: "! Review", info: "i Info" };
  $("reportResults").innerHTML =
    "<table class=\"results\"><thead><tr><th>Check</th><th>Status</th><th>Expected</th><th>Found</th><th>Where / how to fix</th></tr></thead><tbody>" +
    lastResults.map((r) =>
      "<tr><td>" + esc(r.label) + "</td>" +
      "<td class=\"status " + r.status + "\">" + label[r.status] + "</td>" +
      "<td>" + esc(r.expected) + "</td><td>" + esc(r.found) + "</td>" +
      "<td><span class=\"where\">" + esc(r.where) + "</span>" +
      (r.fix && r.fix !== "—" ? "<br><span class=\"fix\">Fix: " + esc(r.fix) + "</span>" : "") + "</td></tr>"
    ).join("") + "</tbody></table>";
}

/* ---------- export ---------- */

function downloadCsv() {
  if (!lastResults) return;
  const cell = (s) => "\"" + String(s == null ? "" : s).replace(/"/g, "\"\"") + "\"";
  const lines = [
    ["Check", "Status", "Expected", "Found", "Where", "How to fix"].map(cell).join(","),
    ["# " + lastMeta.file + " — " + lastMeta.school + " — " + lastMeta.docType].map(cell).join(","),
    ["# Score: " + (lastMeta.score ? lastMeta.score.value + "/100 — " + lastMeta.score.band + (lastMeta.score.capped ? " — " + lastMeta.score.capNote : "") : "n/a")].map(cell).join(",")
  ];
  for (const r of lastResults) lines.push([r.label, r.status, r.expected, r.found, r.where, r.fix].map(cell).join(","));
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "format-report.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- AI review ---------- */

function initAI() {
  const s = aiLoadSettings();
  $("aiBaseUrl").value = s.baseUrl;
  $("aiModel").value = s.model;
  $("aiKey").value = s.key;
  const save = () => aiSaveSettings({
    baseUrl: $("aiBaseUrl").value.trim(),
    model: $("aiModel").value.trim(),
    key: $("aiKey").value.trim()
  });
  ["aiBaseUrl", "aiModel", "aiKey"].forEach((id) => $(id).addEventListener("change", save));
  $("aiBtn").addEventListener("click", doAIReview);
}
async function doAIReview() {
  const settings = {
    baseUrl: $("aiBaseUrl").value.trim(),
    model: $("aiModel").value.trim(),
    key: $("aiKey").value.trim()
  };
  aiSaveSettings(settings);
  if (!lastModel || !lastResults) {
    $("aiStatus").textContent = "Run the format check first — the AI review builds on its results.";
    return;
  }
  if (!settings.key) {
    $("aiStatus").textContent = "Add your API key in AI settings above first. The key never leaves this device except to call your provider.";
    $("aiSettings").open = true;
    return;
  }
  $("aiBtn").disabled = true;
  $("aiStatus").textContent = "Sending text excerpts (not the file) to " + settings.baseUrl + " …";
  try {
    const items = await runAIReview(settings, extractForAI(lastModel), lastResults);
    $("aiStatus").textContent = items.length
      ? "AI review finished. Treat these as a second pair of eyes, not verdicts:"
      : "AI review finished — nothing irregular spotted in the excerpts.";
    $("aiResults").innerHTML = items.map((it) =>
      "<div class=\"ai-item\"><div class=\"ai-issue\">" + esc(it.issue) + "</div>" +
      (it.evidence ? "<div class=\"ai-evidence\">Evidence: “" + esc(it.evidence) + "”</div>" : "") +
      (it.suggestion ? "<div>" + esc(it.suggestion) + "</div>" : "") + "</div>"
    ).join("");
  } catch (err) {
    $("aiStatus").textContent = "AI review failed: " + err.message;
  } finally {
    $("aiBtn").disabled = false;
  }
}

/* ---------- saved school guidelines ---------- */

function rulesFromFields(prefix) {
  const num = (id) => parseFloat($(id).value) || 0;
  return {
    pageSize: { name: "Letter", widthIn: 8.5, heightIn: 11 },
    marginsIn: {
      top: num(prefix + "marginTop"), right: num(prefix + "marginRight"),
      bottom: num(prefix + "marginBottom"), left: num(prefix + "marginLeft")
    },
    marginToleranceIn: 0.06,
    lineSpacing: parseFloat($(prefix + "lineSpacing").value),
    lineSpacingTolerance: 0.15,
    bodyFonts: [$(prefix + "bodyFont").value.trim() || "Times New Roman"],
    bodySizePt: num(prefix + "bodySize"),
    headingFontSameAsBody: true,
    requireHeadingStyles: true,
    pageNumbers: { location: $(prefix + "pageNumLoc").value, alignment: $(prefix + "pageNumAlign").value }
  };
}
function slugify(name) {
  return "user:" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function saveSchool() {
  const name = $("ns-name").value.trim();
  if (!name) { $("nsStatus").textContent = "Give the school a name first."; return; }
  const applies = $("ns-applies").value;
  const parts = $("ns-requiredParts").value.split(",").map((s) => s.trim()).filter(Boolean);
  const absLim = parseInt($("ns-abstractLimit").value, 10) || null;
  const dt = (label) => {
    const d = { label, requiredParts: parts.length ? parts : ["Abstract", "Table of Contents", "References"] };
    if (absLim) d.abstractWordLimit = absLim;
    return d;
  };
  const profile = {
    id: slugify(name),
    school: name,
    verified: true,
    userDefined: true,
    note: "Guidelines you entered from the school's guide" +
      (applies === "both" ? "." : applies === "thesis" ? " — entered for the master's thesis." : " — entered for the doctoral dissertation."),
    rules: rulesFromFields("ns-"),
    docTypes: { thesis: dt("Master's thesis"), dissertation: dt("Doctoral dissertation") }
  };
  const existing = userProfiles.findIndex((p) => p.id === profile.id);
  if (existing >= 0) userProfiles[existing] = profile; else userProfiles.push(profile);
  persistUserProfiles();
  renderSchoolOptions(profile.id);
  renderSavedSchools();
  $("nsStatus").textContent = "Saved. “" + name + "” is now in the School list above and selected.";
}
function deleteSchool(id) {
  userProfiles = userProfiles.filter((p) => p.id !== id);
  persistUserProfiles();
  renderSchoolOptions();
  renderSavedSchools();
  $("nsStatus").textContent = "Removed.";
}
function renderSavedSchools() {
  const box = $("nsList");
  if (!userProfiles.length) { box.innerHTML = ""; return; }
  box.innerHTML = "<p class=\"note\">Your saved schools:</p>" + userProfiles.map((p) =>
    "<p class=\"note\">• " + esc(p.school) +
    " <button type=\"button\" data-del=\"" + esc(p.id) + "\">Delete</button></p>"
  ).join("");
  box.querySelectorAll("button[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteSchool(b.getAttribute("data-del"))));
}
function exportSchools() {
  if (!userProfiles.length) { $("nsStatus").textContent = "No saved schools to export yet."; return; }
  const blob = new Blob([JSON.stringify(userProfiles, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "school-guidelines.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
function importSchools(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const arr = JSON.parse(String(reader.result));
      if (!Array.isArray(arr)) throw new Error("not a list");
      let added = 0;
      for (const p of arr) {
        if (!p || !p.school || !p.rules || !p.rules.marginsIn) continue;
        p.id = p.id && String(p.id).startsWith("user:") ? p.id : slugify(p.school);
        p.userDefined = true;
        p.verified = true;
        if (!p.docTypes) p.docTypes = {
          thesis: { label: "Master's thesis", requiredParts: ["Abstract", "Table of Contents", "References"] },
          dissertation: { label: "Doctoral dissertation", requiredParts: ["Abstract", "Table of Contents", "References"] }
        };
        const ix = userProfiles.findIndex((x) => x.id === p.id);
        if (ix >= 0) userProfiles[ix] = p; else userProfiles.push(p);
        added++;
      }
      persistUserProfiles();
      renderSchoolOptions();
      renderSavedSchools();
      $("nsStatus").textContent = added ? "Imported " + added + " school guideline set(s)." : "No valid school guidelines found in that file.";
    } catch (e) {
      $("nsStatus").textContent = "That file could not be read as school guidelines JSON.";
    }
  };
  reader.readAsText(file);
}
function initSchoolManager() {
  $("nsSaveBtn").addEventListener("click", saveSchool);
  $("nsExportBtn").addEventListener("click", exportSchools);
  $("nsImportBtn").addEventListener("click", () => $("nsImportFile").click());
  $("nsImportFile").addEventListener("change", (e) => { if (e.target.files[0]) importSchools(e.target.files[0]); });
}

/* ---------- boot ---------- */

document.addEventListener("DOMContentLoaded", () => {
  initProfiles();
  initSchoolManager();
  initFileIntake();
  initAI();
  $("checkBtn").addEventListener("click", doCheck);
  $("csvBtn").addEventListener("click", downloadCsv);
  $("printBtn").addEventListener("click", () => window.print());
});
