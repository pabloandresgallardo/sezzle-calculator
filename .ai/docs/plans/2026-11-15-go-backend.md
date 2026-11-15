# Backend Go con paridad + selector + fallback — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development`. Los pasos usan checkboxes (`- [ ]`).

Fecha: 2026-11-15
Jira/HDU: Not provided

**Objetivo:** segundo backend en Go con paridad byte a byte con Java, selector `Java | Go` con fallback por salud, y `docker compose up --build` con los 3 servicios.

**Arquitectura:**
- Go replica el hexágono de Java con la biblioteca estándar: `decimal` propio sobre `math/big`, `domain`, `app` y `httpapi`.
- El contrato vive en `contract/` (casos de paridad y OpenAPI) y lo consumen Java, Go y E2E.
- El frontend centraliza el backend activo en `src/shared/backend/` y el cliente HTTP.
- nginx rutea por prefijo y resuelve los nombres por request.

**Stack:** Go 1.27 (solo biblioteca estándar), Java 21 / Spring Boot 4.1.2 (sin cambios funcionales), React 19 / TS 6 / Vitest 5 / MSW 3, Playwright 1.65, nginx 1.29, Docker Compose.

**Spec:** `.ai/docs/specs/2026-11-15-go-backend.md`. **Referencia de paridad:** `.ai/docs/specs/2026-11-15-go-backend-java-reference.md`.

**Material fuente**, que se copia al repo en C1:
- `/private/tmp/claude-501/-Users-gallardo-Downloads/656343d5-83a3-4e73-9269-ef1423c0f7bf/scratchpad/java-parity-fixtures.json` (80 casos);
- `/private/tmp/claude-501/-Users-gallardo-Downloads/656343d5-83a3-4e73-9269-ef1423c0f7bf/scratchpad/java-openapi-v3-api-docs.json`.

## Restricciones globales

- Rama `feat/go-backend`. **No commitear ni pushear.** Sin operaciones git.
- **Java no cambia de comportamiento:**
  - no se toca `backend/src/main/**`;
  - solo se agregan tests en `backend/src/test/**`;
  - el `Dockerfile` de Java no cambia.
- **Go:**
  - `go.mod` con `go 1.27` y módulo `github.com/pabloandresgallardo/sezzle-calculator/backend-go`;
  - **cero dependencias externas**;
  - `gofmt` y `go vet` limpios;
  - cobertura ≥ 90% en `./internal/...`.
- **Paridad:**
  - los 80 casos se comparan **byte a byte** (status, `Content-Type` y `rawBody`);
  - los casos se identifican **por nombre**;
  - el ProblemDetail sale con claves en orden `detail, instance, status, title`, sin `type`;
  - la salida JSON no escapa `<`, `>` ni `&`;
  - nunca se produce `-0`.
- **Contratos HTTP:**
  - **Rutas del backend:** `POST /api/v1/calculate`, `GET /actuator/health`, `GET /v3/api-docs`, `GET /swagger-ui.html` (302) y `/swagger-ui/index.html`.
  - **Rutas en el proxy:**
    - `/api/java/v1/calculate`, `/api/go/v1/calculate`, `/api/java/health` y `/api/go/health`;
    - `/api/v1/calculate` va a Java (compatibilidad).
- **Docker:**
  - servicios `backend-java` (8090), `backend-go` (8091) y `web` (80);
  - host `${WEB_PORT:-3000}`, `${BACKEND_JAVA_PORT:-8090}` y `${BACKEND_GO_PORT:-8091}`;
  - `web` depende de los backends con `service_started`, nunca `service_healthy`.
- **Frontend:**
  - `DEFAULT_BACKEND = 'java'`, sin persistencia;
  - `HEALTH_TIMEOUT_MS = 2000` y `RECHECK_INTERVAL_MS = 10000`;
  - el selector es `role="radiogroup"` con `aria-label="Backend"` y opciones `Java` y `Go`.
- **Node 22:** se usa con el prefijo `fnm exec --using=22`.
- **Docker Compose:** los comandos se escriben **literales**, nunca guardados en una variable de shell (zsh no hace word splitting).
- **Puertos y stack del usuario:** ningún test usa puertos fijos. No tocar el stack de desarrollo del usuario (proyecto compose por defecto en :3000/:8090); los tests usan proyectos `sezzle-e2e` o similares con puertos efímeros.

## Foco de revisión

1. **Health colgado** (no responde): a los 2 s cuenta como no sano y la calculadora se puede usar mientras tanto. Test en F1: `treats a hanging health check as down after 2s`.
2. **Tocar el selector con una cuenta en curso:** el selector está deshabilitado y la cuenta termina en el backend con el que empezó. Test en F1: `selector is disabled while a calculation is pending`.
3. **Failover ante un 4xx de contrato:** nunca se reintenta. Ante un 5xx se reintenta **una sola vez**. Tests en F1: `does not fail over on contract errors` y `retries at most once`.
4. **nginx sin `backend-go`:** si ese contenedor no existe o está parado, `web` arranca y la app usa Java. Lo verifica I1 en el paso Docker `go stopped → web serves, /api/java works, /api/go/health 502`.
5. **Literales JSON raros:** `-0`, `1E+3`, `0.0`, `00` y `1e-2147483648` dan las mismas respuestas que Java. Los cubren los 80 casos; G3 los ejecuta todos.

## Ejecución y dependencias

```
C1 (contract + Java ITs) ──┐
G1 (decimal) → G2 (domain/app) → G3 (httpapi/server/Docker) ──┐
F1 (frontend backend selection) ────────────────────────────── ├─▶ I1 (nginx/compose/scripts/CI) ─▶ E1 (E2E)
```

- **En paralelo al inicio:** C1, G1 y F1. Tocan directorios distintos: `contract/` y `backend/src/test`, `backend-go/`, y `frontend/src`.
- **G3** necesita `contract/` de C1.
- **I1** necesita el `Dockerfile` de G3.
- **E1** va al final.

---

### Task C1: Contrato compartido + tests de contrato en Java

**Archivos:**
- Crear `contract/parity-cases.json`:
  - array de `{ name, viaProxy, request: { method, path, headers, body }, expected: { status, contentType, rawBody } }`, con los 80 casos de la fuente;
  - se quita `verified`;
  - `viaProxy = false` solo para `404 trailing slash` y `query string ignored`;
  - `health` lleva `viaProxy = true`, y el runner E2E lo traduce a `/api/{b}/health`.
- Crear `contract/openapi.json`: el `/v3/api-docs` de un jar de Java en ejecución, regenerado y no copiado del scratchpad, sin la clave `servers`, con formato estable de 2 espacios y claves ordenadas.
- Crear `contract/README.md`: qué es, quién lo consume y cómo agregar un caso u operación manteniendo la paridad.
- Tests:
  - `backend/src/test/java/com/sezzle/calculator/ContractParityIT.java`
  - `backend/src/test/java/com/sezzle/calculator/OpenApiContractIT.java`

**Interfaces producidas:**
- `contract/parity-cases.json` y `contract/openapi.json`. G3 y E1 dependen de su formato exacto.

- [ ] **Paso 1:** generar los dos archivos de `contract/`. Para `openapi.json`: `cd backend && mvn -B -q package -DskipTests`, levantar el jar en un puerto libre, `curl` a `/v3/api-docs`, normalizar con `python3 -I` (quitar `servers`, `sort_keys`, `indent=2`) y matar el jar.
- [ ] **Paso 2: tests.**
  - `ContractParityIT` (`@SpringBootTest(RANDOM_PORT)`): por cada caso arma el request crudo con `java.net.http.HttpClient`, respetando el método, el path y los headers exactos, sin agregar `Content-Type` si el caso no lo trae. Afirma status, `Content-Type` (igualdad exacta del header) y body exacto. Es un `@ParameterizedTest` con `@MethodSource` que lee `../contract/parity-cases.json` con `JsonMapper`.
  - `OpenApiContractIT`: compara `paths` y `components` del `/v3/api-docs` real, parseado, con los de `contract/openapi.json`.
- [ ] **Paso 3:** `cd backend && mvn -B verify`. Esperado: `BUILD SUCCESS`, failsafe con los ITs nuevos (80 casos más 1) en verde y "All coverage checks have been met". Si algún caso falla contra Java, **se corrige el fixture, no Java**, y se reporta el caso.

### Task G1: Paquete `decimal`

**Archivos:**
- Crear:
  - `backend-go/go.mod`;
  - `backend-go/internal/decimal/decimal.go` y `parse.go`;
  - `backend-go/internal/decimal/decimal_test.go` y `parse_test.go`.

**Interfaces producidas** (`package decimal`):
- `type Decimal struct` (inmutable).
- `func Parse(literal string) (Decimal, error)` sobre un literal numérico JSON, con los errores `ErrSyntax`, `ErrTooManyDigits` y `ErrScaleOverflow`.
  - **Límites de Jackson** (referencia §2.5):
    - literal entero de hasta 1000 dígitos;
    - literal flotante de hasta 1000 dígitos sumando entero, fracción y exponente;
    - escala `fracción − exponente` dentro de [−2147483647, 2147483647], calculada sin overflow;
    - nunca materializa `10^exponente`.
- `func FromInt64(v int64) Decimal`
- Métodos:
  - `Precision() int`, `Scale() int32`, `Signum() int`, `Cmp(o Decimal) int`;
  - `Abs()`, `Neg()`, `StripTrailingZeros()`;
  - `PlainString() string`: semántica de `toPlainString` y nunca `-0`;
  - `Add`, `Sub`, `Mul(o Decimal) Decimal` exactos;
  - `MovePointLeft(n int32) Decimal`;
  - `SetScale(scale int32) Decimal` con HALF_EVEN;
  - `QuoScale(o Decimal, scale int32) Decimal` con HALF_EVEN; precondición `o ≠ 0`;
  - `Sqrt(scale int32) Decimal`: precondición `≥ 0`; raíz entera exacta de `unscaled·10^k` y HALF_EVEN, con el resto como desempate;
  - `PowInt(e int) Decimal` exacto, `e ≥ 0`;
  - `IsInteger() bool` (sobre el valor normalizado: `scale ≤ 0`);
  - `Int() (int, bool)`;
  - `Log10Abs() float64`, que es `log10(unscaled) − scale` y vale solo para un unscaled de 15 dígitos o menos.

- [ ] **Paso 1: tests en rojo** (tablas):
  - `Parse`: `"0.1"`, `"1E+3"`, `"-0"`, `"0.0"`, `"1e999999999"` (precision 1, escala −999999999, rápido), `"1e-2147483647"` válido, `"1e-2147483648"` → `ErrScaleOverflow`, `"0.1e2147483648"` válido, 1000 contra 1001 dígitos enteros (`ErrTooManyDigits`), 1000 contra 1001 dígitos flotantes, y `"00"` y `"1."` → `ErrSyntax` (la gramática JSON ya los rechaza, pero `Parse` se defiende igual).
  - `PlainString`: `1E+30` → `"1000000000000000000000000000000"`; `0.000` y `-0` → `"0"`; `-0.125` → `"-0.125"`.
  - `QuoScale(10, HALF_EVEN)`: `1/3` → `0.3333333333`, `2/3` → `0.6666666667`, `1/2048` → `0.0004882812`, `3/2e10` → `0.0000000002`, `-1/2e10` → `"0"`.
  - `Sqrt(10)`: `2` → `1.4142135624`, `999999999999999` → `31622776.6016837775`, `0.0000000001` → `0.00001`, `16` → `4`, `0` → `0`.
  - `PowInt`: `2^64` → `18446744073709551616`; `0.1234567891^3` con `SetScale(10)` → `0.0018816764`.
  - `MovePointLeft`: `20·150` movido 2 → `30`.
- [ ] **Paso 2:** `cd backend-go && go test ./internal/decimal/...`. Esperado: FAIL (no compila).
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `go test -race -cover ./internal/decimal/...` en verde con ≥ 90%; `gofmt -l .` sin salida; `go vet ./...` limpio.

### Task G2: `domain` + `app`

**Archivos:**
- Crear en `backend-go/internal/domain/`: `operand.go`, `operation.go`, `power.go`, `errors.go`, y sus tests.
- Crear `backend-go/internal/app/calculator.go` y su test.

**Interfaces:**
- Consume: `decimal` de G1.
- Produce:
  - Errores (todos `error`, con el `Error()` exacto de la referencia §3.3):
    - `*OperandOutOfRangeError{Index int; Reason string}`, con `Index = -1` sin índice; `WithIndex(i) *OperandOutOfRangeError`;
    - `*InvalidOperandError{Index int; Reason string}`;
    - `*InvalidOperandCountError{Code string; Expected, Actual int}`, con pluralización;
    - `*UnsupportedOperationError{Code string}`, con truncado a 32 unidades UTF-16 más `…`;
    - `*DivisionByZeroError`;
    - `*ResultOutOfRangeError`.
  - `type Operand struct`, con `func NewOperand(v decimal.Decimal) (Operand, error)`: magnitud → dígitos → decimales, y guarda el valor normalizado.
  - `type Operation struct{ Code string; Arity int; validate func([]Operand) error; apply func([]Operand) (decimal.Decimal, error) }`, con los métodos `Validate` y `Apply` (este revalida).
  - `func Lookup(code string) (Operation, error)`, sobre un map con las 7 operaciones.
  - `package app`:
    - `type Command struct{ Operation string; Operands []decimal.Decimal }`;
    - `type Result struct{ Operation string; Value decimal.Decimal }`, con `Formatted() string`;
    - `func Calculate(cmd Command) (Result, error)`: `Lookup` → aridad → `NewOperand` por índice (`WithIndex`) → `Validate` → `Apply`.

- [ ] **Paso 1: tests en rojo:**
  - las filas de "Ejemplos" de las specs `basic-operations` y `optional-operations`, con valores literales;
  - cada mensaje exacto de la referencia §3.3;
  - el orden de validación: `divide [1e999999999, 0]` → `OperandOutOfRangeError` con índice 0; `sqrt [1e999999999]` → rango; `power [2, 1000.5]` → `InvalidOperand`; `power [0, -1]` → `DivisionByZero`; `PERCENTAGE` → `Unsupported`;
  - la cota de `power` sin calcular: `power [999999999999999, 1000]` y `[0.5, -1000]` dan `ResultOutOfRange` desde `Validate` solo; `[3, -1000]` → `"0"`;
  - el truncado: un código de 33 caracteres y otro con un emoji que cruza el límite.
- [ ] **Paso 2:** `go test ./internal/domain/... ./internal/app/...`. Esperado: FAIL.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `go test -race -cover ./internal/...` en verde con ≥ 90%; `gofmt` y `vet` limpios.

### Task G3: `httpapi`, servidor, Swagger, contrato y Docker

**Archivos:**
- Crear en `backend-go/internal/httpapi/`:
  - `router.go`, `decode.go`, `problem.go`, `health.go`, `openapi.go`;
  - `openapi.json`: copia exacta de `contract/openapi.json`, embebida;
  - `swagger.html`: HTML con `swagger-ui-dist@5.35.0` desde `https://unpkg.com/swagger-ui-dist@5.35.0/` y `url: '/v3/api-docs'`.
- Crear `backend-go/cmd/server/main.go`, `backend-go/Dockerfile` y `backend-go/.dockerignore`.
- Tests:
  - `backend-go/internal/httpapi/*_test.go`;
  - `backend-go/internal/httpapi/contract_test.go`, que lee `../../../contract/parity-cases.json` y `../../../contract/openapi.json`.

**Interfaces:**
- Consume: `app` y `domain` de G2.
- Produce:
  - `func NewHandler() http.Handler`;
  - el binario `server`: `PORT` (default `8091`) y el flag `-healthcheck` (hace GET a `http://127.0.0.1:$PORT/actuator/health` y devuelve exit 0 o 1);
  - la imagen Docker escucha en 8091 y no tiene `HEALTHCHECK` propio (lo define compose con `["CMD", "/server", "-healthcheck"]`).
- Decoder (spec §httpapi):
  - valida UTF-8 y quita el BOM;
  - decodifica a `map[string]json.RawMessage` (claves exactas, última duplicada gana) y rechaza tokens sobrantes;
  - valida tipos;
  - un operando `""` o en blanco cuenta como `null`;
  - ante nulos o faltantes, produce la lista `"<campo> must not be null"`, ordenada lexicográficamente y unida con `"; "`. Esto va **antes** del `Lookup`.
  - Las rarezas de forma producen el `detail` constante `Request body is not valid JSON or does not match the expected shape`.
- Capa HTTP, en este orden: 404 → 405 (con header `Allow`) → 415 → 406 → body. Los textos son los de los casos `415 *`, `406 *`, `405 GET` y `404 trailing slash`; `instance` es el path.
- Mapeo de errores a `title`, igual que Java:
  - `Malformed request`, `Unsupported operation`, `Invalid operand count`, `Operand out of range`, `Invalid operand`, `Result out of range` y `Division by zero`, todos con 400;
  - un panic → 500 `Internal error`, con un `detail` genérico.

- [ ] **Paso 1: tests en rojo:**
  - `contract_test.go` (`TestParityCases`): por cada caso, request crudo contra `httptest.NewServer(NewHandler())` (directo, sin el prefijo del proxy); compara status, `Content-Type` exacto y `rawBody` exacto. Los 80 casos tienen que pasar.
  - `TestOpenAPIEmbeddedMatchesContract`: bytes iguales.
  - `TestOpenAPIServersFromRequest`: `servers[0].url == "http://"+host`.
  - `TestSwaggerRedirect`: 302 a `/swagger-ui/index.html`.
  - Tests unitarios del decoder con cada rareza de la referencia §2.3 y §2.4.
  - Test del flag `-healthcheck`, contra un servidor sano y uno caído.
- [ ] **Paso 2:** `go test ./internal/httpapi/...`. Esperado: FAIL.
- [ ] **Paso 3:** implementar. Si un caso de paridad no se puede igualar, **no se cambia el fixture**: se reporta con evidencia (BLOCKED o DONE_WITH_CONCERNS).
- [ ] **Paso 4:** verificar:
  - `cd backend-go && gofmt -l . && go vet ./... && go test -race -coverprofile=cover.out ./internal/... && go tool cover -func=cover.out | tail -1`: total ≥ 90%.
  - `docker build -t sezzle-go-test backend-go`, luego `docker run --rm -d -p 0:8091 --name sezzle-go-probe sezzle-go-test`; un `curl` a `/actuator/health` y a un `POST` de `add`; `docker exec sezzle-go-probe /server -healthcheck`; y `docker rm -f sezzle-go-probe`.

### Task F1: Selección de backend en el frontend

**Archivos:**
- Crear en `frontend/src/shared/backend/`:
  - `backend.ts`: `Backend`, `DEFAULT_BACKEND`, `BACKENDS`, `HEALTH_TIMEOUT_MS` y `RECHECK_INTERVAL_MS`;
  - `checkHealth.ts`;
  - `useBackends.ts`;
  - `BackendSelector.tsx` y `.module.css`;
  - con sus tests.
- Modificar:
  - `frontend/src/features/calculator/api/calculatorApi.ts`, donde `calculate(operation, operands, { backend, signal })` arma `/api/${backend}/v1/calculate`;
  - `hooks/useCalculator.ts`, que recibe `{ backend, failover }` y reintenta una vez;
  - `organisms/CalculatorPanel.tsx`, con props `{ backend: Backend; failover: () => Promise<Backend | null>; onBusyChange?: (busy: boolean) => void }`;
  - `src/app/App.tsx` y `App.module.css`, con el header `[BackendSelector][ThemeToggle]` a la derecha;
  - `frontend/vite.config.ts`, con el proxy `/api/java` → `VITE_JAVA_TARGET` (default `http://localhost:8090`) y `/api/go` → `VITE_GO_TARGET` (default `http://localhost:8091`); los dos con `rewrite` que quita el prefijo y `/health` → `/actuator/health`; y `/api` → Java (compatibilidad);
  - los tests existentes afectados: MSW con handlers para `/api/java/...` y `/api/go/...`.

**Interfaces:**
- `checkHealth(backend: Backend, signal?: AbortSignal): Promise<boolean>`: `GET /api/{backend}/health`; sano = 200 con `status === "UP"`; timeout de 2 s.
- `useBackends(): { active: Backend; selectable: boolean; select: (b: Backend) => void; failover: () => Promise<Backend | null> }`, con la tabla de estados, el re-chequeo cada 10 s solo mientras haya uno caído y la vuelta automática a Java solo si el cambio fue automático (spec §Frontend).
- `BackendSelector({ value, onChange, disabled })`: radiogroup, flechas ← →, oculto si `!selectable` (lo decide `App`).

- [ ] **Paso 1: tests en rojo:**
  - `checkHealth`: `ok when 200 UP`, `down on 5xx`, `down on network error`, `treats a hanging health check as down after 2s` (timers falsos).
  - `useBackends`:
    - `starts on java with both healthy and is selectable`;
    - `switches silently to go when java is down`;
    - `uses java when go is down`;
    - `stays on java with both down`;
    - `rechecks every 10s while degraded and stops when both healthy`;
    - `returns to java when recovered after an automatic switch`;
    - `keeps go when the user chose it`;
    - `failover returns the healthy alternative or null`;
    - `does not persist the selection`.
  - `BackendSelector`: `renders Java and Go with Java checked`, `arrow keys change selection`, `disabled blocks changes`.
  - `calculatorApi`: `posts to /api/go/v1/calculate when backend is go`.
  - `CalculatorPanel` (MSW):
    - `computes on java by default`;
    - `switching to go sends the next calculation to go without reload`;
    - `fails over to go and retries once on 502 from java`;
    - `does not fail over on contract errors`;
    - `retries at most once`;
    - `selector is disabled while a calculation is pending`.
  - `App`:
    - `hides the selector when one backend is down`;
    - `shows selector and theme toggle top-right`.
- [ ] **Paso 2:** `cd frontend && fnm exec --using=22 npx vitest run src/shared/backend src/features src/app`. Esperado: FAIL.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `cd frontend && fnm exec --using=22 npm run lint && fnm exec --using=22 npm run test:coverage && fnm exec --using=22 npm run build`. Esperado: verde, con cobertura ≥ 90% en las 4 métricas.

### Task I1: nginx, Compose, puertos, Makefile y CI

**Archivos:**
- Modificar:
  - `frontend/nginx.conf`: `resolver 127.0.0.11 valid=10s ipv6=off;`, variables `$java` y `$go`, `location = /api/java/health`, `location = /api/go/health`, `location /api/java/` y `/api/go/` con `rewrite ... break` quitando el prefijo, y `location /api/` hacia Java;
  - `docker-compose.yml` y `docker-compose.test.yml`: servicios, healthchecks, `depends_on: service_started`, puertos;
  - `.env.example`;
  - `Makefile`: `up`, `down`, `test-go`, `lint-go`, `run-go`; `test`, `lint`, `coverage` y `build` incluyen Go; `install` no cambia;
  - `.github/workflows/ci.yml`: job `backend-go` con `actions/setup-go@v7` (`go-version-file: backend-go/go.mod`): `gofmt -l` vacío, `go vet`, `go test -race -coverprofile` con un gate de 90% (script `backend-go/scripts/coverage-gate.sh`) y build; `e2e` necesita también `backend-go`.
- Crear:
  - `scripts/up.sh`: POSIX `sh`. Detecta un puerto ocupado con `lsof`, `ss` o `nc` según haya. Si el puerto lo ocupa este mismo proyecto de compose, lo reutiliza. Tiene `--dry-run`, que solo imprime `WEB_PORT=… BACKEND_JAVA_PORT=… BACKEND_GO_PORT=…`. Sin `--dry-run` ejecuta `docker compose up --build -d --wait` e imprime las URLs.
  - `scripts/down.sh`.
  - `scripts/up.test.sh`: ocupa un puerto con `python3 -m http.server`, corre `scripts/up.sh --dry-run` con ese puerto como `WEB_PORT` y verifica que elige otro.

**Interfaces:**
- Consume: el `Dockerfile` de Go (G3).
- Produce: el stack de 3 servicios que usa E1.

- [ ] **Paso 1:** `sh scripts/up.test.sh`. Esperado: FAIL antes de crear `up.sh`.
- [ ] **Paso 2:** implementar todo lo anterior.
- [ ] **Paso 3: verificación Docker** (con un proyecto aparte, `-p sezzle-i1`, puertos por variables libres; **no** el del usuario):
  - `docker compose -p sezzle-i1 down -v`; después `WEB_PORT=<libre> BACKEND_JAVA_PORT=<libre> BACKEND_GO_PORT=<libre> docker compose -p sezzle-i1 up --build -d --wait` → los 3 sanos.
  - Por la web: `POST /api/java/v1/calculate` y `/api/go/v1/calculate` (`add [0.1,0.2]` → `"0.3"` en los dos); `/api/java/health` y `/api/go/health` → 200; `/api/v1/calculate` → Java.
  - Swagger: `:<java>/swagger-ui.html` y `:<go>/swagger-ui.html` → 302 y después 200.
  - `docker compose -p sezzle-i1 stop backend-go`: la web sigue respondiendo, `/api/java/...` funciona y `/api/go/health` da 502. Después `docker compose -p sezzle-i1 restart web` con Go parado → nginx arranca.
  - `docker compose -p sezzle-i1 down -v`.
  - `sh scripts/up.test.sh` en verde.

### Task E1: E2E — paridad, selector y fallback

**Archivos:**
- Crear:
  - `e2e/tests/parity.spec.ts`: solo chromium; usa el módulo `http` de Node; para cada caso con `viaProxy` manda a `/api/java…` y a `/api/go…` (el `health` va a `/api/{b}/health`); exige `java == go` y los dos iguales a `expected` (status, `Content-Type` y `rawBody`).
  - `e2e/tests/ui-backend.spec.ts`.
- Modificar `e2e/tests/helpers.ts` si hace falta. Las suites existentes no deben romperse.

- [ ] **Paso 1: specs de `ui-backend`:**
  - `Java is selected by default` (`aria-checked`);
  - `calculations go to /api/java by default` (`page.waitForRequest`);
  - `switching to Go routes to /api/go without reload, and back to Java`;
  - `both backends compute 2 xʸ 10 = 1024 and show Cannot divide by zero for 6 ÷ 0`;
  - `go health down → no selector and Java is used` (`page.route('**/api/go/health', 503)`);
  - `java health down → no selector and Go is used silently`;
  - `java calculation aborts → retried on Go without visible error` (`page.route` con `route.abort()` en `/api/java/v1/calculate`);
  - `selector reappears after recovery` (`page.clock` adelanta 10 s y la ruta de health vuelve a 200).
- [ ] **Paso 2:** desde la raíz, con los comandos literales: `docker compose -p sezzle-e2e -f docker-compose.test.yml up -d --build --wait`; el puerto se obtiene con `docker compose -p sezzle-e2e -f docker-compose.test.yml port web 80`; después `cd e2e && E2E_BASE_URL=http://localhost:<port> fnm exec --using=22 npx playwright test --project=chromium --project=firefox --project=mobile`; y `down -v`. Esperado: todo en verde, con `parity` 78 casos × 2 backends.
- [ ] **Paso 3:** WebKit en el contenedor Linux `mcr.microsoft.com/playwright:v1.65.1-noble`, contra el mismo stack, con `--output` fuera del repo. Esperado: en verde.
