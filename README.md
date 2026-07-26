# Load and Haul Shiftboard

Windows-local handover package, version 1.0.6.

This is a browser-based recreation of the existing Load and Haul whiteboard.
Personnel, trucks, excavators, dozers, graders, water carts, light vehicles and
other board items behave like magnets. Changes are shared live with every
device that opens the board from the site network.

## Install on the new computer

Required:

1. Node.js 22 LTS (64-bit): <https://nodejs.org/en/download>

Visual Studio Code is optional. It is only needed if someone wants to inspect
or modify the source code; it is not required to install or run the board.

Extract this ZIP into a permanent folder such as:

```text
C:\Apps\Load and Haul Shiftboard
```

Do not run it permanently from Downloads, a temporary folder or inside the ZIP.

Then double-click `INSTALL-FIRST.cmd`. Alternatively, open Command Prompt or
PowerShell in the project folder and run:

```powershell
npm ci
```

An internet connection is required for this first installation. It creates the
`node_modules` folder locally; that generated folder is intentionally not in
the ZIP.

## Start the board

Double-click:

```text
START-SHIFTBOARD.cmd
```

Alternatively run:

```powershell
npm run start
```

On the host computer, open:

```text
http://localhost:5173
```

To open it from Control, Mine 2, Mine 3 or another site computer, run
`ipconfig` on the host and find its IPv4 Address. Use:

```text
http://HOST-IP-ADDRESS:5173
```

For example, if the host address is `10.0.1.38`, use
`http://10.0.1.38:5173`.

Allow Node.js through Windows Defender Firewall on the trusted site network.
ICT should reserve the host PC's IP address so the URL does not change.

The host PC and the `START-SHIFTBOARD` window must remain running. Closing the
window stops the board. VS Code does not need to stay open when the CMD file is
used.

## What the two CMD files do

### INSTALL-FIRST.cmd

Run this once on each new host computer. It changes to the project folder,
checks that Node.js is installed, and runs `npm ci` to install the exact
packages recorded in `package-lock.json`. It requires an internet connection
during this first installation. It does not start the board or modify the
database.

### START-SHIFTBOARD.cmd

Run this whenever the board needs to operate. It checks that Node.js and the
installed packages are available, then starts the local server on port 5173.
The Command Prompt window must remain open while the board is running. Closing
the window stops the application but does not delete saved board data.

## Live data and backups

The local board database is automatically created here after first start:

```text
.wrangler\state
```

This contains the current magnet positions, links, notes and shift details.
Back up this folder regularly. Stop the board before copying it.

The source code in GitHub does not normally include `.wrangler`, so GitHub alone
is not a backup of the live board.

To move the current live board to another host:

1. Stop the board on the old computer.
2. Copy its complete `.wrangler\state` folder.
3. Place it under `.wrangler` in this project on the new computer.
4. Start the board on the new computer.

Deleting `.wrangler\state` resets local storage. The next start creates a new
board from `app\board-data.ts`.

## Main files for ICT

- `app\board-data.ts` — supplied magnets and starting layout
- `app\page.tsx` — board controls, drag/link/collision behaviour and editor
- `app\globals.css` — board, header and magnet appearance
- `app\api\board\route.ts` — shared board load/save API
- `public\ConsminLogo.png` — ConsMin banner
- `vite.config.ts` — local server and local database binding
- `worker\index.ts` — local Cloudflare-compatible application worker

No separate SQL server, Cloudflare account, Vercel account or `.openai` folder
is required for this local version.

## Updating the application

Before replacing the project:

1. Stop the board.
2. Back up `.wrangler\state`.
3. Replace the source files, but preserve the backed-up `.wrangler\state`.
4. Run `npm ci` again.
5. Restart with `START-SHIFTBOARD.cmd`.

## Operational notes

- Keep the application on the internal site network; this release has no login.
- Disable sleep and hibernation on the host PC.
- Configure the PC to restart after a power failure if required.
- A scheduled task or Windows service can start the CMD file automatically.
- If port 5173 is already in use, stop the other program before starting the board.

## Included functions

- Live draggable magnets with collision protection
- Equipment/operator linking and grouped movement
- Trucks, dozers, graders and water carts as separate magnets
- Park-up, go-line, shut-pad, workshop and standby allocation areas
- Day/night shift areas and allocation counts
- Search, undo, duplicate, edit, recolour and resize
- Board locking and full-screen TV view
- Shared automatic saving and refresh across connected site devices
