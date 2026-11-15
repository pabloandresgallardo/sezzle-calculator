# ADR-004: Segundo backend en Go — paridad por contrato ejecutable, ruteo por prefijo y fallback por salud

Fecha: 2026-11-15
Jira/HDU: Not provided
Estado: Aceptado

## Contexto

El challenge prefería Go para el backend. Desde el inicio (ADR-001) se planeó un segundo backend que respetara el mismo contrato. Ahora hay que sumarlo **sin reemplazar Java**:
- el usuario elige el backend desde la UI, con Java por defecto;
- si un backend no está sano, se usa el otro de forma transparente;
- `docker compose up --build` levanta todo.

## Decisión

- **Paridad como contrato ejecutable.**
  - `contract/parity-cases.json` tiene 80 casos verificados contra Java: status, `Content-Type` y body exacto.
  - Lo ejecutan Java (`ContractParityIT`), Go (`TestParityCases`) y Playwright a través de nginx, que además exige Java == Go.
  - `contract/openapi.json` es el OpenAPI compartido: Go lo sirve embebido y Java verifica que su springdoc coincide.
- **Go solo con biblioteca estándar.** Se escribe un paquete `decimal` propio sobre `math/big`, que reproduce la semántica de BigDecimal que usa el contrato. La arquitectura es el mismo hexágono que Java: `domain`, `app`, `httpapi`.
- **Ruteo por prefijo en el proxy.**
  - `/api/java/...` y `/api/go/...`; `/api/v1/...` sigue yendo a Java por compatibilidad.
  - nginx resuelve los nombres por request (`resolver` de Docker) y `web` no espera a que los backends estén sanos, para que un backend caído no tumbe la app.
- **Selección en el frontend.**
  - El backend activo está centralizado en `src/shared/backend/`.
  - El selector es un switch segmentado que siempre arranca en Java.
  - Al abrir la app se chequea la salud de los dos, y se re-chequea cada 10 s mientras haya uno caído.
  - Failover silencioso: ante un error de indisponibilidad se hace un reintento en el backend sano.
- **Puertos.** `make up` busca puertos libres si los de por defecto están ocupados; `docker compose up --build` sigue siendo el camino estándar.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|-------------|---------------------|
| Ruteo por header `X-Backend` | El ruteo no se ve en la URL, requiere `map` en nginx y un router en Vite, y es más difícil de probar con curl |
| El navegador llama directo a cada backend por su puerto | Exige CORS y URLs públicas por entorno, y rompe el modelo de mismo origen de ADR-001 |
| `shopspring/decimal` | La división redondea half-up y no tiene raíz exacta, así que habría riesgo de doble redondeo y de romper la paridad |
| `cockroachdb/apd` | Agrega una dependencia y su modelo no es BigDecimal: igual habría que verificar cada borde |
| `swaggo/swag` para el Swagger de Go | Dependencias, código generado y una segunda fuente del contrato que puede divergir |
| Paridad verificada "a mano" o con pocos casos | No detecta las trampas reales: orden de claves, `detail` no constante, claves sensibles a mayúsculas, límites de Jackson |
| Corregir ahora las inconsistencias del API Java | La tarea prohíbe cambiar funcionalidad existente sin justificación; quedan documentadas abajo |
| Persistir la elección de backend | Contradice "Java por defecto" en cada carga |
| Chequear la salud solo al abrir la app | Si Java tarda en arrancar, la app queda en Go hasta recargar |
| Base de datos (pedido de la "DB Skill") | El servicio es stateless por diseño (ADR-001/002). Además, esa skill no existe en este entorno, y la limitación queda declarada |

## Desviaciones conocidas entre Java y Go (Nivel B, no replicadas)

Son comportamientos de transporte de Java (Tomcat/Spring/Jackson) que no forman parte del contrato. La revisión final los midió enviando 2.810 requests nuevos a los dos backends: las únicas diferencias fueron estas.

**Requests**
- Body en UTF-16 o con `charset` fuera de la lista conocida (`windows-1251`, `Shift_JIS`, etc.): Java los acepta; Go responde 415 `Could not parse Content-Type.`
- `Accept` con parámetros: Java los repite en el `Content-Type` de la respuesta; Go no. `Accept: application/json;charset=ISO-8859-1` → 500 en Java.
- UTF-8 *overlong* (`\xC0\xAF`): Java lo decodifica como `/`; Go lo rechaza como `Malformed request` (más seguro).
- Surrogate suelto (por truncado o enviado como `"\ud83d"`): Java devuelve `\uD83D`; Go devuelve U+FFFD.

**Paths y métodos**
- Request-targets que Tomcat rechaza con su 400 en HTML (`%00`, `#` crudo, `..;/`, `%2e%2e`): Go responde 404 ProblemDetail.
- `%2F` en el path: Go lo decodifica para rutear.
- `TRACE` y `CONNECT`: Java responde con el JSON de error por defecto de Spring o el 501 de Tomcat.
- `Connection: close` y la línea de status sin frase (Tomcat).

**Health y rutas de Spring**
- `/actuator/health`: Java negocia por `q` y orden de `Accept`, y da 406 con `text/plain`; Go siempre responde con el tipo actuator. `/actuator/health/` (barra final): Java 200, Go 404. `/actuator/health/x`: Java 404 vacío, Go 404 ProblemDetail.
- Rutas de Spring que Go no expone: `/actuator` (discovery), `/v3/api-docs.yaml`, `/v3/api-docs/swagger-config`, `/error`, preflight CORS.

**Sí replicados (verificados iguales):** `Accept: garbage` → 406 sin body, `HEAD`/`OPTIONS` sobre el health, el path crudo en `instance` y en el `detail` del 404, y el estilo de escape de Jackson (U+2028/U+2029 crudos, controles como `\u001F`).

El detalle está en la referencia, `.ai/docs/specs/2026-11-15-go-backend-java-reference.md` §8.

## Comportamientos del frontend que se corrigen solos

- Una cuenta que falla marca su backend como caído aunque su health diga UP. Si el problema es solo de ruteo (por ejemplo un 502 en `/api/java/v1` con el health sano), el re-chequeo lo vuelve a habilitar y el próximo fallo vuelve a hacer failover: puede alternar, pero el usuario nunca ve un error.
- Un re-chequeo que empezó antes de un failover puede volver a Java apenas termina; el próximo request hace failover de nuevo.
- Tiempos: nginx corta la conexión a un backend caído en 2 s (`proxy_connect_timeout`) y el cliente aborta un request a los 10 s, así que el failover no queda colgado esperando el timeout de 60 s por defecto de nginx.

## Inconsistencias del API Java (no corregidas; propuesta)

1. **`detail` de `Malformed request` que no es constante** (string vacío → `null`, lista de nulos con orden lexicográfico). *Propuesta:* un `detail` constante, u ordenar por índice, con un ADR que cambie el contrato en los dos backends a la vez.
2. **El 500 `Internal error` del contrato no se alcanza, pero hay otro 500 alcanzable** (`Accept` con charset). *Propuesta:* aceptar o ignorar el charset en `Accept`.
3. **`Accept: application/problem+json` → 406.** *Propuesta:* incluir `application/problem+json` en `produces`.
4. **Dos textos distintos para un exponente fuera de rango**, según su magnitud. *Propuesta:* unificarlos en el chequeo de `power`.
5. **El OpenAPI no declara los 405, 406 y 415**, y su schema de ProblemDetail lista `type` y `properties`, que nunca se emiten. *Propuesta:* ajustar las anotaciones de springdoc.

Cualquier corrección cambia el contrato observable y tiene que hacerse en los dos backends a la vez, con su propio ADR y con `contract/parity-cases.json` actualizado.

## Compatibilidad hacia atrás

Para que el cambio no rompa configuraciones existentes:
- `backend-java` mantiene el alias de red `backend` dentro de la red de compose.
- `BACKEND_PORT` sigue funcionando como alias deprecado de `BACKEND_JAVA_PORT`, en compose y en `make up` (con aviso).
- `VITE_API_PROXY_TARGET` sigue funcionando como alias deprecado de `VITE_JAVA_TARGET` (`frontend/src/devProxy.ts`, con tests).
- `/api/v1/calculate` sigue yendo a Java. Las rutas `/api/java`, `/api/go` y `/api/{b}/health` son nuevas y no reemplazan nada.

## Consecuencias

- **Positivas:**
  - La paridad queda probada en CI y no depende de que alguien la recuerde.
  - Agregar una operación tiene un procedimiento claro (`contract/README.md`).
  - La app sigue funcionando con un backend caído.
  - Go no agrega dependencias.
- **Negativas / trade-offs:**
  - Hay dos implementaciones que mantener en sincronía, y cada cambio de contrato toca Java, Go y `contract/`.
  - El paquete `decimal` es código propio que hay que mantener.
  - El frontend suma lógica de salud y failover.
  - Swagger UI de Go carga sus assets desde una CDN.
- **Neutrales:**
  - Java no cambia; solo suma tests de contrato.

## Artefactos relacionados

- Spec: `.ai/docs/specs/2026-11-15-go-backend.md`
- Referencia de paridad: `.ai/docs/specs/2026-11-15-go-backend-java-reference.md`
- Plan: `.ai/docs/plans/2026-11-15-go-backend.md`
- Base: ADR-001, ADR-002, ADR-003
