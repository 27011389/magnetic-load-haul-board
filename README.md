# Load & Haul Shiftboard

A browser-based replacement for the ConsMin Load and Haul magnetic shiftboard.
It provides a shared board for day and night shift allocations, equipment,
operators, park-up areas and workshop activity.

## Features

- Drag-and-drop equipment, operator, location and note magnets
- Day, night and full-board TV views
- Shared live board across onsite computers
- Collision checking and operator-to-equipment links
- Board lock, search, undo and reset controls
- Shift handover snapshots and board readiness checks
- Equipment status and operational notes
- Local SQLite storage with a built-in backup script

## Install on the host computer

The shiftboard is supplied as a ZIP file and runs from one Windows computer.
Other onsite computers connect to that host through a web browser.

The host requires:

- 64-bit Windows
- Node.js 24 or newer, including npm
- Access to the npm package registry during installation
- A permanent writable local folder

To install:

1. Copy the deployment ZIP to the host computer.
2. Extract the complete ZIP to a permanent folder such as `C:\Shiftboard`.
   Do not run it from inside the ZIP, Downloads, OneDrive or a network share.
3. Open the extracted folder and run `Install-Shiftboard.cmd`.
4. Wait for the package installation and production build to complete.
5. Run `Start-Shiftboard.cmd`.
6. Keep the server window open while the board is in use.
7. Open the address shown in the server window. On the host this is normally
   `http://localhost:3000`.

After installation, only `Start-Shiftboard.cmd` is needed to start the board.
Run the installer again after an application upgrade.

## Windows scripts

| Script | Purpose |
| --- | --- |
| `Install-Shiftboard.cmd` | Installs the locked package versions, backs up an existing database and builds the application. |
| `Start-Shiftboard.cmd` | Starts the production server and displays the available addresses. |
| `Backup-Shiftboard.cmd` | Creates a timestamped backup in `data\backups`. |
| `Configure-Shiftboard-Firewall.cmd` | Allows port 3000 from an approved LAN subnet. Run as administrator. |

## Connect other computers

All users must connect to the same host. Do not install a separate copy on each
computer.

1. Give the host a reserved IP address or internal DNS name.
2. Run `Configure-Shiftboard-Firewall.cmd` as administrator if a firewall rule
   is required.
3. Enter the approved subnet in CIDR format, for example `192.168.10.0/24`.
4. Open `http://HOST-IP-ADDRESS:3000` on each approved computer.

Keep the host powered on, connected to the network and prevented from sleeping.
Do not expose port 3000 to the public internet.

## Data and backups

The live board is stored in `data\shiftboard.sqlite`. The file is created the
first time the application starts and is not included in deployment ZIPs.

Run `Backup-Shiftboard.cmd` regularly and before every upgrade. To restore a
backup, stop the server, preserve the current database, replace
`data\shiftboard.sqlite` with the approved backup and restart the board.

Deleting the database creates a new board from the default layout. Do not use
deletion as a restore method.

## Upgrade

1. Stop the server with `Ctrl+C` in the server window.
2. Run `Backup-Shiftboard.cmd` before replacing the application files.
3. Extract the new deployment ZIP over the existing application folder.
4. Run `Install-Shiftboard.cmd`.
5. Run `Start-Shiftboard.cmd` and confirm the board opens correctly.

The deployment ZIP excludes the `data` folder, so an upgrade does not replace
the live board or its backups.

## Create a deployment ZIP

From a development checkout on Windows:

```powershell
npm ci
npm run package:onsite
```

The package is written to `output\onsite`.

## Development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Development uses
`data/shiftboard-development.sqlite`, separate from the production database.

Before releasing a change, run:

```bash
npm run lint
npm test
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run build` | Create and validate a production build. |
| `npm start` | Start a production build from the command line. |
| `npm test` | Build the application and run the automated tests. |
| `npm run lint` | Run the source checks. |
| `npm run backup` | Back up the production database. |
| `npm run package:onsite` | Create the Windows deployment ZIP. |

## Project structure

```text
app/              Board interface, workflows and API routes
db/               SQLite connection and schema
deploy/windows/   Windows install, start, backup and firewall scripts
drizzle/          Database migrations
public/           Logo and favicon
scripts/          Build, backup and packaging utilities
tests/            Board logic and server tests
```

The application uses Next.js, React, TypeScript and SQLite. It stores one shared
board and uses version checks to prevent an older browser from silently
overwriting newer changes.

## Troubleshooting

- If installation fails, confirm Node.js 24 or newer is installed and the host
  can access the npm package registry.
- If the start script reports that the application is not installed, run
  `Install-Shiftboard.cmd` first.
- If port 3000 is already in use, the board may already be running.
- If another computer cannot connect, check the host address, network and
  firewall rule.
- If the board shows **RETRYING**, check the server window and confirm the host
  account can write to the `data` folder.

The application does not include user authentication. Limit it to approved
internal networks and users. The repository and database contain employee and
operational information and must be handled accordingly.

This is proprietary project material. No open-source licence is granted.
