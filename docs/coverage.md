# Coverage report

The numbers below are real. I generated them with `make coverage` on 2026-11-15, from the same tree as the commit that adds this file. Each code base has a **90% gate** that fails the build, both locally and in CI.

| Code base | Lines | Branches | Functions / methods | Gate |
|---|---|---|---|---|
| Go (`backend/go`, `internal/...`) | 98.4% of statements | n/a (Go reports statements) | — | 90% of statements in `internal/...` |
| Java (`backend/java`) | 100% (154/154) | 100% (52/52) | 100% (61/61) | 90% lines and branches (JaCoCo) |
| Frontend (`frontend/src`) | 100% (343/343) | 97.92% (283/289) | 100% (85/85) | 90% (Vitest thresholds) |

## How to regenerate

```bash
make coverage
```

`make coverage` runs every suite with its gate and writes the full HTML reports to these locations; they are not committed:

| Code base | Report |
|---|---|
| Go | `backend/go/coverage/coverage.out`; open it with `cd backend/go && go tool cover -html=coverage/coverage.out` |
| Java | `backend/java/target/site/jacoco/index.html` (unit + integration tests) |
| Frontend | `frontend/coverage/index.html` |

CI uploads the same three reports as artifacts on every run: `backend-go-coverage`, `backend-java-coverage` and `frontend-coverage`.

## Go — by package

`go test -race -coverprofile=coverage/coverage.out ./...`

| Package | Statements |
|---|---|
| `internal/app` | 100.0% |
| `internal/domain` | 100.0% |
| `internal/decimal` | 99.6% |
| `internal/httpapi` | 97.0% |
| `cmd/server` | 69.4% (left out of the gate) |
| **`internal/...` (gated)** | **98.4%** |
| All packages | 96.5% |

The gate covers only `internal/...`, where all the logic lives. `cmd/server` is the process entry point: `main`, signal handling and graceful shutdown. `cmd/server/main_test.go` covers part of it, including the `-healthcheck` flag and serving requests. The untested lines are mostly `main` and the signal-driven shutdown path.

## Java — by package

The JaCoCo report merges unit and integration tests. `CalculatorApplication` (the Spring Boot entry point) and `config/**` (Jackson and OpenAPI wiring) are excluded from the gate. The integration tests still exercise that wiring end to end.

| Package | Lines | Branches |
|---|---|---|
| `domain.model` | 100% (92/92) | 100% (40/40) |
| `domain.exception` | 100% (19/19) | 100% (6/6) |
| `application.service` | 100% (13/13) | 100% (4/4) |
| `application.port.in` | 100% (1/1) | — |
| `adapter.in.web` | 100% (29/29) | 100% (2/2) |

## Frontend — by folder

| Folder | Lines | Branches |
|---|---|---|
| `src/features/calculator/model` (pure state machine) | 100% | 99.2% (120/121) |
| `src/features/calculator/hooks` | 100% | 95.8% (46/48) |
| `src/features/calculator/api` | 100% | 96.6% (28/29) |
| `src/features/calculator/atoms` | 100% | 100% (11/11) |
| `src/features/calculator/molecules` | 100% | 100% (4/4) |
| `src/features/calculator/organisms` | 100% | — |
| `src/shared/backend` (selector, health, failover) | 100% | 96.1% (49/51) |
| `src/shared/theme` | 100% | 100% (18/18) |
| `src/app`, `src` | 100% | 100% |

## What coverage does not include

Coverage counts unit and integration tests only. Two more suites run in Docker and CI and add behavioral evidence that these percentages do not show:

- **Contract tests:** the same 80 parity cases, compared byte for byte, run against Go, against Java, and against both through nginx.
- **Playwright E2E:** 141 tests per browser project.
