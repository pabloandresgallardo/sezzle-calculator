# SPEC — Segundo backend en Go con paridad total, selector de backend y fallback por salud

Fecha: 2026-11-15
Jira/HDU: Not provided
Clasificación: GRANDE
Rama: `feat/go-backend`
Base:
- ADR-001 (stack, mismo origen)
- ADR-002 (contrato, límites, orden de validación)
- ADR-003 (operaciones opcionales, teclado, tema)
- Referencia de comportamiento Java: `.ai/docs/specs/2026-11-15-go-backend-java-reference.md`. 80 casos verificados contra el backend real. **Es la fuente de verdad de la paridad.**

## Intención

Agregar una **segunda implementación del backend en Go** que responda igual que la de Java a cualquier request del contrato, **sin eliminar ni reemplazar Java**:
- El frontend permite elegir el backend; Java es el predeterminado.
- Si uno de los dos backends no está sano, se usa el otro de forma transparente.
- `docker compose up --build` levanta frontend, Java y Go.

## Objetivos

1. **Backend Go** con las 7 operaciones, las mismas validaciones, los mismos errores y la misma aritmética decimal que Java. **Los 80 casos de la referencia tienen que coincidir byte a byte**: status, `Content-Type` y body.
2. **Selector `Java | Go`** (switch segmentado) arriba a la derecha, junto al toggle de tema:
   - Java por defecto, siempre; no se persiste.
   - El ruteo está centralizado en el cliente HTTP.
   - No hace falta recargar.
3. **Selección automática por salud:**
   - Al abrir el frontend se consulta el health de los dos backends. Si uno está caído, el selector se oculta y se usa el sano sin avisar.
   - **Failover silencioso:** si una cuenta falla por indisponibilidad, se vuelve a chequear la salud, se cambia al backend sano si lo hay y se reintenta una vez.
4. **Docker:**
   - `docker compose up --build` levanta `web`, `backend-java` y `backend-go`. La web arranca aunque un backend no esté sano.
   - `make up` busca puertos libres si los de por defecto están ocupados.
5. **Swagger en Go:**
   - Go sirve el mismo documento OpenAPI que Java, desde `contract/openapi.json`, en `/v3/api-docs`, más Swagger UI en `/swagger-ui.html`.
   - Hay tests que impiden que Java y el contrato se desincronicen.
6. **Suite de paridad:** `contract/parity-cases.json` se ejecuta contra Java (test de integración), contra Go (tests de Go) y contra los dos a través de nginx (Playwright, comparando Java contra Go).
7. Cobertura ≥ 90% en las tres bases de código (Java, Go y frontend). E2E en verde.
8. Documentación y ADR-004.

## No objetivos

- Modificar el comportamiento de Java. Solo se le agregan tests: paridad y sincronía de OpenAPI.
- Persistencia o base de datos. El servicio es stateless (ADR-001/002). **Limitación declarada:** la "DB Skill" que pide la tarea no existe en este entorno. Su intención (no agregar persistencia si no hace falta) se cumple.
- Corregir las inconsistencias del API Java (sección 8 de la referencia). Se documentan en ADR-004 con una propuesta, y quedan para otra decisión.
- Recordar el backend elegido entre recargas.

## Anti-objetivos

- Que algún caso del contrato dé respuestas distintas entre Java y Go.
- Que Go imprima `-0`, escape `<` `>` `&`, acepte `"1"` como número o reconozca claves sin distinguir mayúsculas. Todos son comportamientos por defecto de `encoding/json` que Java no tiene.
- Que un backend caído impida usar la app: ni que nginx deje de arrancar, ni que `web` quede esperando.
- Que el navegador tenga que resolver nombres internos de Docker o necesite CORS.
- Que el usuario vea "Service unavailable" cuando el otro backend estaba sano.

## Enfoques considerados (decididos con el usuario)

| Decisión | Elegido | Descartados |
|----------|---------|-------------|
| Ruteo | **Prefijo en la URL**: `/api/java/...` y `/api/go/...`, y `/api/v1/...` sigue yendo a Java por compatibilidad | Header `X-Backend` (el ruteo no se ve, requiere `map` en nginx y router en Vite); puertos separados (CORS y URLs por entorno) |
| Decimales en Go | **Paquete propio sobre `math/big`**, sin dependencias | `cockroachdb/apd` (dependencia, y su modelo no es BigDecimal); `shopspring/decimal` (la división redondea half-up y no tiene raíz exacta) |
| Selector | **Switch segmentado** que siempre arranca en Java | Dropdown; persistir la elección |
| Swagger en Go | **`contract/openapi.json` compartido** y servido por Go, con tests de sincronía | `swaggo/swag` (dependencias, código generado, segunda fuente del contrato); que Go no tenga Swagger |
| Caída en uso | **Failover silencioso** con un reintento | Chequear solo al abrir la app |
| Puertos ocupados | **`make up` con `scripts/up.sh`**, que busca puertos libres | Puertos efímeros de Docker |

## Paridad: alcance exacto

### Nivel A — contrato (obligatorio, verificado)

Los **80 casos** de `java-parity-fixtures.json` (sección 7 de la referencia) pasan a `contract/parity-cases.json`. Go tiene que igualar **status, `Content-Type` exacto y body crudo** (`rawBody`, byte a byte) en todos, incluidos:
- el orden alfabético de las claves del ProblemDetail (`detail, instance, status, title`, sin `type`);
- `Content-Type: application/problem+json` en los errores y `application/json` en los éxitos;
- los `detail` exactos:
  - `Malformed request` con el texto constante, o con la lista `"<campo> must not be null"` ordenada lexicográficamente y unida con `"; "`;
  - los motivos de rango con índice;
  - `unsupported operation: <code>`, truncado a 32 unidades UTF-16 más `…`;
  - el pluralizado de `Invalid operand count`;
- el parseo estricto equivalente a Jackson (sección 2 de la referencia):
  - claves sensibles a mayúsculas;
  - campos desconocidos → `Malformed request`;
  - sin conversión de string, número ni booleano;
  - un operando `""` o en blanco se trata como `null`;
  - clave duplicada: gana la última;
  - tokens después del objeto → `Malformed request`;
  - BOM UTF-8 aceptado y UTF-8 inválido rechazado;
  - límite de 1000 **dígitos** por número y escala dentro de [−2147483647, 2147483647];
- el orden de la capa HTTP: 404 → 405 → 415 → 406 → body → validación → dominio, con los títulos y `detail` de los casos `415 *`, `406 *`, `405 GET` y `404 trailing slash`;
- `instance` = el path de la request;
- el health: `GET /actuator/health` → 200 `application/vnd.spring-boot.actuator.v3+json`, `{"groups":["liveness","readiness"],"status":"UP"}`, igual que el caso `health`;
- la salida JSON **sin escapar** `<`, `>` y `&` (caso `unsupported html chars not escaped`).

*(Decisión del controller.)* Los casos se identifican **por nombre** (`name`), nunca por número.

### Nivel B — rarezas de transporte de Java (documentadas, no replicadas)

Van en ADR-004, en "Desviaciones conocidas". No las ejercita el frontend ni ningún cliente razonable:
- request en UTF-16 o `charset=ISO-8859-1`;
- `Accept` con parámetros que se repiten en el `Content-Type` de la respuesta;
- `Accept: application/json;charset=ISO-8859-1` → 500 en Java;
- `Accept: garbage` → 406 con body vacío;
- `Connection: close` y la línea de status sin frase;
- parámetros de matriz (`;a=b`) y path codificado en `instance`;
- preflight CORS y endpoint `/error`;
- truncado que parte un par surrogate (`\uD83D` suelto) y el estilo de escape de Jackson para U+2028/U+2029 y controles (`\u001F`): Go escapa como `encoding/json` con `SetEscapeHTML(false)`;
- `HEAD` y `OPTIONS` sobre `/actuator/health`.

> *Actualizado tras la revisión final:* la lista definitiva de desviaciones del Nivel B (qué se replicó y qué no) está en ADR-004, medida con 2.810 requests contra los dos backends. La lista anterior queda como intención original.

### Inconsistencias del API Java

Las 18 de la sección 8 de la referencia **no se corrigen** en este cambio, porque la tarea prohíbe modificar funcionalidades existentes sin justificación. ADR-004 las lista con una corrección propuesta. Go reproduce las del Nivel A tal cual (por ejemplo, el `detail` de `Malformed request` que no es constante), porque son contrato observable.

## Backend Go — diseño

**Ubicación:** `backend-go/`, módulo `github.com/pabloandresgallardo/sezzle-calculator/backend-go`, Go **1.27** (`go.mod`: `go 1.27`; el host tiene 1.24.2 y descarga el toolchain solo). Solo biblioteca estándar. El mismo hexágono que Java, en Go idiomático:

```
backend-go/
  cmd/server/main.go         arranque: PORT (default 8091), apagado ordenado, flag -healthcheck
  internal/decimal/          Decimal sobre big.Int + escala (semántica de BigDecimal)
  internal/domain/           Operand, operaciones (tabla con apply/arity/validate), errores tipados, cota de power
  internal/app/              Calculator.Calculate(cmd) con el orden de validación de ADR-003
  internal/httpapi/          router, decoder estricto, ProblemDetail, health, OpenAPI + Swagger UI
  internal/httpapi/openapi.json   copia embebida (go:embed) de contract/openapi.json, sincronizada por test
  Dockerfile                 multi-stage: golang:1.27-alpine → imagen mínima no-root
```

### `internal/decimal` (sin dependencias)

- `type Decimal struct{ unscaled *big.Int; scale int32 }`, inmutable.
- Parseo de un literal JSON numérico:
  - respeta los límites de Jackson (1000 dígitos, escala en int32);
  - **nunca** materializa exponentes enormes: `1e999999999` se representa como unscaled 1 con escala −999999999.
- Operaciones:
  - `Precision()`, `Scale()`, `Signum()`, `StripTrailingZeros()`;
  - `PlainString()`, que nunca produce `-0`;
  - `Add`, `Sub`, `Mul` y `MovePointLeft` exactos;
  - `QuoScale(o, scale)` y `SetScale(scale)` con HALF_EVEN;
  - `Sqrt(scale)` con raíz entera exacta y HALF_EVEN, sin doble redondeo;
  - `PowInt(e)` exacto.
- Tests de tabla: cada fila de "Ejemplos" de las specs anteriores y las secciones 4 y 5 de la referencia.

### `internal/domain` y `internal/app`

- Replican `Operand` (orden de chequeos: magnitud → dígitos → decimales; guarda el valor normalizado), `Operation` (las 7, con `apply`/`arity`/`validate`), `PowerBounds` (estimación L > 101 / L < −11 y chequeo exacto de 100 dígitos) y los mensajes exactos de la referencia, sección 3.
- Un `map[string]Operation` reemplaza `fromCode`.
- **Pipeline:**
  1. forma;
  2. nulos ordenados;
  3. operación;
  4. aridad;
  5. operandos por índice;
  6. `validate`;
  7. `apply`.

### `internal/httpapi`

- **Decoder propio sobre `encoding/json`:**
  - decodifica a `map[string]json.RawMessage` (claves exactas y última duplicada gana);
  - valida UTF-8 y quita el BOM;
  - rechaza tokens sobrantes;
  - valida tipos a mano: `operation` tiene que ser string; `operands` un array de números, `null` o `""`/blanco.
- **Errores:**
  - errores de forma → `detail` constante;
  - nulos y faltantes → la lista ordenada.
- **Writer de ProblemDetail:**
  - struct con los campos en orden alfabético;
  - `SetEscapeHTML(false)`;
  - `Content-Type` exacto.
- **Rutas:**
  - `POST /api/v1/calculate`;
  - `GET /actuator/health`;
  - `GET /v3/api-docs`: el JSON embebido, con `servers[0].url` armado desde el request, igual que springdoc;
  - `GET /swagger-ui.html` → 302 a `/swagger-ui/index.html`, que es HTML con `swagger-ui-dist@5.35.0` desde CDN apuntando a `/v3/api-docs`.
  - Cualquier otra ruta → 404 ProblemDetail, como el fixture 77.
- **Métodos, `Content-Type` y `Accept`:** se tratan como en los casos `415 *`, `406 *` y `405 GET`.
- **Sin límite de tamaño de request propio**, igual que Java. nginx ya corta en 1 MB delante de los dos.

## Contrato compartido — `contract/`

- **`parity-cases.json`:** los 80 casos (nombre, request con método, path, headers y body crudo; expected con status, `contentType` y `rawBody`; más `viaProxy`). Se crean copiando la referencia verificada, y el `openapi.json` se regenera desde un jar de Java en ejecución.
- **`openapi.json`:** el `/v3/api-docs` de Java, normalizado sin `servers`.
- **`README.md`:** cómo se usa el contrato y cómo agregar un caso u operación manteniendo la paridad.

**Consumidores:**
- **Java:** `ContractParityIT` (RANDOM_PORT) ejecuta todos los casos, y `OpenApiContractIT` compara `paths` y `components` de su `/v3/api-docs` con `contract/openapi.json`.
- **Go:** un test que ejecuta todos los casos contra `httptest.NewServer` y otro que verifica que el `openapi.json` embebido es idéntico a `contract/openapi.json`.
- **E2E:** `e2e/tests/parity.spec.ts` manda cada caso a `/api/java` y a `/api/go` a través de nginx y exige que las respuestas sean iguales entre sí y a lo esperado.
  - `instance` va a decir `/api/v1/calculate` en los dos, porque nginx quita el prefijo.
  - *(Decisión del controller.)* Cada caso de `parity-cases.json` lleva `"viaProxy": true|false`.
    - Corren por nginx (`/api/{b}/v1/calculate`) todos los casos de body, validación, aritmética, `415`, `406` y `405 GET`.
    - El health se compara por `/api/{b}/health`.
    - Quedan `viaProxy: false`, y solo corren en las ejecuciones directas de Java y Go, `404 trailing slash`, `query string ignored` y `health` en su path original: dependen de cómo nginx reescribe el path.
    - El runner E2E usa el módulo `http` de Node, no la API de requests de Playwright, para controlar los headers exactos (por ejemplo, sin `Content-Type`).

## Frontend — diseño

- **`src/shared/backend/`:**
  - `type Backend = 'java' | 'go'`, con `DEFAULT_BACKEND = 'java'`;
  - `checkHealth(backend, signal)`: `GET /api/{backend}/health`, timeout de 2 s; sano = 200 con `status: "UP"`;
  - `useBackends()`:
    - expone `{ active, selectable, select(b), failover(): Promise<Backend | null> }`;
    - al montar consulta los dos;
    - `selectable` es true solo si los dos están sanos;
    - si `active` no está sano y el otro sí, cambia sin avisar;
    - **re-chequeo (decisión del usuario):** mientras algún backend esté caído, se vuelve a chequear cada 10 s. Con los dos sanos no hay polling.
      - Cuando los dos vuelven a estar sanos, el selector reaparece.
      - Si el backend activo se eligió **automáticamente** (por fallback o failover) y no por el usuario, vuelve a Java en silencio.
      - Si el usuario eligió Go a mano, se respeta.
      - El intervalo se limpia al desmontar.
    - con los dos caídos al abrir: `active = java` y sin selector; las cuentas muestran "Service unavailable" (failover no encuentra alternativa) y el re-chequeo sigue corriendo;
  - `BackendSelector`:
    - switch segmentado con `role="radiogroup"` y `aria-label="Backend"`;
    - opciones `Java` y `Go` (`role="radio"`, navegación con flechas);
    - visible solo si `selectable`;
    - deshabilitado mientras hay un request en curso.
- **Ruteo centralizado:**
  - `calculatorApi.calculate(operation, operands, { backend, signal })` arma `/api/${backend}/v1/calculate`. Es el único lugar que conoce la URL.
  - El reducer y la UI no cambian.
- **Failover:**
  - *Actualizado tras la revisión final:* cuando `calculate` falla con un error **reintentable** (`CalculatorApiError.retryable`: error de red, timeout de 10 s o HTTP 5xx), el hook llama a `failover(backendUsado)`. nginx corta la conexión a un backend caído en 2 s (`proxy_connect_timeout`).
  - Si devuelve otro backend sano, reintenta la misma request **una vez** en ese backend.
  - Si no, despacha `rejected("Service unavailable")` como hoy.
  - Ningún 4xx dispara failover, tenga o no `title`.
- **Layout:** el header de `App` muestra `[Backend: Java | Go] [☀]` alineados a la derecha. Sin scroll horizontal a 360 px. Respeta los tokens de los dos temas.

## Red, Docker y puertos

- **nginx** (`frontend/nginx.conf`):
  - `resolver 127.0.0.11 valid=10s` y `proxy_pass` con variables, para que nginx arranque aunque un backend no exista o esté caído;
  - `location = /api/java/health` → `backend-java:8090/actuator/health`;
  - `location = /api/go/health` → `backend-go:8091/actuator/health`;
  - `/api/java/` → `backend-java:8090/api/` y `/api/go/` → `backend-go:8091/api/`, quitando el prefijo;
  - `/api/` → `backend-java` (compatibilidad).
- **Vite dev:** los mismos prefijos hacia `VITE_JAVA_TARGET` (`http://localhost:8090`) y `VITE_GO_TARGET` (`http://localhost:8091`).
- **`docker-compose.yml`:**
  - servicios `backend-java` (antes `backend`), `backend-go` y `web`;
  - healthchecks: Java con curl como hoy; Go con `server -healthcheck`, sin curl;
  - `web` usa `depends_on` con `condition: service_started`, **no** `service_healthy`, para no bloquear el fallback;
  - puertos del host `${WEB_PORT:-3000}`, `${BACKEND_JAVA_PORT:-8090}` y `${BACKEND_GO_PORT:-8091}`.
- **`docker-compose.test.yml`:** los tres servicios, `web` en un puerto efímero y los backends sin publicar.
- **`scripts/up.sh` + `make up` / `make down`:**
  - para cada puerto (web, java, go) usa el de `.env` o el default;
  - si está ocupado **por otro proceso**, busca el siguiente libre;
  - si lo ocupa un contenedor de este mismo proyecto de compose, lo reutiliza;
  - ejecuta `docker compose up --build -d --wait` con esos puertos e imprime las URLs reales (web y los dos Swagger);
  - es POSIX, funciona en macOS y Linux, y tiene un test de shell con un puerto ocupado.
- **`.env.example`:** `BACKEND_PORT` pasa a ser `BACKEND_JAVA_PORT`; se agregan `BACKEND_GO_PORT`, `VITE_JAVA_TARGET` y `VITE_GO_TARGET`.

## CI y tareas

- **Job `backend-go`:** `gofmt -l` vacío, `go vet ./...`, `go test -race -coverprofile` con un gate de 90% sobre `internal/...`, y build.
- **Job `e2e`:** levanta los tres servicios.
- **Makefile:** `test-go`, `lint-go`, `run-go`, y `test`, `lint`, `coverage` y `build` incluyen Go.

## Testing (resumen; el plan los detalla)

| Nivel | Qué cubre |
|-------|-----------|
| Go unitario | `decimal` (tabla exhaustiva), `domain` (cada regla y mensaje), `app` (orden), `httpapi` (decoder, ProblemDetail, rutas, health, OpenAPI) |
| Go contrato | Los 80 casos con `httptest.NewServer`, comparación byte a byte |
| Java contrato | `ContractParityIT` (80 casos) y `OpenApiContractIT` |
| Frontend | `checkHealth`, `useBackends` (los 4 estados de salud, failover, sin persistencia, re-chequeo cada 10 s con timers falsos, vuelta automática a Java solo si el cambio fue automático), `BackendSelector` (a11y, visible u oculto, deshabilitado en pending), `calculatorApi` (URL por backend), `CalculatorPanel` (cambio de backend sin recargar; failover con MSW; un 4xx no dispara failover) |
| E2E | `parity.spec.ts` (Java == Go == esperado, chromium); UI: Java por defecto, cambio a Go (se verifica que el request va a `/api/go`), vuelta a Java, resultados con los dos, errores iguales; fallback con `page.route`: health de Go caído → sin selector y usa Java; health de Java caído → usa Go; Java aborta la cuenta → reintento en Go sin error visible |
| Docker | Inicio limpio (`down -v` + `up --build --wait`): los 3 servicios sanos, los dos backends accesibles por nginx, Swagger de los dos; parar `backend-go` → la web sigue y usa Java; `make up` con 3000 ocupado → usa otro puerto |

## Queda a criterio del builder

- La estructura interna de `decimal` y del decoder, siempre que cumplan el Nivel A.
- Cómo pasa el backend activo y el failover de `App` al hook (props o context).
- Los estilos del selector dentro de los tokens existentes.
- La imagen final de Go: `distroless` o `alpine` no-root.
