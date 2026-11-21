# Splitwise Backend

A RESTful backend for a Splitwise-style expense-sharing application. The API supports user authentication, group management, shared expenses, balance calculations, and settlements, with PostgreSQL transactions and idempotency protections for critical financial operations.

## Overview

This repository contains the backend API built with Node.js, Express, TypeScript, and PostgreSQL. It is designed around clear API layers and reliable handling of concurrent expense and settlement requests.

**Related project:** [Splitwise Frontend](https://github.com/JuniorTechie-coder/Splitwise-Frontend)

## Features

- **Authentication:** user registration and login with password hashing, JWT-based authentication, and an HTTP-only access-token cookie.
- **Group management:** create groups, view groups and members, add members, and manage active membership.
- **Expense management:** create group expenses and split amounts equally between eligible group members.
- **Balance calculation:** calculate member balances from recorded expenses and splits.
- **Settlements:** retrieve settlement suggestions and record payments against outstanding balances.
- **Transaction safety:** use PostgreSQL transactions and row-level locking for critical operations.
- **Retry handling:** retry transactions for PostgreSQL deadlock and serialization failure errors.
- **Idempotency:** support idempotency keys for expense creation and settlement recording, including replaying the original response and rejecting key reuse with a different request.
- **Automated tests:** unit and PostgreSQL integration tests for core business logic and reliability scenarios.

## Technology Stack

| Area | Technologies |
|---|---|
| Runtime | Node.js |
| API | Express.js 5 |
| Language | TypeScript |
| Database | PostgreSQL |
| Database hosting | Neon (PostgreSQL) |
| Database client | node-postgres (pg) |
| Authentication | JSON Web Tokens, bcryptjs |
| Validation dependency | Zod |

## Architecture

The API follows a layered structure:

```text
Client
  |
  v
Express Routes
  |
  v
Authentication Middleware
  |
  v
Controllers
  |
  v
Services
  |
  v
PostgreSQL
```

Routes define the HTTP endpoints, middleware handles authentication, controllers coordinate request handling, and services contain reusable business and transaction logic.

## API Endpoints

All endpoints are prefixed with `/api`.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register a user |
| POST | `/auth/login` | Log in and set the authentication cookie |
| GET | `/auth/me` | Get the authenticated user's profile |
| POST | `/auth/logout` | Log out and clear the authentication cookie |

### Groups

| Method | Endpoint | Description |
|---|---|---|
| POST | `/groups` | Create a group |
| GET | `/groups` | List the authenticated user's groups |
| POST | `/groups/:groupId/members` | Add members to a group |
| GET | `/groups/:groupId/members` | List group members |
| DELETE | `/groups/:groupId/members/:memberId` | Remove a member when business rules allow |

### Expenses and settlements

| Method | Endpoint | Description |
|---|---|---|
| POST | `/groups/:groupId/expenses` | Create a group expense |
| GET | `/groups/:groupId/expenses` | List group expenses |
| GET | `/groups/:groupId/balances` | Get group member balances |
| GET | `/groups/:groupId/settlements` | Get settlement suggestions |
| POST | `/groups/:groupId/settlements` | Record a settlement |

Protected endpoints require the authentication cookie set during login. Expense creation and settlement recording support an `Idempotency-Key` request header; use a unique key for each logical operation.

## Data and financial calculations

The database includes tables for users, groups, group membership, expenses, expense splits, settlements, and idempotency records.

Monetary values are stored as integer paise rather than floating-point rupees. This avoids floating-point precision issues when splitting and reconciling amounts.

## Reliability and concurrency

Expense creation and settlement recording use database transactions. The transaction helper handles rollback and releases database connections, and retries selected PostgreSQL transaction errors (deadlocks and serialization failures).

Idempotency records are associated with a request hash. A repeated request with the same key and matching payload can receive the stored response; reusing the key with a different payload is treated as a conflict.

## Project structure

```text
src/
├── config/
│   ├── db.ts
│   └── testDb.ts
├── controllers/
│   ├── authController.ts
│   ├── groupController.ts
│   └── expenseController.ts
├── middleware/
│   └── authMiddleware.ts
├── routes/
│   ├── authRoutes.ts
│   ├── groupRoutes.ts
│   └── expenseRoutes.ts
├── services/
│   ├── balanceService.ts
│   ├── transactionService.ts
│   └── idempotencyService.ts
├── types/
└── index.ts
```

The exact files may evolve as the project develops.

## Getting started

### Prerequisites

- Node.js and npm
- A PostgreSQL database (the project can use a Neon connection string)

### 1. Clone the repository

```bash
git clone https://github.com/JuniorTechie-coder/spliteiwse-backend.git
cd spliteiwse-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=5000
DATABASE_URL=your_postgresql_connection_string
JWT_ACCESS_SECRET=your_secure_jwt_secret
CLIENT_URL=http://localhost:3000
TEST_DATABASE_URL=your_test_database_connection_string
```

- `DATABASE_URL` is the application database connection string.
- `JWT_ACCESS_SECRET` must be a long, private secret.
- `CLIENT_URL` should match the origin of the frontend so the API can configure CORS correctly.
- `TEST_DATABASE_URL` is required when running PostgreSQL integration tests. Use a separate test database.

Create the database schema before starting the API. Do not use a production database for integration tests.

### 4. Start the development server

```bash
npm run dev
```

The API uses port `5000` by default, unless `PORT` is configured differently.

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server with file watching |
| `npm run build` | Compile TypeScript |
| `npm run start` | Run the compiled application |
| `npm run typecheck` | Run TypeScript checks without emitting files |

Run an individual Node test file with:

```bash
node --import tsx --test path/to/your.test.ts
```

PostgreSQL integration tests require a correctly configured `TEST_DATABASE_URL`.

## Current scope

Implemented functionality includes authentication, group and membership management, expense creation and listing, balance calculation, settlement suggestions and recording, transaction retry handling, and idempotency for critical write operations.

Expense pagination/filtering and OpenAPI/Swagger documentation are not yet implemented.

## Related repository

- [Splitwise Frontend](https://github.com/JuniorTechie-coder/Splitwise-Frontend)
