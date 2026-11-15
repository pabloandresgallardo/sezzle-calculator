# Testing — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15

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
