# Proposed architecture

This is a recommended implementation design. Preserve the PDF's behavior if changing it.

## Stack and structure

Use npm workspaces, React + Vite + TypeScript, React Router, a small server-state/query layer, form/schema validation, and Express + TypeScript + Mongoose. Choose one styling approach with class-based styles. Reuse existing compatible project tools when present.

Suggested structure:
```
client/src/
  app/              # router, providers, application shell
  components/       # shared UI, tables, pagination, notifications, form fields
  features/
    employees/      # pages, forms, API hooks, validation
    tasks/
    dashboard/
  lib/              # API client, query-string/date helpers
  styles/
server/src/
  config/
  models/
  routes/
  controllers/
  services/         # business rules and transactional writes
  validators/
  middleware/
  utils/            # dates, query parsing, CSV serialization
  app.ts            # testable Express app without binding a port
  index.ts          # validated config, DB connection, listener
server/tests/
```

Proposed root scripts: `dev`, `build`, `lint`, `typecheck`, `test`, and an explicit `seed` command. Document actual commands after implementation. Do not automatically reseed or drop data on startup.

## Models and validation

Employee: MongoDB `_id`, `employeeId`, `fullName`, normalized `email`, `phone`, `department`, `role`, `joiningDate`, `status`, `skills`, optional `leaveStart`/`leaveEnd`, internal `activeTaskCount` default 0, internal `deletedAt`, timestamps. Index employeeId/email uniquely at the DB level; map duplicate-key errors to 409. Exclude internal counters from client-writeable fields.

Task: `_id`, unique automatic `taskId`, `title`, `description`, `assignedEmployee` ObjectId reference, `department`, `priority`, `status` default Todo, `startDate`, `dueDate`, `createdAt`, nullable `completedAt`, timestamps. Use a numeric priority rank in query aggregation (Low=1, Medium=2, High=3, Critical=4), or a synchronized internal rank; never sort priority alphabetically. Add indexes that support active-task lookup and common list filters.

Use strict input schemas, enum validation, trimmed strings, normalized email and real calendar validation. Validate IDs before DB use. Reject client-controlled status on generic writes and reject server-owned IDs/timestamps/counters. Match UI validation to backend schemas without making the client authoritative.

## Dates and overdue

Store calendar-only fields consistently as validated zero-padded `YYYY-MM-DD` strings or another representation with equivalent calendar semantics. Do not mix local-midnight Date objects and UTC comparisons. The recommended convention is calendar strings with UTC today. Validate calendar reality (e.g. reject 2026-02-30), not just a regex.

Use one shared backend predicate/query builder: `dueDate < today && status in [Todo, In Progress]`. Resolve today's date once per request; allow injecting the clock in tests. Apply the same predicate to list/detail serialization, dashboard and CSV. Do not persist an overdue boolean that becomes stale overnight. Frontend formatting should not shift date-only values across time zones.

## Safe capacity enforcement

MongoDB transactions require a replica set, including tests and local development (a managed transaction-capable MongoDB cluster is also suitable). Document this. Do not pretend a standalone MongoDB instance supports this design.

Keep employee `activeTaskCount` in sync with active task writes in one transaction:
1. On create, validate the employee exists, is not deleted, and satisfies the Active/On Leave/Inactive rules for the proposed Start Date. Conditionally increment its counter only if `< 3`, then insert the Todo task in the same transaction.
2. On active task reassignment, validate the new employee and dates; decrement the old counter, reserve the new slot with the same conditional increment, and update the task atomically. If any step fails, roll back everything.
3. Same-employee active task edits must not reserve an extra slot. When Start Date changes, revalidate eligibility and serialize against concurrent employee status/leave changes through a write to that employee document (for example an internal version increment).
4. In Progress -> Completed, Todo/In Progress -> Cancelled, and deletion of an active task decrement the counter exactly once in the same transaction as the task mutation. Todo -> In Progress leaves the count unchanged.
5. Delete employee by a guarded soft-delete operation with `activeTaskCount == 0`. Assignment and deletion write the same employee document, so concurrent operations cannot both bypass the guard.
6. Read/validate current task state within the transaction, use conditional task writes as appropriate, and handle transaction retries/write conflicts. Two concurrent completion/delete/reassign requests cannot double-decrement or apply stale status transitions. Do not turn capacity failures into generic 500s.

Enforce employee status/leave updates through the same service discipline so concurrent eligibility changes and task assignments serialize. Use driver/Mongoose transaction helpers with supported retry behavior. Use stable document update ordering where practical for multi-employee operations. Fail clearly if transaction prerequisites are missing; never silently switch to count-then-insert.

Keep the counter internal. Dashboard workload should be aggregated from task records on the backend; compare it with counter behavior in tests. Seed data must initialize both consistently. A brief README explanation should show why naive count-then-create races and how this implementation prevents a fourth active task.

## Deletion and historical names

Soft-delete employees with `deletedAt`. Exclude them from normal employee queries and assignment options, while explicitly allowing task detail/list/export relationship lookup to read their retained identity. Show a small Deleted indicator where helpful. This preserves meaningful name/ID/email without dangling relations. Do not cascade-delete historical tasks. Do not accidentally apply an employee soft-delete query filter to historical task population. Deleted employees return 404 from normal employee routes; repeated deletion also returns 404.

## Query/UI data flow

- Parse and allowlist search/filter/sort keys on the backend. Escape search regex input. Use deterministic sort tie-breaking with `_id` and cap page size.
- Filter task employee-name search and sort/page in MongoDB, not after pagination. Prefer a joined aggregation that matches the retained employee name OR task title, then filters, sorts and paginates in the database.
- Reuse the same filter builder for list and CSV; omit pagination from export.
- Query parameters are the list UI source of truth. Back/forward, refresh and copied links restore state. Reset page to 1 after a filter/search/sort change. Preserve list query state when returning from detail/edit pages.
- After writes, invalidate/refetch affected lists, employee selectors, task details and dashboard; avoid stale capacity/summary displays.
- Do not fetch every employee to populate an assignment selector: use paginated/searchable server results. Include On Leave employees as selectable when eligible for the chosen start date, or let the backend explain a rejection.

## Delivery

Use a Vite-compatible frontend host and Node-compatible backend host with a transaction-capable MongoDB database. These are suggestions, not mandatory provider choices. Verify provider-specific instructions and support at deployment time. Configure production CORS explicitly, API base URL at frontend build time, backend environment variables, health check and SPA fallback. Never expose MongoDB credentials in a `VITE_` variable. No deployment provider plan/pricing is assumed here.

## Implemented decisions (24 October 2026)

The application uses npm workspaces, Vite/React Router, Express 5, Mongoose 8 and Zod 4. The transactional employee counter, guarded soft delete, UTC string calendar dates and aggregation query plan above are implemented. The local replica set is configured by `docker-compose.yml`; it is initialized once with the command in README. No seed command is included because sample data is optional. Task CSV uses a MongoDB cursor and buffers the response in memory for this assignment-sized dataset. The browser uses native fetch and refetches on route navigation or after in-place status/delete actions.
