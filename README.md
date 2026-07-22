# Load & Haul Shiftboard

Production handover package — version 1.0.4, 22 July 2026.

This application is a live browser version of the ConsMin Load and Haul
shiftboard. It replaces physical magnets with draggable digital magnets while
keeping the familiar day shift, night shift, R + R, park-up and workshop layout.

This README is the primary technical handover document for ICT. It covers the
application's purpose, architecture, setup, data storage, deployment,
maintenance, backup, security and troubleshooting.

## 1. Handover status

The supplied source is a clean, reproducible project. It does not include build
outputs, package caches, installed dependencies, temporary files, credentials,
or a copy of the live operational database.

At handover:

- the application passes lint, automated rendering tests and a production build;
- dependencies are pinned by `package-lock.json`;
- the database migration is included;
- the ConsMin logo and favicon are included;
- unused starter files, example code and unreferenced helpers have been removed;
- the source has no OpenAI Sites configuration or runtime dependency;
- the source is ready to place in an ICT-managed Git repository.

The codebase is intentionally small. The application is primarily one React
page, one stylesheet, one starting-data file and one API route.

## 2. Main features

- Drag-and-drop magnets for trucks, excavators, dozers, graders, water carts,
  loaders, light vehicles, support vehicles, people, locations and notes.
- Operators attach to nearby equipment and move with it.
- Equipment and operator magnets automatically fit their text with consistent
  responsive padding, without clipping longer names.
- Collision protection prevents magnets from overlapping.
- Searchable magnet rack plus custom magnet creation and editing.
- Board lock, 10 px snapping, keyboard positioning and reset controls.
- Undo history for the last 20 board changes.
- Search and unassigned-operator warnings.
- Day/night truck allocation totals and park-up totals.
- Fixed go-line, shut-pad, workshop and standby allocation bays.
- Shift/date/note editing and day/night allocation copying.
- Full-screen and fitted TV modes.
- Shared D1 storage with automatic four-second refresh.
- Last-moved indication and saved starting-layout support.

## 3. Technology summary

| Area | Technology | Purpose |
| --- | --- | --- |
| User interface | React 19 + TypeScript | Board, controls and drag interactions |
| Application framework | Next-compatible App Router via Vinext | Page, metadata and API route |
| Build tooling | Vite + Vinext | Local server and Cloudflare Worker build |
| Styling | Tailwind/PostCSS pipeline plus custom CSS | Reset/build pipeline and board styling |
| Runtime | Cloudflare Worker-compatible environment | Serves the application and API |
| Database | Cloudflare D1 (SQLite) | Stores the shared board state |
| Schema tooling | Drizzle | Version-controlled schema and migration |
| Quality checks | ESLint + Node test runner | Static checks and rendered HTML test |

Required Node.js version: **22.13.0 or newer**.

## 4. Architecture and data flow

The browser loads the board from `GET /api/board`. A completed move or edit is
saved using `PUT /api/board`. Other open browsers poll the API every four
seconds when they are not dragging or editing a magnet.

```text
Browser / TV
    |
    | GET and PUT /api/board
    v
App Router API route
    |
    | SQL through the DB binding
    v
Cloudflare D1: magnetic_boards
```

The database deliberately uses a simple single-board model:

| Column | Meaning |
| --- | --- |
| `id` | Board identifier. The application currently uses `1`. |
| `payload` | JSON containing every magnet, link, position and board setting. |
| `version` | Increments after each successful save. |
| `updated_at` | ISO timestamp of the last save. |

The application currently uses last-write-wins saving. It is suitable for a
small Mine Control team, but it is not a transaction-heavy multi-user planning
system. Two people moving items at exactly the same time can overwrite one
another's most recent change.

## 5. Project structure

```text
app/
  api/board/route.ts   Shared board GET/PUT API and defensive table creation
  board-data.ts        Magnet types, inventory, dimensions and default layout
  globals.css          Complete visual layout, responsive and TV styling
  layout.tsx           Page metadata, fonts and favicon
  page.tsx             Board UI, drag/link/collision logic and controls
db/
  schema.ts            Drizzle representation of the D1 table
drizzle/               Version-controlled SQL migration and metadata
public/
  ConsminLogo.png      Header artwork
  favicon.svg          Browser icon
scripts/               Reproducible install, build and artifact checks
tests/                 Production-render smoke test
worker/index.ts        Cloudflare Worker entry point
package.json           Commands and dependency versions
vite.config.ts         Local Worker/D1 and Vite configuration
```

## 6. First-time setup

### Recommended ICT environment

- Node.js 22.13 or newer
- npm supplied with Node.js
- Git
- VS Code or another TypeScript editor
- Windows, Linux or macOS. The project commands are cross-platform Node/npm
  commands and can run directly from PowerShell, Terminal or a CI runner.

### Install and run locally

From the project root:

```bash
npm ci
npm run dev
```

Open the address printed by Vite, normally `http://localhost:5173`.

Local development creates project-local D1 state under `.wrangler/`. That
folder is intentionally ignored and is not part of the source handover.

### Share on the same trusted network

```bash
npm run dev -- --host 0.0.0.0
```

On the host computer, run `ipconfig` on Windows or `ip addr` on Linux. Another
device on the same network can open:

```text
http://HOST-IP-ADDRESS:5173
```

This is suitable for testing only. The terminal and host computer must remain
running, there is no production process supervision, and access is not
authenticated by the development server.

## 7. Quality and release commands

```bash
npm run lint
npm test
npm run build
npm run validate:artifact
```

`npm test` performs a production build before running the rendered HTML smoke
test. A successful production build is written to `dist/`; this folder is
generated and should not be committed or included in source archives.

For a clean ICT verification:

1. Extract or clone the source into a new folder.
2. Run `npm ci`.
3. Run `npm run lint`.
4. Run `npm test`.
5. Confirm all commands exit successfully before deployment.

## 8. Deployment and hosting

The project targets a Cloudflare Worker-compatible host with a D1 database
binding named **`DB`**. Local development defines this binding directly in
`vite.config.ts`; no `.openai` directory is required.

The source archive contains no deployment credentials and is not tied to an ICT
employee's personal account. ICT should:

1. place the source in a company-owned Git repository;
2. create or adopt a company-owned Cloudflare Worker project;
3. create or attach a D1 database;
4. expose that database to the application as the binding `DB`;
5. apply `drizzle/0000_unknown_hedge_knight.sql` to the production D1 database;
6. deploy only after `npm test` passes;
7. publish the application behind the approved company URL and access controls.

The API also creates the current table with `CREATE TABLE IF NOT EXISTS` as a
defensive fallback. Formal schema changes must still be committed as a new
Drizzle migration.

### TV setup

- Use a 16:9 display at 1920 × 1080 where possible.
- Set browser zoom to 100%.
- Disable television overscan or enable “Just Scan”, “Screen Fit” or an
  equivalent setting.
- Open **TV View** in the application. It scales the complete 1880 × 918 board
  to the available browser viewport without scrolling.
- Use **Full Screen** if browser chrome is still visible.

## 9. Access and security notes

The application does not currently implement its own login, roles or
permissions. It expects hosting, a reverse proxy or the corporate platform to
control access. The board currently records the last editor as `MINE CONTROL`.

Before production use, ICT should:

- put the URL behind company SSO or another approved access layer;
- restrict access to the required operations group;
- restrict direct access to the D1 database;
- keep deployment credentials out of the repository;
- review application and platform logs for failed API requests;
- document the business owner and technical support owner.

Do not expose `npm run dev -- --host 0.0.0.0` to an untrusted or public network.

## 10. Backup, restore and data ownership

There are two different sources of board data:

- `app/board-data.ts` is the default seed used for a new or incompatible board.
- D1 is the operational shared board and contains subsequent live changes.

Changing `app/board-data.ts` does not overwrite an existing D1 board. Use the
application's **Save Start** feature to make the current arrangement the reset
layout, or perform a controlled database change after taking a backup.

### Backup

Use the hosting platform's supported D1 export or backup facility to export the
`magnetic_boards` table. At minimum, preserve the row where `id = 1`, including
its `payload`, `version` and `updated_at` values.

Recommended policy:

- automatic daily backup;
- retain at least 30 days, subject to ICT policy;
- take a manual export before a release or layout-version change;
- periodically test restoration into a non-production database.

### Restore

1. Stop or restrict board editing.
2. Back up the current database, even if it appears damaged.
3. Restore the saved `magnetic_boards` row into the target D1 database.
4. confirm that the JSON payload has the application-supported `layoutVersion`;
5. open the board, move a test magnet and confirm that the save indicator returns
   to **LIVE / ALL CHANGES SAVED**.

Deleting local `.wrangler/state` resets only the local development database. It
must never be treated as a production restore procedure.

## 11. Safe maintenance guide

### Change names, asset lists or the default layout

Edit `app/board-data.ts`:

- `defaultMagneticBoard.magnets` controls the initial board arrangement;
- `magnetInventory` controls reusable rack items;
- `kindDefaults` controls default magnet width, height and colour;
- `BOARD_WIDTH` and `BOARD_HEIGHT` define the fixed board coordinate system.

Every magnet ID must remain unique. An operator link uses `attachedTo` to refer
to an equipment magnet ID.

### Change colours, spacing or TV layout

Edit `app/globals.css`. The most important selectors are the main board header,
grid/background, `.magnet`, park-up bands, R + R panel and presentation/TV
rules. Check both normal edit mode and TV View after any CSS change.

Replace `public/ConsminLogo.png` to update the banner. Keep the same filename,
use a wide image with minimal transparent padding, and re-run the build.

### Change drag or linking behaviour

Edit the helpers near the top of `app/page.tsx`:

- `ATTACH_DISTANCE` and `ATTACH_GAP` control person-to-equipment linking;
- `overlaps` and `collidesWithOthers` enforce collision protection;
- `moveLinkedGroup` moves linked magnets together;
- `attachPersonToNearestEquipment` creates an operator link;
- `findOpenPosition` locates a safe empty position.

Run the full test sequence after changing this logic.

### Change the database schema

1. Update `db/schema.ts`.
2. Run `npm run db:generate`.
3. Review the new SQL migration in `drizzle/`.
4. Update the defensive schema creation in `app/api/board/route.ts` if the
   runtime needs the new field before migrations are applied.
5. Back up production.
6. Test the migration against a non-production D1 database.
7. Deploy the migration and application together.

### Change the board payload format

Increment `layoutVersion` in `app/board-data.ts` and add an explicit migration
path in the board-loading logic in `app/page.tsx`. Without a compatible
migration, an unknown layout version is reset to the default seed. Always back
up the operational board before this change.

## 12. Operational runbook

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Board shows **RETRYING** | API, network or D1 failure | Check `/api/board`, Worker logs and the `DB` binding. |
| Board loads but changes do not persist | PUT request or database write failed | Inspect browser network requests and Worker logs. Confirm D1 write access. |
| A second screen looks stale | Polling interrupted or screen is actively editing | Reload the screen and confirm API access; normal refresh is within four seconds. |
| Board is cropped on the TV | Browser chrome, zoom or TV overscan | Use TV View, 100% zoom, full screen and disable overscan. |
| Board resets unexpectedly after release | Unsupported `layoutVersion` | Restore the D1 backup and review the payload migration logic. |
| New local data does not match source defaults | Existing local D1 row | Back up if required, then remove local `.wrangler/state` and restart. |
| Magnets cannot be placed | Collision or board boundary protection | Move nearby magnets or reduce the magnet's configured size. |
| Operator will not attach | Too far from supported equipment or blocked space | Move the person within the attachment threshold beside the equipment. |

For a first diagnosis, check in this order:

1. browser developer tools and the `/api/board` response;
2. application/Worker logs;
3. presence and health of the `DB` binding;
4. the `magnetic_boards` row with `id = 1`;
5. the deployed build version and recent changes.

## 13. Release procedure

1. Create a branch in the ICT-managed repository.
2. Make the smallest required source change.
3. Update this README when setup, architecture or operations change.
4. Run `npm ci`, `npm run lint` and `npm test` from a clean checkout.
5. Back up D1 when board data or schema compatibility could be affected.
6. Deploy to a non-production environment and test drag, link, collision, save,
   refresh and TV View.
7. Obtain the normal operational approval.
8. Deploy production and record the release version/date.
9. Confirm that an edit is visible from a second browser within four seconds.

## 14. Known limitations

- One shared board is stored under database ID `1`.
- Saves are last-write-wins; there is no record-level conflict resolution.
- Undo history is held in the current browser session only.
- There is no built-in audit history beyond the latest editor and timestamp.
- Application-level authentication and role-based access are not included.
- The source archive does not contain the live D1 database.

These limitations keep the codebase simple. If requirements grow, priority
enhancements should be server-side access control, an append-only audit log,
automatic backup verification and conflict-aware saves.

## 15. ICT acceptance checklist

- [ ] Source imported into a company-owned Git repository.
- [ ] Business owner and ICT support owner recorded.
- [ ] Company-owned hosting project and D1 database confirmed.
- [ ] `DB` binding configured.
- [ ] SSO or approved access control enabled.
- [ ] Clean `npm ci`, lint, tests and production build pass.
- [ ] Non-production functional and TV tests complete.
- [ ] Backup and restore process documented and tested.
- [ ] Monitoring/log ownership agreed.
- [ ] Production URL, support contact and release process documented internally.

## 16. Support boundary and ownership

All application source, configuration, migration files and build instructions
required for maintenance are contained in this project. No part of the source
depends on the original developer's personal computer or personal account.

ConsMin ICT should become the technical owner after acceptance. The operations
team should own board content and usage decisions. Any future external support
provider should work through the ICT-managed repository, non-production
environment and standard change process.

This is proprietary project material. No open-source licence is granted by this
repository.
