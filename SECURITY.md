# Security and data handling

This repository is intended for internal company use. The default board seed
contains employee names and operational mine information, so the repository
must remain private unless that data is replaced with approved non-personal
examples.

Do not commit credentials, `.env` files, Cloudflare tokens, D1 exports, local
`.wrangler` state, screenshots containing unapproved personal information, or
generated distribution ZIP files.

The application has no built-in authentication or per-role authorisation.
Production access must be protected by company-managed SSO or an equivalent
approved access layer. Restrict the D1 database and deployment project to the
minimum required ICT administrators.

Report suspected vulnerabilities or data exposure through the organisation's
internal ICT/security process. Do not open a public GitHub issue containing
credentials, personal information, mine plans, or live operational data.
