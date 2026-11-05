"use strict";
/*
 * Guideline profiles.
 *
 * Every profile carries a `verified` flag. Built-in values are widely used
 * starting points, NOT official figures — thesis guides are revised every
 * few years and schools within a university differ. Values move to
 * verified: true only after being checked against the school's current
 * official guide (record the guide year in `source` when you do).
 *
 * Units: margins and page size in inches, sizes in points, line spacing as
 * a multiple (1 = single, 1.5, 2 = double).
 *
 * Adding a school = adding one entry here. Nothing else changes.
 */
const PROFILES = [
  {
    id: "generic-us",
    school: "Generic US defaults",
    verified: false,
    note: "The most common US graduate-school defaults. Confirm against your own guide, or use Custom rules below.",
    rules: {
      pageSize: { name: "Letter", widthIn: 8.5, heightIn: 11 },
      marginsIn: { top: 1, right: 1, bottom: 1, left: 1 },
      marginToleranceIn: 0.06,
      lineSpacing: 2.0,
      lineSpacingTolerance: 0.15,
      bodyFonts: ["Times New Roman"],
      bodySizePt: 12,
      headingFontSameAsBody: true,
      requireHeadingStyles: true,
      pageNumbers: { location: "either", alignment: "either" } // location: header | footer | either ; alignment: center | right | either
    },
    docTypes: {
      thesis: {
        label: "Master's thesis",
        requiredParts: ["Title Page", "Abstract", "Table of Contents", "References"]
      },
      dissertation: {
        label: "Doctoral dissertation",
        requiredParts: ["Title Page", "Abstract", "Table of Contents", "References"]
      }
    }
  },
  {
    id: "university-of-tulsa",
    school: "University of Tulsa — Graduate School",
    verified: true,
    note: "Read from the Graduate School's official Thesis and Dissertation Word template, version 2022 (the template file itself: page setup, styles, and its Chapter 6 format examples), and confirmed line by line against TU's official LaTeX package (TUthesis_2026.sty and TUthesis.tex: 12 pt report class on letterpaper, setspace double spacing, margins set to 1 inch all the way around, roman-to-Arabic page numbering, list pages switched on only when the document has tables/figures; its sample runs Copyright iii, Abstract iv, Acknowledgements v, Table of Contents vii, List of Tables viii, List of Figures ix, then the body from Arabic page 1, Bibliography, Appendices) — the official sources agree. Letter paper, 1-inch margins, Times New Roman 12, double spacing. Preliminary pages are numbered with lowercase roman numerals in the footer and the body restarts at Arabic 1; the checker verifies both the page-number field and this numbering scheme from the document's section settings. A List of Tables / List of Figures is judged only when the document actually contains tables / figures. Abstract word limits verified in the Graduate Bulletin (current catalog): 150 words for a thesis, 350 for a dissertation. TU headings follow a direct-format spec rather than Word's Heading styles: 1.1 subsections centered, single-spaced, bold; 1.1.1 left-justified, single-spaced, italic; 1.1.1.1 left-justified, double-spaced, italic, run into the paragraph. When a TU document does use Word's Heading 2/3/4 styles, those formats are checked against the same spec.",
    rules: {
      pageSize: { name: "Letter", widthIn: 8.5, heightIn: 11 },
      marginsIn: { top: 1, right: 1, bottom: 1, left: 1 },
      marginToleranceIn: 0.06,
      lineSpacing: 2.0,
      lineSpacingTolerance: 0.15,
      bodyFonts: ["Times New Roman"],
      bodySizePt: 12,
      headingFontSameAsBody: true,
      requireHeadingStyles: false,
      pageNumbers: { location: "footer", alignment: "either" },
      pageNumbering: { preliminaryFmt: "lowerRoman", bodyStart: 1 },
      headingFormats: {
        2: { jc: "center", bold: true, italic: false, line: 1 },
        3: { jc: "left", bold: false, italic: true, line: 1 },
        4: { jc: "left", bold: false, italic: true, line: 2 }
      }
    },
    docTypes: {
      thesis: {
        label: "Master's thesis",
        requiredParts: ["Title Page", "Copyright", "Acknowledgements", "Abstract", "Table of Contents", "Bibliography"],
        conditionalParts: [
          { name: "List of Tables", when: "tables" },
          { name: "List of Figures", when: "figures" }
        ],
        abstractWordLimit: 150
      },
      dissertation: {
        label: "Doctoral dissertation",
        requiredParts: ["Title Page", "Copyright", "Acknowledgements", "Abstract", "Table of Contents", "Bibliography"],
        conditionalParts: [
          { name: "List of Tables", when: "tables" },
          { name: "List of Figures", when: "figures" }
        ],
        abstractWordLimit: 350
      }
    }
  },
  {
    id: "custom",
    school: "Custom rules",
    verified: true,
    note: "Uses the values typed into the Custom rules panel below — taken straight from your own guide.",
    rules: null, // built from the form at check time (see app.js)
    docTypes: {
      thesis: {
        label: "Master's thesis",
        requiredParts: ["Title Page", "Abstract", "Table of Contents", "References"]
      },
      dissertation: {
        label: "Doctoral dissertation",
        requiredParts: ["Title Page", "Abstract", "Table of Contents", "References"]
      }
    }
  }
];

/* Word menu paths used in the "how to fix" column. */
const FIX = {
  margins: "Layout ▸ Margins ▸ Custom Margins",
  pageSize: "Layout ▸ Size",
  lineSpacing: "Select the text ▸ Home ▸ Paragraph dialog ▸ Line spacing",
  bodyFont: "Select the text ▸ Home ▸ Font / Font size",
  headingStyles: "Click the title ▸ Home ▸ Styles ▸ Heading 1 / 2 / 3",
  headingFont: "Home ▸ Styles ▸ right-click the heading style ▸ Modify ▸ Font",
  pageNumbers: "Insert ▸ Page Number",
  pageNumbering: "Click into the section ▸ Insert ▸ Page Number ▸ Format Page Numbers ▸ Number format / Start at",
  frontMatter: "Add the missing part as its own section, titled with a Heading 1",
  abstractWord: "Edit ▸ Word Count (status bar) shows the total — shorten the Abstract text to fit the limit",
  frontMatterOrder: "Move the out-of-order section so the front matter follows the school's sequence",
  tocEntries: "Right-click the table of contents ▸ Update Field ▸ Update entire table",
  listEntries: "Right-click the list ▸ Update Field ▸ Update entire table",
  captions: "Click the table or figure ▸ References ▸ Insert Caption",
  fontsUsed: "Select the text ▸ Home ▸ Font",
  citations: "Check each flagged citation against the Bibliography — add the missing entry or fix the name and year",
  bibliographyOrder: "Sort the Bibliography entries alphabetically by first author's surname",
  tableWidth: "Click the table ▸ Table Layout ▸ AutoFit ▸ AutoFit to Window, or narrow the columns"
};
