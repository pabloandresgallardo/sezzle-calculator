# Testing — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15 · evidencia verificada — 2026-11-15

## Evidencia observada

| Elemento | Estado | Fuente |
|----------|--------|--------|
| JaCoCo 0.8.16: gate de 0.90 en LINE y BRANCH; excluye `CalculatorApplication` y `config/**` | configurado | `backend/pom.xml` |
| failsafe 3.6.1 (`integration-test` + `verify`) | configurado | `backend/pom.xml` |
| Vitest: jsdom, `src/test/setup.ts`, `passWithNoTests`, umbrales de 90 | configurado | `frontend/vite.config.ts` |
| Playwright: chromium, firefox, webkit, Pixel 7 | configurado | `e2e/playwright.config.ts` |
| E2E en puerto efímero con proyecto `sezzle-e2e` | configurado | `Makefile`, `docker-compose.test.yml` |
| Tests de backend | unitarios: `OperandTest`, `OperationTest`, `OptionalOperationsTest`, `PowerBoundsTest`, `CalculationResultTest`, `CalculatorServiceTest`, `ProblemDetailHandlerTest`; slice: `CalculatorControllerTest`; integración: `CalculatorApiIT` (RANDOM_PORT) | `backend/src/test/java/` |
| Tests de frontend | modelo (reducer, límites, mensajes), API (MSW), hook, atoms, molecules, organism y App; tema (`theme`, `ThemeToggle`, script sin parpadeo, tokens y contraste AA) | `frontend/src/**/*.test.{ts,tsx}` |
| Tests E2E | `ui-operations`, `ui-errors`, `ui-edge-cases` (incluye layout a 360 px con 22 botones y bounding boxes), `ui-theme`, `api-contract` (solo chromium), `parity` (Java == Go == esperado, 78 casos vía nginx, solo chromium) y `ui-backend` (selector, ruteo, fallback por salud, failover, recuperación) | `e2e/tests/` |
| Tests Go | `decimal`, `domain`, `app`, `httpapi` (decoder, ProblemDetail, rutas, health, OpenAPI, Swagger) y `TestParityCases` (80 casos byte a byte); gate 90% sobre `internal/...` | `backend-go/internal/**/*_test.go` |
| Tests de contrato en Java | `ContractParityIT` (80 casos) y `OpenApiContractIT` | `backend/src/test/java/com/sezzle/calculator/` |
| WebKit local | La build WebKit de Playwright 1.65 se cae en macOS 14.3 (`Bus error: 10`). Se verifica en Linux: CI o la imagen `mcr.microsoft.com/playwright:v1.65.1-noble` | — |
| Última verificación (feat/go-backend, 2026-11-15) | Java `mvn verify`: 137 unitarios + 92 IT (incl. ContractParityIT 80 y OpenApiContractIT), gate JaCoCo cumplido · Go: `go test -race` en verde, gate 98.4% sobre `internal/...`, TestParityCases 80/80 · frontend: 344 tests, cobertura 99.71/97.92/100/100, lint y build · E2E: chromium/firefox/mobile 221 ✓, webkit (Linux) 40 ✓, parity Java == Go 78 casos · Docker: inicio limpio de 3 servicios sanos; con `backend-go` parado, sus rutas dan 502 en 0,1 s y Java sigue · `up.test.sh` OK | local + contenedor `mcr.microsoft.com/playwright:v1.65.1-noble` |

## Estrategia

**TDD estricto**: RED, GREEN, refactor. Ningún código de producción se escribe sin un test que falle primero.

Pirámide:

| Nivel | Backend | Frontend |
|-------|---------|----------|
| Unitario | JUnit 5 sobre `domain` y `application`, sin Spring | Vitest 5 + Testing Library 16 sobre atoms, molecules y `useCalculator` |
| Slice / componente | `@WebMvcTest` sobre `CalculatorController` | Organisms con `calculatorApi` mockeado por MSW 3 |
| Integración | `@SpringBootTest(webEnvironment = RANDOM_PORT)`, `*IT.java` (failsafe) | — |
| E2E | Playwright 1.65 contra docker-compose aislado | ← el mismo |

## Cobertura

- Mínimo **90% global**, en líneas y en branches. El build falla por debajo.
- Backend: JaCoCo 0.8.16. Unitarios e integración suman sobre el mismo `jacoco.exec`. Se excluyen `CalculatorApplication` y `config/**`.
- Frontend: `@vitest/coverage-v8`. Se excluyen `main.tsx`, `src/test/**` y `*.d.ts`.
- Reportes en `backend/target/site/jacoco/index.html` y `frontend/coverage/index.html`.

## Casos que tienen que estar cubiertos (v1)

| Categoría | Ejemplos |
|-----------|----------|
| Éxito | 4 operaciones; decimales (`0.1 + 0.2 = 0.3`); negativos; resultado cero |
| Error | División por cero; operación desconocida; 1 o 3 operandos; operando no numérico; body vacío o JSON inválido |
| Bordes | División periódica (`1 / 3 = 0.3333333333`); ceros finales (`6 / 3 = 2`); números muy grandes y muy chicos; `-0`; notación científica |
| UI | Número mal formado (`1..2`); pegar texto inválido; `Enter` / `Esc`; error del backend visible y recuperable; layout mobile |
| Iteración 2: éxito | `2 ^ 64`; `2 ^ -3 = 0.125`; `√2 = 1.4142135624`; `√16 = 4`; `20 % de 150 = 30`; `2 + 9 √ = 5`; encadenar después de `xʸ` |
| Iteración 2: error y bordes | `√(-4)` → `Invalid operand`; exponente `0.5` o `1000.5` → `Invalid operand`; exponente `1001` → `Operand out of range`; `10 ^ 100` → `Result out of range` (`10 ^ 99` se acepta); `0 ^ -1` → `Division by zero`; `999999999999999 ^ 1000` se rechaza sin calcular; aridad de `sqrt` |
| Tema | Abre en oscuro; alterna a claro; persiste al recargar; storage bloqueado o inválido → oscuro; `Enter` sobre el toggle no dispara `=` |

## E2E

- Corren contra `docker-compose.test.yml`, con el proyecto `sezzle-e2e` y nginx en un **puerto efímero del host**. No chocan con contenedores que ya estén corriendo y el stack se baja aunque los tests fallen.
- Navegadores: Chromium, Firefox, WebKit y Pixel 7 (mobile).
- Escenarios: éxito, error y bordes, con front y back reales, sin mocks.

## Comandos

| Comando | Qué hace |
|---------|----------|
| `make test` | Unitarios de backend y frontend |
| `make coverage` | Backend `mvn verify` (unitarios + IT + gate) y frontend `test:coverage` (con gate) |
| `make e2e` | Levanta el stack aislado, corre Playwright y lo baja |
| `cd frontend && npm run test:watch` | Ciclo TDD del front |

Primera vez: `make install`, que instala dependencias y navegadores de Playwright.
