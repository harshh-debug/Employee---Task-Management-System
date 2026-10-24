# Proposed API contract

Only `PUT /api/tasks/:id/status` is mandated verbatim by the PDF. The rest is a proposed consistent contract; update this file if implementation decisions change.

Base path: `/api`. URL `:id` refers to MongoDB `_id`; expose `employeeId`/`taskId` separately as display IDs.

## Routes

| Method | Route | Behavior |
| --- | --- | --- |
| GET | /api/health | Process/readiness check; document response and DB behavior |
| GET | /api/employees | Search/filter/sort/paginate non-deleted employees |
| POST | /api/employees | Create employee |
| GET | /api/employees/:id | Employee details |
| PUT | /api/employees/:id | Validate/update writable employee fields |
| DELETE | /api/employees/:id | Guarded soft delete if no active tasks |
| GET | /api/tasks | Search/filter/sort/paginate tasks with employee summary |
| POST | /api/tasks | Create Todo task and reserve employee capacity |
| GET | /api/tasks/export | Download all matching tasks as CSV |
| GET | /api/tasks/:id | Task details with employee summary |
| PUT | /api/tasks/:id | Edit non-terminal task; prohibit status/completedAt writes |
| PUT | /api/tasks/:id/status | Validate and apply allowed status transition |
| DELETE | /api/tasks/:id | Delete task; release capacity if active |
| GET | /api/dashboard | Server-calculated counts and employee workload |

Register `/api/tasks/export` before `/api/tasks/:id`.

## Writable request bodies

Employee create/update fields: `employeeId`, `fullName`, `email`, `phone`, `department`, `role`, `joiningDate`, `status`, `skills`, `leaveStart`, `leaveEnd`.

Task create/update fields: `title`, `description`, `assignedEmployee` (employee `_id`), `department`, `priority`, `startDate`, `dueDate`.

Status body: `{ "status": "In Progress" }`. No other task fields in this endpoint. Never accept Completed Date from frontend, even when combined with an otherwise valid status request.

Use full validated form payloads for PUT. Reject unknown/protected fields with 400 rather than silently allowing status/timestamp changes. Provide field-level validation details when possible.

## List query parameters

| Key | Task list | Employee list |
| --- | --- | --- |
| search | Trimmed case-insensitive task title OR retained employee full name | Employee full name (ID/email search optional if documented) |
| department | Exact department enum | Exact department enum |
| priority | Exact task priority | Not applicable |
| status | Exact task status | Exact employee status |
| dueFrom, dueTo | Inclusive due-date range | Not applicable |
| sortBy | createdAt, dueDate, priority, title | createdAt, fullName, joiningDate |
| sortOrder | asc or desc | asc or desc |
| page | Positive integer, default 1 | Same |
| limit | Positive integer, default 10, maximum 100 | Same |

Default sort: `createdAt desc`. All supplied independent filters combine with AND; search internally uses title OR employee name. Priority ascending is Low -> Medium -> High -> Critical; descending reverses that. Add `_id` tie-breaker. Reject invalid enums, invalid dates/ranges and malformed numeric values with 400. A valid page beyond the last page returns empty data with accurate metadata.

CSV uses the same search/filter/sort query keys; pagination parameters are ignored for export. Example:
`GET /api/tasks/export?search=api&department=Development&priority=High&status=In%20Progress&dueFrom=2026-10-01&dueTo=2026-10-31&sortBy=dueDate&sortOrder=asc`

## Response conventions

Creation: HTTP 201. Reads/updates/status changes: HTTP 200. Deletion: HTTP 204 without JSON body.

List response:
```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
}
```

Single record: `{ "data": { ... } }`. Employee summaries in task responses should include `_id`, `employeeId`, `fullName`, `email`, `department`, and `isDeleted`. Task responses include computed `isOverdue` and `allowedNextStatuses`. Terminal tasks return `allowedNextStatuses: []`. Frontend may reuse constants but the backend remains authoritative.

Error shape:
```json
{
  "error": {
    "code": "EMPLOYEE_CAPACITY_EXCEEDED",
    "message": "This employee already has 3 active tasks. Choose another employee.",
    "fields": {}
  }
}
```

Use 400 for field errors, invalid IDs, illegal transitions, terminal edits, leave restrictions, capacity failures and active-task deletion blocks; 404 for a well-formed missing ID; 409 for duplicate employee ID/email. Unexpected failures return a generic 500 without stack traces/secrets. Retried transaction write conflicts must not leak misleading success.

Dashboard `data` shape:
```json
{
  "employees": { "total": 0, "active": 0, "inactive": 0, "onLeave": 0 },
  "tasks": { "total": 0, "todo": 0, "inProgress": 0, "completed": 0, "cancelled": 0, "overdue": 0 },
  "workload": [
    { "employeeId": "employee MongoDB _id", "employeeCode": "EMP-001", "fullName": "Example", "activeTasks": 0 }
  ]
}
```

All counts/workload come from DB queries/aggregation. Exclude deleted employees from employee totals/workload; keep their historical tasks in task totals. Return all non-deleted employees, including zero-workload employees, under the proposed small-assignment scope; do not paginate raw task records in React to calculate this.

CSV: `text/csv; charset=utf-8` with attachment filename. Include task ID/title/description, employee ID/name, department, priority/status, start/due/created/completed values and overdue. Use correct escaping for quotes, commas and newlines; neutralize formula-like user input while preserving actual calendar fields. Stream/export on the backend; do not export only currently fetched React rows.

## Frontend routes

`/dashboard` (and `/` redirect), `/employees`, `/employees/new`, `/employees/:id`, `/employees/:id/edit`, `/tasks`, `/tasks/new`, `/tasks/:id`, `/tasks/:id/edit`, and a useful not-found page.

Persist relevant list keys in the browser URL with React Router search parameters. Do not store only page number while losing filters on refresh. Use the same query semantics for list retrieval and export.

## Implemented notes (24 October 2026)

`GET /api/health` returns HTTP 200 and `{"status":"ok","database":"connected"}` when Mongoose is connected, or 503 while disconnected. The CSV endpoint reads matching records through an aggregation cursor, then buffers the CSV string before sending. The frontend uses native fetch and refetches lists after in-place writes. The optional seed endpoint/script proposed elsewhere was not added.
