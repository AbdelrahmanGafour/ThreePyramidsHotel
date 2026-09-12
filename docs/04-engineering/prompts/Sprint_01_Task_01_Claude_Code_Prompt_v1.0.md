# Claude Code Prompt - Sprint 01 / Task S1-T01

## PROJECT

You are assisting on the **Hotel Reservation System**, a greenfield hotel website and direct reservation product. The developer remains responsible for understanding and approving all code. Work only on the bounded task below.

The project uses a professional npm-workspaces monorepo with a Next.js frontend and a Node.js/Express backend. The backend is a **feature-first Modular Monolith**, not microservices and not a global layer-first Express project.

## SOURCE OF TRUTH

Before changing code, read the relevant project documents if present in the repository:

- `docs/00-project/Hotel_Reservation_Project_Handbook_v1.0.pdf`
- `docs/02-architecture/System_Architecture_v1.0.pdf`
- `docs/02-architecture/ADR-001_Modular_Monolith.pdf`
- `docs/03-sprints/sprint-01/Sprint_01_Plan_v1.0.pdf`
- `docs/04-engineering/Claude_Code_Engineering_Guide_v1.0.pdf`

Also inspect the existing repository before making changes. Do not assume the repository is empty.

## LOCKED ARCHITECTURE FOR THIS TASK

- Package manager: **npm**.
- Workspace model: **npm workspaces**.
- Repository applications: `apps/web` and `apps/api`.
- Frontend: **Next.js + TypeScript**.
- Backend: **Node.js + Express + TypeScript**.
- Backend architecture: **feature-first Modular Monolith**.
- Business API namespace reserved for future use: `/api/v1`.
- Operational health endpoint: `/health`.
- Local web port: `3000`.
- Local API port: `4000`.
- Runtime dependencies belong to the application that uses them, not the root package unless genuinely workspace-level.
- Do not create global mixed-domain `controllers/`, `services/`, or `repositories/` business folders.

## CURRENT SPRINT / TASK

**Sprint:** Sprint 01  
**Task:** S1-T01 - Repository and minimal application skeleton  
**Status:** Not Started

### Objective

Establish the professional npm-workspaces repository and the minimum Next.js/Express application boundaries required to begin the Sprint 1 booking slice.

At the end of this task, both applications should run/build locally and the Next.js app should be able to reach the Express `/health` endpoint through configuration.

## WHY THIS TASK EXISTS

We need stable frontend/backend application boundaries and a recognizable modular-monolith shell before adding PostgreSQL or hotel-domain behavior. This task should prove the repository structure and runtime communication without expanding into business implementation.

## ALLOWED SCOPE

You may create or modify only what is needed for the following:

- Root npm-workspaces configuration and workspace-level scripts/metadata.
- Root `.gitignore` and minimal repository README if needed.
- `apps/web` as a Next.js + TypeScript application.
- `apps/api` as an Express + TypeScript application.
- `apps/api/src/modules/health/` with the minimum code needed for `GET /health`.
- `apps/api/src/config/` only for configuration actually needed by Task 1.
- `apps/api/src/app.ts` for Express application construction/composition.
- `apps/api/src/server.ts` for server/process startup.
- Safe example environment configuration with no real credentials.
- Frontend-to-API health integration using a configurable API base URL.
- Minimal lint/type/build scripts already appropriate to the chosen Next.js/TypeScript/Express setup.
- Pin/document the Node.js runtime version expected by the repository.

Keep the health module small. Do not mechanically create controller/service/repository layers if the endpoint does not need them.

## EXPLICIT EXCLUSIONS - DO NOT IMPLEMENT

Do **not** add, scaffold, or partially implement any of the following in this task:

- PostgreSQL.
- Any ORM or query builder.
- Database drivers/connection architecture.
- Database migrations.
- Database seeds.
- `RoomType`.
- `Room`.
- Availability logic.
- Reservations.
- Reservation schemas or booking references.
- Authentication or authorization.
- Admin dashboard functionality.
- Packages/offers.
- Email integration.
- Media/file storage.
- Payment integrations.
- `RoomBlock`.
- Future business modules such as `rooms`, `reservations`, `auth`, or `packages`.
- Future `shared/` abstractions or placeholder folders.
- Empty monorepo `packages/` such as `packages/ui`, `packages/types`, or `packages/shared`.
- Microservices.
- CQRS/event buses/domain-event infrastructure.
- Dependency-injection frameworks.
- Generic base repositories.
- Railway deployment configuration/implementation.
- CI workflow implementation under `.github/workflows`.
- Unrelated refactoring or dependency upgrades.
- Changes to the product/architecture scope merely to simplify implementation.

If something outside this list appears necessary, stop and report why instead of adding it silently.

## ACCEPTANCE CRITERIA

The task is complete only when:

1. The repository is a single npm-workspaces monorepo.
2. `apps/web` is an independent Next.js TypeScript application.
3. `apps/api` is an independent Express TypeScript application.
4. The backend shell is feature/module-oriented rather than global layer-first.
5. `app.ts` constructs the Express application and does not own process startup/listening.
6. `server.ts` owns server/process startup.
7. `modules/health` owns `GET /health` with no unnecessary business layers.
8. Both applications can start locally on the agreed ports (`3000`, `4000`).
9. Both applications build successfully.
10. The frontend can reach the API health endpoint using configuration rather than a permanently hardcoded production URL.
11. Real `.env` files/secrets are ignored by Git.
12. Example environment configuration contains only names/harmless examples.
13. No client-exposed environment variable contains a server secret.
14. No excluded future functionality or speculative architecture has been introduced.
15. The repository remains understandable to an experienced Node.js developer without custom framework conventions.

## TESTS / CHECKS REQUIRED

Run and report the applicable commands/checks for the repository you create:

- Install dependencies from the workspace root.
- Start the API and call `GET /health` directly.
- Start the Next.js app and verify it loads.
- Verify the frontend successfully reaches the API health endpoint.
- Stop/unavailable the API and verify the frontend does not fail with an uncontrolled application crash.
- Run the production build for `apps/web`.
- Run the production build/type-check for `apps/api`.
- Inspect Git status and ignored files to confirm local environment secrets and generated outputs are not accidentally tracked.

Do not create a large automated test framework solely for this health endpoint unless the existing scaffold naturally includes one and it is justified.

## SECURITY / QUALITY RULES

- Never commit real secrets or credentials.
- Do not expose server-only secrets through Next.js public environment variables.
- Do not make permanently permissive production security/CORS choices just to make local development work.
- Keep root runtime dependencies minimal and workspace-level only.
- Keep application runtime dependencies inside their owning application.
- Preserve the Modular Monolith direction without creating empty future architecture.
- Prefer the smallest conventional solution that satisfies the acceptance criteria.

## EXPECTED WORKFLOW

1. Inspect the repository and listed documentation first.
2. Summarize the current state and the minimal file changes you intend to make.
3. If the repository state conflicts materially with the task/architecture, report the conflict before changing it.
4. Implement only S1-T01.
5. Run the required checks/builds.
6. Review your diff for accidental scope expansion, secrets, generated files, and unnecessary abstractions.
7. Do not implement the next task.

## COMPLETION REPORT

When finished, report exactly:

### Files changed
List added/modified/deleted files.

### What was implemented
Summarize the repository/workspace, web app, API shell, modular health endpoint, configuration, and health integration.

### Tests/checks run
List commands/scenarios you actually ran.

### Results
State which passed/failed and any warnings.

### Architectural decisions made
List any decision made within the approved task (for example Node.js version or environment-variable names). If none beyond the documented architecture, say so.

### Remaining concerns / blockers
List anything the developer should review before marking the task Done.

### Intentionally not implemented
Explicitly confirm that PostgreSQL, ORM/database setup, rooms, reservations, authentication, packages, email, media, Railway deployment, CI workflows, and future shared abstractions were not implemented.
