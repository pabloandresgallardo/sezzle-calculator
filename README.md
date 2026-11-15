# Sezzle Calculator
AI-ENGINEERING-MANAGED

## Overview

Full-stack calculator: a React + TypeScript SPA that delegates every arithmetic operation to a REST microservice (Java 21 + Spring Boot 4, hexagonal architecture).

> **Status:** v1 implements `add`, `subtract`, `multiply` and `divide` end to end (UI → REST API → domain), built with TDD.
> Planned for iteration 2: `power`, `sqrt`, `percentage`.

The calculator works like a physical one: operations chain left to right (`2 + 3 × 4 = 20`), `±` (or `F9`) negates, and it can be driven entirely from the keyboard (`0-9`, `.`/`,`, `+ - * /`, `Enter`/`=`, `Esc`, `Backspace`, paste).

## Getting started

### Prerequisites

| Tool | Version |
|------|---------|
| JDK | 21 |
| Maven | 3.9+ |
| Node.js | 22 LTS (`.nvmrc` — use `fnm` or `nvm`) |
| Docker + Compose | for `make run` and `make e2e` |

### Setup

```bash
make install          # frontend + e2e dependencies, Playwright browsers
cp .env.example .env  # optional: override ports
```

### Running

| Command | What it does | URL |
|---------|--------------|-----|
| `make run` | Full stack in Docker (nginx + backend) | http://localhost:3000 |
| `make run-backend` | Backend only | http://localhost:8090 |
| `make run-frontend` | Vite dev server, proxies `/api` to `:8090` | http://localhost:5180 |

Ports default to `8090` / `5180` / `3000` and are configurable via `.env`.

## Architecture

### Repository layout

```
backend/    Java 21 · Spring Boot 4.1 · Maven — hexagonal microservice
frontend/   React 19 · TypeScript 6 · Vite 8 — feature-based + atomic UI
e2e/        Playwright end-to-end suite against the dockerized stack
.ai/        Architecture, conventions, testing strategy, ADRs and diagrams
```

### API

> Contract defined in ADR-001 and ADR-002. A future Go backend implements this exact contract.

```http
POST /api/v1/calculate
Content-Type: application/json

{ "operation": "divide", "operands": [1, 3] }
```

```json
200 OK
{ "operation": "divide", "result": "0.3333333333" }
```

```json
400 Bad Request — application/problem+json
{ "title": "Division by zero", "status": 400, "detail": "division by zero", "instance": "/api/v1/calculate" }
```

- `operation`: `add` | `subtract` | `multiply` | `divide` — lowercase, exact match.
- `operands`: exactly 2 **JSON numbers**. Each must have ≤ 15 significant digits, absolute value < 10^15 and ≤ 10 decimal places. These limits keep every number exactly representable in the browser and bound the cost of a request.
- `result` is a **decimal string** computed with `BigDecimal`: `0.1 + 0.2` returns `"0.3"`, and there is no scientific notation (`1e15 × 1e15` returns `"1000000000000000000000000000000"`).
- Division: scale 10, `HALF_EVEN`, trailing zeros stripped (`1 / 3` → `"0.3333333333"`, `6 / 3` → `"2"`).
- Strict contract: unknown fields, strings as numbers (`"1"`) and non-string operations are rejected.

Errors follow RFC 9457 (ProblemDetail). `type` is omitted, which is equivalent to `about:blank`. The `title` values are stable and part of the contract; `detail` is free English text. When a request breaks several rules, the first failing check wins: shape → operation → operand count → operand range → calculation.

| `title` | Status | When |
|---------|--------|------|
| `Malformed request` | 400 | Invalid JSON, missing or `null` field, wrong type, unknown field |
| `Unsupported operation` | 400 | Unknown `operation` (including `"ADD"`) |
| `Invalid operand count` | 400 | Not exactly 2 operands |
| `Operand out of range` | 400 | An operand breaks a limit (`detail` names it, e.g. `operands[1] has more than 10 decimal places`) |
| `Division by zero` | 400 | Divisor is zero |
| `Internal error` | 500 | Unexpected failure (no internals exposed) |

Interactive docs: http://localhost:8090/swagger-ui.html (OpenAPI 3.1 at `/v3/api-docs`, titled "Sezzle Calculator API" `v1`) · Health: `GET /actuator/health`

### Design decisions

- **Hexagonal backend** — the domain is plain Java with no Spring imports, so it can be ported to Go behind the same contract.
- **Single generic endpoint** — new operations extend an enum instead of adding routes; the contract stays stable across backend implementations.
- **BigDecimal + string results** — exact decimal arithmetic end to end; JSON numbers would be coerced to IEEE-754 doubles in the browser.
- **Operand limits enforced in both layers** — the domain `Operand` validates and normalizes every input, so a short request like `[1e999999999, 0.1]` or `[0e-999999, 1]` cannot force a huge `BigDecimal` computation. The UI applies the same limits while typing.
- **Pure reducer state machine in the UI** — all calculator behavior (chaining, sign, paste, errors, limits) lives in a framework-free reducer that is unit tested without the DOM.
- **Same-origin everywhere** — Vite (dev) and nginx (Docker) proxy `/api`, so no CORS configuration is needed.
- **Feature-based + atomic UI** — features at the top level, atoms/molecules/organisms inside each feature.

Full rationale and discarded alternatives: [ADR-001](.ai/decisions/ADR-001-stack-selection.md) (stack) and [ADR-002](.ai/decisions/ADR-002-operaciones-basicas-contrato-y-modelo.md) (basic operations: model, limits, strict contract).

## Development

| Command | Purpose |
|---------|---------|
| `make lint` | Spotless (Palantir Java Format) + ESLint + Prettier |
| `make format` | Apply Spotless and Prettier |
| `make build` | Backend jar + frontend production bundle |
| `cd frontend && npm run test:watch` | Frontend TDD loop |

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

## Testing

| Command | Scope |
|---------|-------|
| `make test` | Unit tests (backend + frontend) |
| `make coverage` | Unit + integration tests with a **90%** coverage gate |
| `make e2e` | Playwright (Chromium, Firefox, WebKit, mobile) against an isolated Docker stack on an ephemeral port |

Coverage reports: `backend/target/site/jacoco/index.html`, `frontend/coverage/index.html`.

## Documentation

- [`.ai/architecture.md`](.ai/architecture.md) — modules, contract, networking
- [`.ai/conventions.md`](.ai/conventions.md) — code style and naming
- [`.ai/testing.md`](.ai/testing.md) — test strategy and required cases
- [`.ai/guardrails.md`](.ai/guardrails.md) — blocking / required / guidance rules
- [`.ai/decisions/`](.ai/decisions/) — architecture decision records
- [`.ai/diagrams/`](.ai/diagrams/) — architecture and data-flow diagrams (Mermaid source + PNG)

## Integrations

- **GitHub Actions** (`.github/workflows/ci.yml`): backend `mvn verify`, frontend lint + coverage + build, and Playwright e2e on every push to `main` and every pull request.

No external runtime services (databases, caches, third-party APIs).

## Guardrails

- The `POST /api/v1/calculate` contract does not change without a new ADR — a Go backend will implement the same contract.
- Backend arithmetic uses `BigDecimal` only; `result` is always a decimal string.
- 90% line and branch coverage gate on both layers; TDD for every behavior change.

Full list: [`.ai/guardrails.md`](.ai/guardrails.md).
