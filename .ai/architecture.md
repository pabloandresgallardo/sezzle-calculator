# Arquitectura — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15 · evidencia verificada — 2026-11-15

## Evidencia observada

Las secciones siguientes describen la arquitectura acordada en ADR-001. Esta tabla separa lo que ya existe de lo que está pendiente.

| Elemento | Estado | Fuente |
|----------|--------|--------|
| Entry point Spring Boot | presente | `backend/src/main/java/com/sezzle/calculator/CalculatorApplication.java` |
| Dominio: `Operation` (enum con `apply`, `fromCode`, `arity`), `Operand` (record que valida y normaliza), `CalculationResult` y 4 excepciones de dominio sobre `CalculationException` | implementado | `backend/.../domain/model/`, `backend/.../domain/exception/` |
| Aplicación: puerto `CalculateUseCase` + `CalculateCommand`; `CalculatorService` aplica el orden de validación | implementado | `backend/.../application/` |
| Adapter web: `CalculatorController` (`POST /api/v1/calculate`), DTOs (records), `ProblemDetailHandler` | implementado | `backend/.../adapter/in/web/` |
| Config: `JacksonConfig` (estricto: sin conversión de tipos, campos desconocidos fallan), `OpenApiConfig` (título "Sezzle Calculator API", `v1`) | implementado | `backend/.../config/` |
| Puerto `${SERVER_PORT:8090}`, actuator health, rutas de springdoc | configurado | `backend/src/main/resources/application.yml` |
| Frontend: `App` → `CalculatorPanel` → `DisplayPanel` y `Keypad` → `Display` y `CalcButton` | implementado | `frontend/src/app/`, `frontend/src/features/calculator/{atoms,molecules,organisms}/` |
| Modelo del frontend: `calculatorReducer` (máquina de estados pura), `limits`, `errorMessages`, `types` | implementado | `frontend/src/features/calculator/model/` |
| `useCalculator` (efectos de API con `AbortController`, teclado y paste en `window`) y `calculatorApi` (fetch tipado) | implementado | `frontend/src/features/calculator/{hooks,api}/` |
| `shared/` | vacío (`.gitkeep`) | `frontend/src/shared/` |
| Vite en `:5180`: `/api/java` → `:8090`, `/api/go` → `:8091` (quita el prefijo; `/health` → `/actuator/health`), `/api` → Java | configurado | `frontend/vite.config.ts` |
| nginx: `resolver 127.0.0.11` y `proxy_pass` con variables; `/api/java/` → `backend-java:8090/api/`, `/api/go/` → `backend-go:8091/api/`, `/api/{b}/health` → `/actuator/health`, `/api/` → Java; `proxy_connect_timeout 2s` | configurado | `frontend/nginx.conf` |
| Stack Docker de 3 servicios (`backend-java`, `backend-go`, `web` con `service_started`) con healthchecks | configurado | `backend/Dockerfile`, `backend-go/Dockerfile`, `frontend/Dockerfile`, `docker-compose*.yml` |
| Backend Go: `decimal` (math/big), `domain`, `app`, `httpapi` (decoder estricto tipo Jackson, ProblemDetail, health, OpenAPI embebido + Swagger UI), `cmd/server` (`-healthcheck`) | implementado | `backend-go/` |
| Contrato compartido: 80 casos de paridad + OpenAPI | implementado | `contract/` |
| Frontend: selección de backend (`checkHealth`, `useBackends`, `BackendSelector`), failover con un reintento | implementado | `frontend/src/shared/backend/`, `features/calculator/{api,hooks}/` |

## Visión

Calculadora fullstack en un monorepo. El frontend React consume un único endpoint REST del backend Java. El backend es **stateless**: no persiste nada ni tiene puertos de salida.

Diagramas: `.ai/diagrams/architecture-overview.png`, `.ai/diagrams/data-flow.png`.

## Estructura del repositorio

| Carpeta | Contenido |
|---------|-----------|
| `backend/` | Microservicio Java 21 + Spring Boot 4.1.2 (Maven) |
| `frontend/` | SPA React 19.3 + TypeScript 6.0 + Vite 8 |
| `e2e/` | Suite Playwright 1.65 contra el stack dockerizado |
| `.ai/` | Documentación de ingeniería, ADRs y diagramas |

## Backend — Hexagonal (ports & adapters)

Paquete raíz `com.sezzle.calculator`:

| Paquete | Responsabilidad | Depende de |
|---------|-----------------|------------|
| `domain.model` | `Operation`, operandos y reglas de cálculo con BigDecimal. Java puro | nada |
| `domain.exception` | Errores de dominio (por ejemplo, divisor cero) | nada |
| `application.port.in` | `CalculateUseCase`, el puerto de entrada | domain |
| `application.service` | `CalculatorService`, implementa el puerto | domain |
| `adapter.in.web` | `CalculatorController`, DTOs (records) y handler de ProblemDetail | application |
| `config` | Wiring de Spring (excluido de la cobertura) | todos |

Regla de dependencia: `adapter → application → domain`. El dominio no importa nada de Spring, así la lógica se puede portar a Go sin cambios conceptuales.

Sin puertos de salida: el servicio no tiene historial ni persistencia en la v1.

## Contrato REST (v1)

```
POST /api/v1/calculate
Content-Type: application/json

{ "operation": "add" | "subtract" | "multiply" | "divide" | "power" | "sqrt" | "percentage",
  "operands": [number] (sqrt) | [number, number] (resto) }
```

| Caso | Respuesta |
|------|-----------|
| Éxito | `200 {"operation": "divide", "result": "2"}`: `result` es un **string** decimal |
| Operación desconocida, cantidad de operandos inválida, número malformado | `400` ProblemDetail (RFC 9457) |
| Divisor cero | `400` ProblemDetail, `title: "Division by zero"` |
| `sqrt` de negativo o exponente no entero | `400` ProblemDetail, `title: "Invalid operand"` |
| Resultado de `power` con más de 100 dígitos enteros | `400` ProblemDetail, `title: "Result out of range"` |

Reglas de `power`, `sqrt` y `percentage`, orden de validación completo y cota de costo de `power`: ADR-003 y `.ai/docs/specs/2026-11-15-optional-operations.md`.

Reglas numéricas:
- Todo se calcula con `BigDecimal`. `result` viaja como string para que JavaScript no lo pase a double y pierda precisión.
- La división usa escala 10 con `RoundingMode.HALF_EVEN` y quita los ceros finales.

El contrato es **compartido por los dos backends** (Java y Go) y lo verifica `contract/` (ADR-004). El frontend no conoce diferencias entre ellos: solo cambia el prefijo de la URL.

Otros endpoints: `GET /actuator/health`, `GET /v3/api-docs`, `GET /swagger-ui.html`.

## Frontend — Feature-based + Atomic interno

```
src/
  features/calculator/
    atoms/        botones y display: presentacionales, sin estado
    molecules/    filas del teclado y display con error
    organisms/    CalculatorPanel: compone todo
    useCalculator.ts   máquina de estados con useReducer
    calculatorApi.ts   fetch tipado; traduce ProblemDetail a un error tipado
  shared/         elementos reutilizables entre features
  test/setup.ts
```

- Estilos con CSS Modules, uno por componente, y todos los colores como variables CSS por tema (`:root[data-theme="dark"|"light"]` en `src/app/global.css`).
- **Teclado 4×6, 22 botones**: `C ⌫ % ÷ / xʸ √ ± × / 7 8 9 − / 4 5 6 + / 1 2 3 = / 0 .`. `=` ocupa dos filas y `0` dos columnas.
  - Las 7 operaciones comparten el estilo `operator`.
  - `C`, `⌫` y `±` comparten el estilo `action`.
- Interacción con teclado en pantalla y teclado físico:
  - `Enter` equivale a `=` y `Esc` a `C`.
  - `@` es √; `^` e `y`/`Y` son xʸ; `%` es %.
  - `@`, `^` y `%` también se aceptan con AltGr u Option.
  - El display acepta escribir y pegar texto, con validación de números mal formados en el cliente.
- `√` es unaria e inmediata (`unaryOperator` en el reducer); `xʸ` y `%` son binarias.
- **Tema:** `src/shared/theme/` (`theme.ts`, `useTheme.ts`, `ThemeToggle`).
  - Arranca en oscuro por defecto.
  - La elección se guarda en `localStorage` con la clave `sezzle-calculator-theme`.
  - Un script inline en `index.html` aplica el tema antes de que monte React.

## Red y despliegue

| Entorno | Front | Back | Cómo llega `/api` |
|---------|-------|------|-------------------|
| Desarrollo | Vite `:5180` | Java `make run-backend` `:8090` · Go `make run-go` `:8091` | proxy de Vite por prefijo |
| docker-compose (`docker compose up --build` o `make up`) | nginx `:3000` | `backend-java` `:8090` · `backend-go` `:8091` | proxy de nginx por prefijo |
| E2E | nginx en puerto efímero | los dos backends, internos | proxy de nginx |

**Selección de backend (frontend):** Java por defecto en cada carga (sin persistencia). Al montar se chequea `/api/{b}/health` con timeout de 2 s; si uno está caído se oculta el selector y se usa el sano; mientras haya uno caído se re-chequea cada 10 s. Ante un error de indisponibilidad (red, 5xx o timeout de 10 s) se marca caído el backend usado, se re-chequea el otro y se reintenta una vez. Detalle y casos que se corrigen solos: ADR-004.

Front y back comparten origen en todos los entornos, así que **no se configura CORS**.

## Historial de alcance

- **Iteración 1** (ADR-002): `add`, `subtract`, `multiply` y `divide`.
- **Iteración 2** (ADR-003): `power`, `sqrt` y `percentage`, teclado 4×6 y tema oscuro/claro.
