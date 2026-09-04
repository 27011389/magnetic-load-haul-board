# Onsite Windows setup

The shiftboard runs on one Windows host. Other onsite computers open the board
from that host in a web browser.

## Install

1. Install Node.js 24 or newer on the host.
2. Copy the project ZIP to the host.
3. Extract it to a permanent local folder such as `C:\Shiftboard`.
4. Run `Install-Shiftboard.cmd` and wait for it to finish.
5. Run `Start-Shiftboard.cmd`.
6. Keep the server window open while the board is in use.

Open `http://localhost:3000` on the host. Other computers use
`http://HOST-IP-ADDRESS:3000`.

If other computers cannot connect, allow inbound TCP port 3000 through Windows
Firewall for the approved local network only. Do not expose the board to the
public internet.

## Data and upgrades

The live board is stored in `data\shiftboard.sqlite`.

Before an upgrade:

1. Stop the server with `Ctrl+C`.
2. Copy `data\shiftboard.sqlite` to a secure backup location.
3. Extract the new project ZIP over the application folder.
4. Run `Install-Shiftboard.cmd`.
5. Run `Start-Shiftboard.cmd`.

Do not include the `data` folder in an upgrade ZIP.
