# Sezzle Calculator
<!-- AI-ENGINEERING-MANAGED -->

Full-stack calculator: a React + TypeScript SPA that delegates every arithmetic operation to a REST microservice (Java 21 + Spring Boot 4, hexagonal architecture).

> **Status:** project scaffold. Operations are implemented in upcoming iterations following TDD.
> v1 scope: `add`, `subtract`, `multiply`, `divide`. Planned: `power`, `sqrt`, `percentage`.

## Repository layout

```
backend/    Java 21 · Spring Boot 4.1 · Maven — hexagonal microservice
frontend/   React 19 · TypeScript 6 · Vite 8 — feature-based + atomic UI
e2e/        Playwright end-to-end suite against the dockerized stack
.ai/        Architecture, conventions, testing strategy, ADRs and diagrams
```

## Prerequisites

| Tool | Version |
|------|---------|
| JDK | 21 |
| Maven | 3.9+ |
| Node.js | 22 LTS (`.nvmrc` — use `fnm` or `nvm`) |
| Docker + Compose | for `make run` and `make e2e` |

## Setup

```bash
make install          # frontend + e2e dependencies, Playwright browsers
cp .env.example .env  # optional: override ports
```

## Running

| Command | What it does | URL |
|---------|--------------|-----|
| `make run` | Full stack in Docker (nginx + backend) | http://localhost:3000 |
| `make run-backend` | Backend only | http://localhost:8090 |
| `make run-frontend` | Vite dev server, proxies `/api` to `:8090` | http://localhost:5180 |

Ports default to `8090` / `5180` / `3000` and are configurable via `.env`.

## API

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
{ "type": "about:blank", "title": "Division by zero", "status": 400, "detail": "Divisor must not be zero" }
```

- `operation`: `add` | `subtract` | `multiply` | `divide`
- `result` is a **decimal string** — computed with `BigDecimal`, so `0.1 + 0.2` returns `"0.3"`.
- Division: scale 10, `HALF_EVEN`, trailing zeros stripped.
- Errors follow RFC 9457 (ProblemDetail).

Interactive docs: http://localhost:8090/swagger-ui.html · Health: `GET /actuator/health`

## Testing

| Command | Scope |
|---------|-------|
| `make test` | Unit tests (backend + frontend) |
| `make coverage` | Unit + integration tests with a **90%** coverage gate |
| `make e2e` | Playwright (Chromium, Firefox, WebKit, mobile) against an isolated Docker stack on an ephemeral port |
| `make lint` | Spotless (Palantir) + ESLint + Prettier |

Coverage reports: `backend/target/site/jacoco/index.html`, `frontend/coverage/index.html`.

## Design decisions

- **Hexagonal backend** — the domain is plain Java with no Spring imports, so it can be ported to Go behind the same contract.
- **Single generic endpoint** — new operations extend an enum instead of adding routes; the contract stays stable across backend implementations.
- **BigDecimal + string results** — exact decimal arithmetic end to end; JSON numbers would be coerced to IEEE-754 doubles in the browser.
- **Same-origin everywhere** — Vite (dev) and nginx (Docker) proxy `/api`, so no CORS configuration is needed.
- **Feature-based + atomic UI** — features at the top level, atoms/molecules/organisms inside each feature.

Full rationale and discarded alternatives: [`.ai/decisions/ADR-001-stack-selection.md`](.ai/decisions/ADR-001-stack-selection.md).
