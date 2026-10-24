# Roots Employee & Task Management

A React + Express + MongoDB application for managing employees, assigning tasks and viewing team workload. The backend enforces assignment eligibility, legal status changes, dates, employee capacity and deletion rules. The frontend uses the real API; it contains no sample records or hardcoded totals.

## Requirements and quick start

- Node.js 22 or newer and npm.
- Docker for the local MongoDB replica set, or a transaction-capable MongoDB connection such as Atlas. A standalone MongoDB server cannot run the required multi-document transactions.
- Two free ports: 5000 for the API and 5173 for Vite.

From the repository root:

```bash
npm ci
docker compose up -d
docker exec roots-mongo-1 mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run dev
```

Run the `rs.initiate` command only the first time the Docker volume is created. Wait a few seconds for primary election. Open `http://localhost:5173`. The API health endpoint is `http://localhost:5000/api/health` and returns HTTP 200 with `{"status":"ok","database":"connected"}` when connected. The API refuses to start if MongoDB is not a replica set.

`npm run dev` starts both workspaces. `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` run from the root. Tests use a separate database named in `MONGODB_TEST_URI` and delete its employee and task documents; never point that variable at production. No automatic seed runs on startup.

## Environment variables

The root .env was created from the root example and is the shared local configuration. The server loads root .env first, then server/.env for missing values. Vite reads root .env and exposes only VITE_ variables to the browser. Workspace examples remain fallback templates. Never commit real .env files.

| Variable | Process | Meaning |
| --- | --- | --- |
| `MONGODB_URI` | server | Required replica-set URI for application data. |
| `MONGODB_TEST_URI` | server tests | Separate transaction-capable test database. Defaults to the local test URI if omitted. |
| `PORT` | server | HTTP port; defaults to 5000 locally. Render supplies this in production. |
| `CLIENT_ORIGIN` | server | Allowed frontend origin, or comma-separated origins. Required in production; local default is `http://localhost:5173`. |
| `NODE_ENV` | server | Set `production` on the host. |
| `BUSINESS_TIMEZONE` | server | Optional; only `UTC` is supported. Calendar dates and overdue use UTC today. |
| `VITE_API_BASE_URL` | client build | Public backend URL ending in `/api`. Local default is `http://localhost:5000/api`. Never put a database URI in a `VITE_` variable. |

## Structure

- `client/src/App.tsx`: routed pages and shared list/form/detail components.
- `client/src/api.ts`: typed API calls and shared UI constants.
- `client/src/styles.css`: responsive visual styles.
- `server/src/common.ts`: enums, input schemas, date parsing and error helpers.
- `server/src/models.ts`: Mongoose schemas and indexes.
- `server/src/services.ts`: employee/task mutations and backend business rules.
- `server/src/queries.ts`: database search, combined filters, sorting, pagination, dashboard and CSV.
- `server/src/app.ts`: Express routes and error responses.
- `server/tests/`: real MongoDB integration and concurrency tests.

## Data model and assumptions

Employees have a MongoDB `_id`, a unique trimmed case-sensitive `employeeId`, unique trimmed lowercase email, phone, department, role, joining date, status, skills, optional leave period, internal active-task counter, deletion timestamp and Mongoose timestamps. Tasks store a generated unique `taskId`, title, description, employee `_id` reference, department, priority, status, start and due dates, backend-owned completion timestamp and timestamps. Employee ID and email have unique database indexes. Task status/due date, creation date and employee reference have query indexes.

Calendar fields use strict `YYYY-MM-DD` strings with real-date checks. Today means the current UTC date; due today is not overdue. Completed and cancelled tasks are not overdue. Task department is an explicit field and need not match the employee's home department. Skills are a list of strings entered as comma-separated values in the UI. A phone accepts 7–20 digits and common formatting characters. On Leave requires both dates; both endpoints are inclusive. Switching away clears the leave dates. Status or leave changes affect future assignment checks but do not rewrite existing tasks. Active tasks are Todo and In Progress.

The employee relationship uses MongoDB `_id`, so editing the display employee ID does not break task links. Employee deletion is a guarded soft delete. It is rejected while active tasks exist. Deleted employees disappear from normal employee lists, pickers, details, workload and employee totals, while their old tasks still show name, ID and email. Their unique employee IDs/emails remain reserved. Terminal tasks can be deleted through DELETE because the assignment bans editing them, not deleting them.

## API

Base path: `/api`. A list response contains `data` and `pagination: {page,limit,total,totalPages}`; a detail response contains `data`. A failure contains `error: {code,message,fields}`. Invalid inputs and broken rules return 400, missing records 404, duplicate employee ID/email 409. Delete returns 204.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Database readiness (200 or 503). |
| GET / POST | `/employees` | Paginated list / create. |
| GET / PUT / DELETE | `/employees/:id` | Detail / full edit / guarded soft delete. |
| GET / POST | `/tasks` | Paginated list / create as Todo. |
| GET / PUT / DELETE | `/tasks/:id` | Detail / full edit while active / delete. |
| PUT | `/tasks/:id/status` | Legal status transition. Body: `{"status":"In Progress"}`. |
| GET | `/tasks/export` | CSV for every matching task, ignoring page and limit. |
| GET | `/dashboard` | Employee/task counts and employee workload. |

Lists use `page` (default 1), `limit` (default 10, maximum 100), `search`, `department`, `status`, `sortBy`, `sortOrder`. Tasks also support `priority`, inclusive `dueFrom`/`dueTo`, and title OR retained employee-name search. Task sort keys are `createdAt`, `dueDate`, `priority` (importance order) and `title`. Employee sort keys are `createdAt`, `fullName` and `joiningDate`. All filters combine with AND. For example:

```text
GET /api/tasks?search=Jordan&department=Development&priority=High&status=Todo&dueFrom=2026-10-01&dueTo=2026-10-31&sortBy=dueDate&sortOrder=asc&page=2
GET /api/tasks/export?status=Todo&priority=High
```

The CSV uses the same query builder as the task list, reads all matching records with a MongoDB cursor, quotes commas/newlines/quotes and prefixes formula-like user content. It includes retained employee identity and computed overdue state. The response is assembled in memory, suitable for this assignment-sized dataset.

## Six assignment answers

1. **Status validation:** `server/src/services.ts` checks the transition map inside the transaction used only by `PUT /api/tasks/:id/status`. Generic task create/update schemas reject status and completion fields. Backend validation is necessary because clients can call the API directly.
2. **Completed Date:** The service sets `completedAt` from the server clock only when moving In Progress to Completed. A browser cannot forge or clear it.
3. **Assignment eligibility:** The service reads the employee in a transaction, rejects Inactive or deleted employees, and rejects On Leave when the task start falls between leave start and end, inclusive. It rechecks on reassignment or start-date edits.
4. **Backend filtering and pagination:** MongoDB applies combined filters, employee-name lookup, sorting and pagination before returning rows. This keeps totals correct across the whole dataset and avoids transferring every record to React.
5. **URL filters:** The task and employee list controls read and write query parameters, so refresh, copied links and browser history reproduce the same view.
6. **Concurrent fourth task:** A count-then-insert check can let both requests see two tasks and both create one. Here a MongoDB transaction conditionally increments `activeTaskCount` only below three and writes the task in the same transaction. Reassignment, completion, cancellation, deletion and employee deletion update that same document. Write conflicts retry or fail; a fourth active task is not accepted. The integration tests run two requests at capacity two and four requests from zero against a replica set.

## Deployment

The application is deployed as separate frontend and backend services:

- **Frontend:** [https://roots-employee-tasks.netlify.app](https://roots-employee-tasks.netlify.app)
- **Backend API:** [https://employee-task-management-system-hmm2.onrender.com](https://employee-task-management-system-hmm2.onrender.com)
- **Backend health:** [https://employee-task-management-system-hmm2.onrender.com/api/health](https://employee-task-management-system-hmm2.onrender.com/api/health)

Netlify builds the client workspace from the repository root, publishes `client/dist`, and rewrites nested SPA routes to `index.html` using `netlify.toml`. Its `VITE_API_BASE_URL` is set to `https://employee-task-management-system-hmm2.onrender.com/api`. Render runs the Express API as a Web Service, uses its assigned `PORT`, and health-checks `/api/health`. The Render environment contains `NODE_ENV`, `MONGODB_URI`, and `CLIENT_ORIGIN`; the MongoDB URI is never committed or exposed to the browser. The production database is `roots_employee_tasks`.
