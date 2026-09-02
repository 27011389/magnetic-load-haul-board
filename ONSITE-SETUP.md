# Onsite Windows setup

This deployment uses one Windows computer as the shiftboard host. Every other
approved onsite computer opens the same URL in a web browser. Do not run a
separate copy of the application or database on each computer.

## What the host computer needs

- 64-bit Windows on a computer that can remain powered on during operations.
- Node.js 24 or newer, installed from the organisation's approved source.
- One-time access to the npm package registry, or an ICT-managed npm cache, for
  the initial package installation.
- A reserved/static LAN address or an internal DNS name.
- Permission to accept TCP port 3000 from the approved onsite subnet only.
- A local folder that the operating account can write to, such as
  `C:\Shiftboard`. Avoid running the live application from Downloads, a ZIP,
  OneDrive, or a network share.

## First installation

1. Extract the deployment ZIP to `C:\Shiftboard` or another approved local
   folder.
2. Double-click `Install-Shiftboard.cmd`. It installs the exact dependency
   versions and creates a verified production build.
3. Ask ICT for the approved onsite subnet in CIDR form. Right-click
   `Configure-Shiftboard-Firewall.cmd`, select **Run as administrator**, and
   enter that subnet. The rule applies only to Domain and Private networks.
4. Double-click `Start-Shiftboard.cmd`.
5. Keep the server window open. It prints the URL for the host and onsite
   computers, normally `http://HOST-IP:3000`.
6. Open that same URL on each approved computer. Bookmark it; do not copy the
   project to client computers.

The first start creates `data\shiftboard.sqlite`. This file is the live shared
board. All browsers read and modify that one database through the host.

## Daily operation

- Start the board on the host before users open it.
- Keep the host awake and connected to the LAN.
- Leave the server window open while the board is in use.
- Use `Backup-Shiftboard.cmd` for a live-safe timestamped backup.
- Prefer one nominated editing authority at a time. Concurrent saves are
  protected from silent overwrites, but the application does not merge two
  simultaneous whole-board edits.

For unattended operation, ICT can configure `Start-Shiftboard.cmd` as a Windows
Task Scheduler task that runs at startup, restarts after failure, and uses a
dedicated local service account with write access to the application `data`
folder. The application itself does not provide authentication, so access must
remain limited to approved internal networks and devices.

## Upgrade without losing the board

1. Stop the server window.
2. Run `Backup-Shiftboard.cmd`.
3. Extract the new deployment ZIP over the existing application folder.
4. Run `Install-Shiftboard.cmd` again.
5. Run `Start-Shiftboard.cmd` and verify the board from a second computer.

Deployment ZIPs intentionally exclude `data`. Extracting an update over the
same application folder therefore leaves the live database and backups in
place. Do not delete the `data` folder during an upgrade.

## Create a transfer ZIP

From a development checkout, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\Create-OnsitePackage.ps1
```

The validated ZIP is written to `output\onsite`. It contains the source,
lockfile, and Windows scripts, but not `node_modules`, build output, or live
database files. The host installer recreates dependencies and build output.

## Troubleshooting

- If installation reports that Node.js is missing or too old, install the
  approved Node.js 24+ release and rerun the installer.
- If another computer cannot connect, confirm the host is running, both devices
  are on the approved LAN, the URL uses the host's current IP, and the scoped
  firewall rule is present.
- If the board says **RETRYING**, check the server window and confirm the host
  account can write to `data`.
- If port 3000 is already in use, the board may already be running. Do not start
  a second server against the same database.
