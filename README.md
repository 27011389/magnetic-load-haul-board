# Load & Haul Shiftboard

Production handover package — version 1.0.4, 4 August 2026.

This application is a live browser version of the ConsMin Load and Haul
shiftboard. It replaces physical magnets with draggable digital magnets while
keeping the familiar day shift, night shift, pit allocation, park-up and workshop layout.

This README provides the technical evidence ICT needs to review the application
and assess security vulnerabilities before it is approved to run. ICT is not
being asked to maintain, operate, deploy or support the application.

## 1. Handover status

The Git-tracked source is a clean, reproducible project. It does not include build
outputs, package caches, installed dependencies, temporary files, credentials,
or a copy of the live operational database.

At handover:

- the application passes lint, automated rendering tests and a production build;
- dependencies are pinned by `package-lock.json`;
- the database migration is included;
- the ConsMin logo and favicon are included;
- the illustrated operational manual is included in `docs/`;
- unused starter files, example code and unreferenced helpers have been removed;
- the source has no OpenAI Sites configuration or runtime dependency;
- the source is ready for ICT security and vulnerability review.

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
- Board lock, pixel-precise placement, close-to-line truck alignment, keyboard positioning, one-to-five-section layouts and reset controls.
- Undo history for the last 20 board changes.
- Search and unassigned-operator warnings.
- Day/night truck allocation totals and park-up totals.
- Fixed go-line, shut-pad, workshop and standby allocation bays.
- Shift/date/note editing and day/night allocation copying.
- A/B/C crew allocation with searchable full names and editable competency notes.
- Full-screen and fitted TV modes.
- Shared local SQLite storage with an automatic 1.5-second refresh and immediate refresh on focus.
- Last-moved indication and saved starting-layout support.
- Named shift-handover snapshots with previous-versus-latest truck comparison.
- A pre-handover board check for missing operators, broken links, duplicates,
  overlaps, incomplete work areas and equipment that needs attention.
- Persistent change history with ten restorable board versions and a 100-entry
  activity record.
- Conflict-safe saving, live screen presence and a visible indicator when
  another screen is moving a magnet.
- Equipment statuses for breakdown, fuel, workshop, standby and awaiting an
  operator, plus operational notes on individual magnets.
- Guided next-shift preparation that snapshots the outgoing board, retains
  equipment and locations, and stages the selected incoming crews.

## 3. Technology summary

| Area | Technology | Purpose |
| --- | --- | --- |
| User interface | React 19 + TypeScript | Board, controls and drag interactions |
| Application framework | Next.js App Router | Page, metadata and API route |
| Build tooling | Next.js | Development and production server build |
| Styling | Tailwind/PostCSS pipeline plus custom CSS | Reset/build pipeline and board styling |
| Runtime | Node.js on the onsite Windows PC | Serves the application and API |
| Database | Local SQLite file | Stores the shared board state on the host PC |
| Schema tooling | Drizzle | Version-controlled schema and migration |
| Quality checks | ESLint + TypeScript + Node test runner | Static checks, board-logic tests and rendered HTML smoke test |

Required Node.js version: **24.0.0 or newer**.

## 4. Architecture and data flow

The browser loads the board from `GET /api/board`. A completed move or edit is
saved using a version-checked `PUT /api/board`. Other open browsers poll the API
every 1.5 seconds when they are not dragging or editing a magnet, and refresh
immediately when a tab regains focus. Short-lived
screen presence and active-magnet details use `/api/presence`.

```text
Browser / TV
    |
    | GET and PUT /api/board · GET and POST /api/presence
    v
App Router API route
    |
    | SQL on the host PC
    v
data/shiftboard.sqlite: magnetic_boards
```

The database deliberately uses a simple single-board model plus an advisory
presence table:

| Column | Meaning |
| --- | --- |
| `id` | Board identifier. The application currently uses `1`. |
| `payload` | JSON containing every magnet, link, position and board setting. |
| `version` | Increments after each successful save. |
| `updated_at` | ISO timestamp of the last save. |

Each save includes the version originally loaded by that screen. If a newer
version already exists, the stale write is rejected and the latest shared board
is loaded instead of overwriting another operator's work. Unversioned writes and
writes from a different application layout version are also rejected, preventing
an old browser tab from restoring an obsolete board. Presence rows expire
after 20 seconds and contain a random browser-session ID, display label, optional
active magnet ID and last heartbeat time.

## 5. Project structure

```text
app/
  api/board/route.ts   Shared board GET/PUT API and defensive table creation
  api/presence/route.ts Live screen and active-magnet heartbeat API
  board-data.ts        Magnet types, inventory, dimensions and default layout
  board-validation.ts  Runtime validation for saved boards and rack templates
  board-workflows.ts   Handover, readiness, history and next-shift logic
  globals.css          Complete visual layout, responsive and TV styling
  layout.tsx           Page metadata, fonts and favicon
  magnet-ids.ts        Duplicate-ID repair and collision-safe ID allocation
  page.tsx             Board UI, drag/link/collision logic and controls
  truck-row-layout.ts  Close-to-line truck row alignment and packing
db/
  local-database.ts    SQLite connection, durability settings and table creation
  schema.ts            Drizzle representation of the SQLite tables
drizzle/               Version-controlled SQL migration and metadata
public/
  ConsminLogo.png      Header artwork
  favicon.svg          Browser icon
scripts/               Reproducible install, build and artifact checks
tests/                 Board-logic tests and production-render smoke test
docs/                  Illustrated Mine 2, Mine 3 and Control user manual
package.json           Commands and dependency versions
```

## 6. First-time setup

### Review and development environment

- Node.js 24 or newer
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

Open the address printed by Next.js, normally `http://localhost:3000`.

Development uses `data/shiftboard-development.sqlite`, separate from the
operational database. The `data/` folder is intentionally ignored by Git.

### Run the onsite production server

```bash
npm run build
npm start
```

For a Windows deployment that can be transferred as a ZIP, use the included
deployment kit:

```powershell
npm run package:onsite
```

The ZIP is written under `output/onsite`. After it is extracted on the approved
host, `Install-Shiftboard.cmd` performs the one-time dependency installation and
production build, and `Start-Shiftboard.cmd` starts the shared board. See
`ONSITE-SETUP.md` for the complete first-install, firewall, backup and upgrade
procedure.

The production server listens on port 3000. On the Windows host, run `ipconfig`
and give the PC a reserved/static LAN address or internal DNS name. Other
approved devices can open:

```text
http://HOST-IP-ADDRESS:3000
```

Configure the command as an approved Windows service or startup task with
automatic restart. The PC must remain powered on, automatic sleep must be
disabled and Windows Firewall should allow port 3000 only from approved onsite
networks. The application does not provide its own authentication.

## 7. Quality and release commands

```bash
npm run lint
npm test
npm run build
npm run validate:artifact
```

`npm test` performs a production build before running the board-logic tests and
the standalone server/API smoke test. A successful production build is written
to `.next/`; this folder is generated and should not be committed or included
in source archives.

For a clean technical verification:

1. Extract or clone the source into a new folder.
2. Run `npm ci`.
3. Run `npm run lint`.
4. Run `npm test`.
5. Confirm all commands exit successfully before deployment.

## 8. Onsite deployment

The project is a standalone Node.js application for one continuously running
onsite Windows PC. It does not require a cloud account, hosted database or
internet connection after the source and npm packages have been installed.

The source archive contains no deployment credentials and is not tied to an ICT
employee's personal account. If the application is approved to run, the
application owner—not ICT—is responsible for arranging the following unless a
separate service agreement explicitly assigns an item elsewhere:

1. maintain the source in an appropriately controlled private Git repository;
2. nominate the approved onsite Windows host and reserve its LAN address;
3. install Node.js 24 and run `npm ci` followed by `npm test`;
4. configure `npm start` as a supervised Windows service or startup task;
5. permit TCP port 3000 only from approved networks or place it behind an
   approved internal reverse proxy;
6. configure and test database backups;
7. record the internal URL and operating owner.

The packaged workflow implements these steps for Windows while deliberately
excluding the live `data` directory from the ZIP. This prevents operational
board data from being copied into ordinary release packages and allows an
upgrade extracted over the same folder to preserve the onsite database.

The API also creates the current table with `CREATE TABLE IF NOT EXISTS` as a
defensive fallback. Formal schema changes must still be committed as a new
Drizzle migration.

### TV setup

- Use a 16:9 display at 1920 × 1080 where possible.
- Set browser zoom to 100%.
- Disable television overscan or enable “Just Scan”, “Screen Fit” or an
  equivalent setting.
- Open **TV View** in the application. It scales the complete 1880 × 940 board
  to the available browser viewport without scrolling.
- Use **Full Screen** if browser chrome is still visible.

## 9. Access and security notes

The application does not currently implement its own login, roles or
permissions. It expects hosting, a reverse proxy or the corporate platform to
control access. The board currently records the last editor as `MINE CONTROL`.

The default seed contains employee names. Keep the repository private and
limit access to approved ICT and operational personnel unless the seed data is
replaced with non-personal examples. The Mine 2, Mine 3 and Control roles in the
user manual are operational responsibilities; they are not enforced by the app.

As part of the current review, ICT is asked only to assess whether the proposed
architecture, controls and operating environment are safe to run. The
application owner is responsible for ensuring that any approval conditions are
implemented, including:

- put the URL behind company SSO or another approved access layer;
- restrict access to the required operations group;
- restrict file-system access to `data/shiftboard.sqlite` and its backups;
- keep deployment credentials out of the repository;
- review application and platform logs for failed API requests;
- document the application owner and the support arrangement outside ICT.

Do not expose port 3000 to the public internet. Remote locations should use an
approved company network route or VPN, not router port forwarding.

## 10. Backup, restore and data ownership

There are two different sources of board data:

- `app/board-data.ts` is the default seed used only when creating a new board.
- `data/shiftboard.sqlite` is the operational shared board and contains subsequent live changes.

Changing `app/board-data.ts` does not overwrite an existing SQLite board. Use the
application's **Save Start** feature to make the current arrangement the reset
layout, or perform a controlled database change after taking a backup.

### Backup

Back up `data/shiftboard.sqlite` using an approved SQLite-aware backup process.
If the service is stopped before copying, also preserve any `-wal` and `-shm`
files that remain beside it. The database contains the board payload, version,
history and update timestamp.

The included live-safe backup command writes a timestamped SQLite backup under
`data/backups/` by default:

```bash
npm run backup
```

Set `SHIFTBOARD_BACKUP_DIR` for an approved backup drive or managed folder.

Recommended policy:

- automatic daily backup;
- retain at least 30 days, subject to applicable company policy;
- take a manual export before a release or layout-version change;
- periodically test restoration into a non-production database.

### Restore

1. Stop or restrict board editing.
2. Back up the current database, even if it appears damaged.
3. Replace `data/shiftboard.sqlite` with the approved backup while the service is stopped.
4. confirm that the JSON payload has the application-supported `layoutVersion`;
5. open the board, move a test magnet and confirm that the save indicator returns
   to **LIVE / ALL CHANGES SAVED**.

Deleting `data/shiftboard.sqlite` creates a new board from the bundled seed on
the next start. Never do this as a restore procedure.

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
grid/background, `.magnet`, work-section layout, park-up bands and presentation/TV
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

Ordinary dragging uses single-pixel placement. Trucks only align and pack onto
a dig-unit allocation line when released within the small line-proximity zone;
otherwise they remain where they are dropped. Bottom park-up bays retain their
separate bay-alignment behaviour.

Run the full test sequence after changing this logic.

### Change the database schema

1. Update `db/schema.ts`.
2. Run `npm run db:generate`.
3. Review the new SQL migration in `drizzle/`.
4. Update the defensive schema creation in the relevant API route if the
   runtime needs the new field before migrations are applied.
5. Back up production.
6. Test the migration against a copied non-production SQLite database.
7. Deploy the migration and application together.

### Change the board payload format

Increment `layoutVersion` in `app/board-data.ts` and add an explicit migration
path in the board-loading logic in `app/page.tsx`. Without a compatible
migration, an unknown layout version is left unchanged and the screen asks for
the latest application. Always back up the operational board before this change.

## 12. Operational runbook

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Board shows **RETRYING** | API, network or SQLite failure | Check `/api/board`, the Node server console and file-system access to `data/`. |
| Board loads but changes do not persist | PUT request or database write failed | Inspect browser requests and the Node server console. Confirm the service account can write to `data/`. |
| A second screen looks stale | Polling interrupted, screen is actively editing, or locations use different host addresses | Focus or reload the screen, confirm both locations use the same PC URL and compare `/api/board`; normal refresh is within two seconds. |
| Board reports a change on another screen | The save used an older board version | Review the latest board that was loaded, then repeat the intended move if still required. |
| Board is cropped on the TV | Browser chrome, zoom or TV overscan | Use TV View, 100% zoom, full screen and disable overscan. |
| Board refuses to open after release | Unsupported `layoutVersion` | Refresh the application, verify one deployment is active and review the payload migration logic. The saved board is not overwritten. |
| New local data does not match source defaults | Existing operational SQLite row | This is expected; the saved board takes precedence. Back it up before any controlled reset. |
| Magnets cannot be placed | Collision or board boundary protection | Move nearby magnets or reduce the magnet's configured size. |
| Operator will not attach | Too far from supported equipment or blocked space | Move the person within the attachment threshold beside the equipment. |

For a first diagnosis, check in this order:

1. browser developer tools and the `/api/board` response;
2. the Node server console or service logs;
3. presence and write access of `data/shiftboard.sqlite`;
4. the `magnetic_boards` row with `id = 1`;
5. the deployed build version and recent changes.

## 13. Release procedure

1. Create a branch in the controlled private repository.
2. Make the smallest required source change.
3. Update this README when setup, architecture or operations change.
4. Run `npm ci`, `npm run lint` and `npm test` from a clean checkout.
5. Back up `data/shiftboard.sqlite` when board data or schema compatibility could be affected.
6. Deploy to a non-production environment and test drag, link, collision, save,
   refresh and TV View.
7. Obtain the normal operational approval.
8. Deploy production and record the release version/date.
9. Confirm that an edit is visible from a second browser within two seconds.

## 14. Known limitations

- One shared board is stored under database ID `1`.
- Concurrent saves are protected at whole-board level; changes are not merged
  automatically when two screens edit different magnets at the same moment.
- The quick Undo stack is held in the current browser session; the persistent
  history retains the latest ten restorable versions.
- Presence labels identify browser sessions rather than authenticated named users.
- Application-level authentication and role-based access are not included.
- The source archive does not contain the live SQLite database.

These limitations keep the codebase simple. If requirements grow, priority
enhancements should be server-side access control, verified user identity,
automatic backup verification and field-level change merging.

## 15. ICT security-review checklist

- [ ] Source and dependency configuration reviewed for known vulnerabilities.
- [ ] Data exposure, personal-information handling and repository visibility reviewed.
- [ ] Network exposure and proposed access controls assessed.
- [ ] API, local SQLite storage and onsite host configuration assessed.
- [ ] Clean `npm ci`, lint, tests and production build results reviewed.
- [ ] Material findings and required mitigations documented for the application owner.
- [ ] ICT decision recorded as approved, approved with conditions, or not approved.

Completion of this review does not transfer application ownership, maintenance,
deployment, monitoring, backup or user-support responsibility to ICT.

## 16. Support boundary and ownership

All application source, configuration, migration files and build instructions
required for maintenance are contained in this project. No part of the source
depends on an ICT employee's personal computer or personal account.

ICT's present involvement is limited to reviewing the application, assessing
vulnerabilities and advising whether it is safe to run. Approval does not make
ICT the technical owner or create an ongoing maintenance or support obligation.
The application owner remains responsible for maintenance, deployment, backup,
monitoring, support and operational decisions, using an external provider or
other agreed resource where necessary.

This is proprietary project material. No open-source licence is granted by this
repository.
