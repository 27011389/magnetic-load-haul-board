# Company Manual Template Contract

## Reference

- Source: `C:\Users\mark.pepere\Downloads\Lightning and Storm Events Procedure_V2.docx`
- SHA-256: `c568328e382c48b572e98a50d36027384f97c97e6f05531c6e3fd5e11b0c51b6`
- Sections: 1
- Distinct page patterns: first page and subsequent pages
- Evidence: `tmp/company-template/style-evidence.json` plus section, heading, image, field, and package audits completed on 4 August 2026
- The source is read-only and must remain unchanged

## Page System

- A4 portrait: 8.27 x 11.69 inches
- Margins: left 0.75, right 0.75, top 1.00, bottom 0.89 inches
- Header distance: 0.236 inches
- Footer distance: 0 inches
- Different first-page header and footer enabled
- No additional section breaks are required for the shiftboard manual

## Recurring Components

- First-page header: full-width red/black ConsMin banner with department and document title
- Subsequent header: ConsMin logo at left with department and document title at right
- First and subsequent footer: red `UNCONTROLLED once printed` notice and a 6-column document-control table
- Footer fields: Document Number, Revision, Date, Authored / Updated by, Approved by, and Page
- PAGE and NUMPAGES fields must remain intact

## Typography and Structure

- Body copy uses the source's Arial-based visual system
- Primary headings use `ConsMin Heading 1`
- Secondary headings use `ConsMin Heading 2`
- Lists reuse the source numbering/list definitions where compatible
- Use title case for the document title and sentence case for body copy
- Use active voice, named roles, short sentences, and restrained colour in accordance with the BMS Writer's Guide

## Editable Slots

- `word/header1.xml`: replace the source document title and department label with the shiftboard title and `Mining Operations`
- `word/header2.xml`: replace the split first-page title and department label with the shiftboard title and `Mining Operations`
- First and default footer control rows: set Document Number=`TBC`, Revision=`Draft 1`, Date=`Aug-26`, Authored / Updated by=`Mark Pepere`, Approved by=`Pending`; preserve Page fields
- `word/document.xml`: remove the source procedure body and replace it with the complete shiftboard manual
- Preserve header/footer drawings, media, relationships, page fields, page geometry, styles, theme, and numbering definitions

## Content Flow

1. First-page title and document information
2. Contents
3. Purpose and operating principles
4. Mine 2, Mine 3, and Control operating model
5. Board layout and figures
6. Shift setup and magnet procedures
7. Crew, fleet, pit, and park-up procedures
8. Controls, handover, and troubleshooting
9. Checklists, support information, and terms and definitions

## Fidelity Gates

- Reference SHA-256 remains unchanged
- A4 geometry, margins, and first-page behavior match the reference
- Both source-derived headers and footers remain present
- Header artwork and footer control table remain linked and intact
- PAGE and NUMPAGES fields remain present
- Document body contains no source lightning-procedure content
- Final accessibility audit returns no high, medium, or low findings
- Visual render comparison is required when LibreOffice or Microsoft Word rendering becomes available
