# Task Management GraphQL API

A GraphQL API where users register, log in, and then manage their own tasks: create, view, update, delete, filter, search and complete them.

**Stack:** Node.js · TypeScript · Apollo Server 5 · Prisma ORM 6.19.3 · Neon PostgreSQL · JWT (jsonwebtoken) · bcryptjs

## Contents

- [Requirements](#requirements)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Database and migrations](#database-and-migrations)
- [Running the server](#running-the-server)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Authentication](#authentication)
- [Testing with Postman](#testing-with-postman)
- [API reference](#api-reference)
- [Example operations](#example-operations)
- [Errors](#errors)
- [Testing](#testing)

## Requirements

- Node.js 20 or newer (developed on Node 24)
- npm
- A Neon PostgreSQL database (or any PostgreSQL 13+ database)

## Setup

```bash
npm install
cp .env.example .env          # then edit .env with your connection string
npm run prisma:generate       # generates the client into src/generated/prisma
npm run prisma:deploy         # applies the migrations in prisma/migrations
npm run dev                   # http://localhost:4000/graphql
```

## Environment variables

`.env` is loaded with dotenv by `src/config/env.ts` (for the app) and by `prisma.config.ts` (for the Prisma CLI). `.env` is listed in `.gitignore`. Never commit it.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string, e.g. `postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require`. |
| `JWT_SECRET` | yes | Secret for signing login tokens. At least 32 random characters. |
| `JWT_EXPIRES_IN` | no | Token lifetime, e.g. `15m`, `12h`, `7d`. Default `7d`. |
| `PORT` | no | HTTP port. Default `4000`. |
| `NODE_ENV` | no | `development` (default), `production` or `test`. |
| `CORS_ORIGIN` | no | Allowed CORS origin. Default `*`. |
| `TEST_DATABASE_URL` | no | Database used by `npm test` instead of `DATABASE_URL`. |

The app checks that `DATABASE_URL` and `JWT_SECRET` are set at startup. It never logs either value.

## Database and migrations

The schema is in [prisma/schema.prisma](prisma/schema.prisma). It defines:

- **`User` model:** `id`, `name`, `email` (unique, stored lower-case), `passwordHash` (bcrypt), `createdAt`, `updatedAt`.
- **`Task` model:** `id`, `title`, `description?`, `completed` (default `false`), `priority` (default `MEDIUM`), `dueDate?`, `userId` (owner, required), `createdAt`, `updatedAt`. Deleting a user deletes their tasks.
- **`Priority` enum:** `LOW`, `MEDIUM`, `HIGH`.

Migrations live in [prisma/migrations](prisma/migrations):

- `20261019000000_init` creates the initial tables.
- `20261019120000_add_auth` adds `User.passwordHash`, makes `Task.userId` required, and adds an index on `(userId, createdAt)`. It fails safely, changing nothing, if the tables already contain users or tasks without an owner.

| Task | Command |
| --- | --- |
| Apply pending migrations (safe, non-interactive) | `npm run prisma:deploy` |
| Check migration status | `npm run prisma:status` |
| Create a new migration after editing the schema (development only) | `npm run prisma:migrate -- --name <change-name>` |
| Regenerate the Prisma Client | `npm run prisma:generate` |

> `prisma migrate dev` needs a temporary shadow database, which Neon supports. If it reports drift, it may offer to **reset** the database, which deletes all data. Decline the reset and investigate first. Never run `prisma migrate reset` against a database whose data you want to keep.

## Running the server

```bash
npm run dev      # development: watches files with tsx and reloads automatically
npm run build    # compiles src/ to dist/
npm start        # runs dist/index.js with NODE_ENV=production
```

- GraphQL endpoint: `http://localhost:4000/graphql` (GET and POST)
- Health check: `http://localhost:4000/health`

**Apollo Sandbox:** in development, open `http://localhost:4000/graphql` in a browser to get an interactive explorer.

**Production mode** changes three things:

- Introspection and Sandbox are turned off.
- Stack traces are removed from error responses.
- Unexpected errors return a generic message.

The server connects to the database before it starts listening and exits with a clear message if the connection fails. On `SIGINT`/`SIGTERM` it lets in-flight requests finish, then disconnects Prisma.

## Scripts

| Script | Description |
| --- | --- |
| `dev` | Run in watch mode with `tsx watch src/index.ts`. |
| `build` | Compile with `tsc -p tsconfig.build.json` into `dist/`. |
| `start` | Run the compiled app in production mode. |
| `typecheck` | Type-check `src/` and `test/` without emitting files. |
| `test` | Run the integration tests (see [Testing](#testing)). |
| `prisma:generate` | Generate the Prisma Client. |
| `prisma:migrate` | `prisma migrate dev` (create and apply migrations in development). |
| `prisma:deploy` | `prisma migrate deploy` (apply existing migrations). |
| `prisma:status` | `prisma migrate status`. |

## Project structure

```text
prisma/
  schema.prisma            Prisma data model
  migrations/              SQL migrations
prisma.config.ts           Prisma CLI config (loads .env)
src/
  index.ts                 Entry point: connect DB, start Apollo + HTTP, graceful shutdown
  httpServer.ts            Minimal node:http adapter that serves Apollo at /graphql (+ /health, CORS)
  config/
    env.ts                 Loads and validates environment variables (incl. JWT settings)
    prisma.ts              Single shared PrismaClient instance
  graphql/
    typeDefs.ts            GraphQL SDL
    resolvers.ts           Thin resolvers that call the service
    context.ts             Per-request context: reads the Bearer token, exposes requireUser()
    server.ts              ApolloServer factory and production-safe error formatting
  models/task.model.ts     Task input/output types (reuses Prisma's Task and Priority)
  models/user.model.ts     User/auth input and output types
  services/auth.service.ts Register, login, current user (bcrypt + JWT)
  services/task.service.ts Task business logic, validation and database access, scoped to the owner
  utils/
    errors.ts              GraphQL error helpers and Prisma error mapping
    validateDate.ts        Due-date parsing and validation
    validation.ts          ID, title, description, priority, name, email and password validation
    jwt.ts                 Signing and verifying login tokens
  generated/prisma/        Generated Prisma Client (git-ignored, from `prisma generate`)
test/
  helpers.ts               Test harness (rolled-back transactions)
  tasks.test.ts            Task integration tests
  auth.test.ts             Register/login/authorization/isolation tests
postman/
  collections/Task Management API/   Postman collection (v3, one file per request)
  environments/Local.environment.yaml
```

Resolvers delegate directly to the service layer, so there's no separate controller layer. The services are created with `createTaskService(db)` / `createAuthService(db)`, so they can run against the shared client or a transaction (used by the tests).

## Authentication

1. **Register** with `register(input: { name, email, password })`, or **log in** with `login(input: { email, password })`. Both return `{ token, user }`.
2. Send the token on every other request as an HTTP header:

   ```
   Authorization: Bearer <token>
   ```

3. Every task query and mutation, plus `me`, requires the token and works only on the logged-in user's tasks.

How it works:

- **Passwords** are hashed with bcrypt (10 rounds) and never returned. They must be 8–72 characters.
- **Emails** are trimmed and lower-cased, so `Ram@Example.com` and `ram@example.com` are the same account.
- **Tokens** are JWTs (HS256) whose `sub` claim is the user id. They expire after `JWT_EXPIRES_IN` (default 7 days); after that, log in again.
- **Errors:** a missing, invalid or expired token returns `UNAUTHENTICATED`. A wrong email or password returns the same `UNAUTHENTICATED` message either way, so it doesn't reveal which emails are registered.
- **Isolation:** another user's task behaves exactly like a task that doesn't exist (`NOT_FOUND`).

In Apollo Sandbox, add the header under **Headers** at the bottom of the operation panel.

## Testing with Postman

GraphQL has a single endpoint. Every operation is a `POST` to `{{baseUrl}}/graphql` with a JSON body `{ "query": "...", "variables": { ... } }`. The ready-made collection is in [postman/](postman/):

| Folder | Request | Operation | Needs token |
| --- | --- | --- | --- |
| Auth | Register | `register` (saves `token`) | no |
| Auth | Login | `login` (saves `token`) | no |
| Auth | Me | `me` | yes |
| Tasks | Create Task | `createTask` (saves `taskId`) | yes |
| Tasks | Get All Tasks | `tasks` | yes |
| Tasks | Filter Tasks | `tasks(filter: …)` | yes |
| Tasks | Get Task By ID | `task(id: …)` | yes |
| Tasks | Search Tasks | `searchTasks` | yes |
| Tasks | Update Task | `updateTask` | yes |
| Tasks | Complete Task | `completeTask` | yes |
| Tasks | Task Statistics | `taskStatistics` | yes |
| Tasks | Delete Task | `deleteTask` | yes |
| Error Cases | 6 requests | `UNAUTHENTICATED`, `BAD_USER_INPUT` and `NOT_FOUND` examples | mixed |

How the collection works:

- It uses **Bearer auth `{{token}}`** at the collection level, so every task request sends the token automatically.
- **Register** generates a unique email on each run. **Register** and **Login** save the returned JWT to the `token` collection variable, and **Create Task** saves `taskId` for the requests after it.
- To log in as an existing account, set the `email` and `password` collection variables, then send **Login**.

**Postman app (Import):** click **Import** and select these two files. Don't select the `postman/collections` folder: it's in Postman's v3 YAML format, which the Import dialog doesn't accept.

- `postman/Task Management API.postman_collection.json` (Collection v2.1, using Postman's GraphQL body mode)
- `postman/Local.postman_environment.json`

Then:

1. Select the **Local** environment, which sets `baseUrl` to `http://localhost:4000`.
2. Start the API with `npm run dev`.
3. Send **Auth → Register**, then the **Tasks** requests in order.

**Postman CLI:** run every request and its tests in order:

```bash
npm run dev   # in another terminal
postman collection run "postman/collections/Task Management API" -e postman/environments/Local.environment.yaml
```

Every run creates a new test user (`user.<timestamp>@example.com`) in the database the server is connected to.

## API reference

```graphql
enum Priority { LOW MEDIUM HIGH }

type Task {
  id: ID!
  title: String!
  description: String
  completed: Boolean!
  priority: Priority!
  dueDate: String        # ISO 8601, UTC
  createdAt: String!
  updatedAt: String!
}

type User { id: ID!  name: String!  email: String!  createdAt: String! }
type AuthPayload { token: String!  user: User! }

type Query {
  me: User!
  tasks(filter: TaskFilterInput): [Task!]!
  task(id: ID!): Task!
  searchTasks(search: String!): [Task!]!
  taskStatistics: TaskStatistics!
}

type Mutation {
  register(input: RegisterInput!): AuthPayload!   # { name, email, password }
  login(input: LoginInput!): AuthPayload!         # { email, password }
  createTask(input: CreateTaskInput!): Task!
  updateTask(id: ID!, input: UpdateTaskInput!): Task!
  deleteTask(id: ID!): DeleteTaskResponse!
  completeTask(id: ID!): Task!
}
```

The full SDL is in [src/graphql/typeDefs.ts](src/graphql/typeDefs.ts).

### Validation rules

- **Title** is trimmed. It must not be empty or only whitespace, and can be at most 255 characters.
- **Description** is optional and trimmed. A blank description is stored as `null`. Maximum 5,000 characters.
- **Priority** must be `LOW`, `MEDIUM` or `HIGH`. It defaults to `MEDIUM`.
- **dueDate** is optional. It must be an ISO 8601 date (`2026-11-01`) or date-time (`2026-11-01T12:00:00.000Z`). Dates that don't exist on the calendar, such as `2026-02-31`, are rejected.
- **IDs** must be positive integers that fit PostgreSQL `INTEGER`. They're validated before reaching Prisma.
- **Updates** change only the fields you send:
  - An omitted field is left unchanged.
  - `null` clears `description` or `dueDate`.
  - `null` for `title`, `priority` or `completed` is rejected.
  - An empty input `{}` is rejected.
- **Filters** in `TaskFilterInput` are combined with AND. Results are sorted by `createdAt`, newest first.
- **Search** is a case-insensitive partial match on the title, and `%` and `_` are treated literally. An empty or whitespace-only search returns all tasks.

## Example operations

Every operation below except `register` and `login` needs the `Authorization: Bearer <token>` header.

**Register / log in**

```graphql
mutation {
  register(input: { name: "Ram", email: "ram@example.com", password: "Passw0rd!123" }) {
    token
    user { id name email }
  }
}

mutation {
  login(input: { email: "ram@example.com", password: "Passw0rd!123" }) {
    token
  }
}

query {
  me { id name email }
}
```

With curl:

```bash
TOKEN=$(curl -s http://localhost:4000/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation { login(input: { email: \"ram@example.com\", password: \"Passw0rd!123\" }) { token } }"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.login.token')

curl -s http://localhost:4000/graphql -H 'content-type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ tasks { id title completed priority } }"}'
```

**Create a task**

```graphql
mutation {
  createTask(
    input: {
      title: "Learn GraphQL"
      description: "Build a task management API"
      priority: HIGH
      dueDate: "2026-11-01T12:00:00.000Z"
    }
  ) {
    id title description completed priority dueDate createdAt updatedAt
  }
}
```

**Get all tasks / filter tasks**

```graphql
query {
  tasks { id title completed priority dueDate }
}

query {
  tasks(filter: { completed: false, priority: HIGH }) { id title priority completed }
}
```

**Get a single task**

```graphql
query {
  task(id: "1") { id title description completed priority }
}
```

**Update a task** (omitted fields are kept)

```graphql
mutation {
  updateTask(id: "1", input: { title: "Finish GraphQL project", priority: MEDIUM }) {
    id title priority updatedAt
  }
}

# Clear the due date
mutation {
  updateTask(id: "1", input: { dueDate: null }) { id dueDate }
}
```

**Complete a task / delete a task**

```graphql
mutation {
  completeTask(id: "1") { id title completed }
}

mutation {
  deleteTask(id: "1") { success message }
}
```

**Search tasks / statistics**

```graphql
query {
  searchTasks(search: "GraphQL") { id title priority }
}

query {
  taskStatistics {
    totalTasks
    completedTasks
    pendingTasks
    tasksByPriority { priority count }
  }
}
```

## Errors

Errors use standard GraphQL `extensions.code` values:

| Code | When |
| --- | --- |
| `BAD_USER_INPUT` | Invalid input: empty title, malformed ID, invalid date or priority, empty update, invalid email/password/name, email already registered. `extensions.field` names the field when relevant. |
| `UNAUTHENTICATED` | Missing, invalid or expired token, or wrong email/password at login. |
| `NOT_FOUND` | The task doesn't exist or belongs to another user (`task`, `updateTask`, `deleteTask`, `completeTask`). |
| `INTERNAL_SERVER_ERROR` | Unexpected failure. The client gets a generic message; details are only logged on the server. |

Example:

```json
{
  "errors": [{
    "message": "Task with id 42 was not found.",
    "path": ["task"],
    "extensions": { "code": "NOT_FOUND" }
  }],
  "data": null
}
```

## Testing

```bash
npm test
```

The tests use Node's built-in test runner (`node:test`, run through `tsx`), so they need no extra dependencies. They send real GraphQL operations through Apollo Server to the database. Each test registers its own throwaway user. They cover:

- Register, login, duplicate emails, and password and email validation
- Missing, invalid, forged and expired tokens
- Users not being able to see or change each other's tasks
- Creating tasks
- Rejecting empty titles, invalid dates and invalid priorities
- Listing, sorting and filtering
- Fetching by ID, including `NOT_FOUND` and invalid IDs
- Partial updates and clearing fields with `null`
- Deleting and completing tasks
- Search, including empty search and wildcard handling
- Statistics

**Data safety:** each test runs inside a database transaction that is always rolled back, so tests never commit rows or change existing data. The one visible side effect is that the `Task` ID sequence advances. To keep tests completely separate, set `TEST_DATABASE_URL` to a dedicated database, for example a Neon branch, and run `npm run prisma:deploy` against it once.
