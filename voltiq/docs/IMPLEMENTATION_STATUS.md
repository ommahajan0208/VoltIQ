# Implementation status

The frontend implements the main revision-2 pages and supports both explicit synthetic demo mode and local API mode. Its API client is typed from `contracts/backend-openapi.json`; regenerate with `npm run api:generate` after changing backend route signatures.

Current verification: TypeScript passed, 35 Vitest tests passed, and the production build passed. The local API overview and historical forecasting page were also inspected in a browser against a saved synthetic backend run.

See `../../PROGRESS.md` for the complete cross-stack status and unverified requirements. In particular, optional experiment/bundle workflows and a full browser acceptance audit against real UCI data remain open.
