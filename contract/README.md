# Contrato compartido

Esta carpeta define el comportamiento HTTP que los dos backends (Java y Go) deben cumplir de forma idéntica. La referencia es el backend Java; los archivos se generan a partir de él.

## Archivos

- `parity-cases.json`: array de casos `{ name, viaProxy, request: { method, path, headers, body }, expected: { status, contentType, rawBody } }`.
  - `body` falta en los requests sin cuerpo (por ejemplo `GET`). Un caso sin header `Content-Type` se envía sin ninguno.
  - `contentType` y `rawBody` se comparan de forma exacta (el body byte a byte, en UTF-8).
  - `expected.allow` es opcional: si está, se compara con el header `Allow` (solo el caso `405 GET`).
  - `viaProxy = false` marca los casos que dependen de cómo nginx reescribe el path (`404 trailing slash`, `query string ignored`); solo corren contra cada backend directo. `health` va con `viaProxy = true` y el runner E2E lo traduce a `/api/{backend}/health`.
- `openapi.json`: el `/v3/api-docs` del backend Java, sin la clave `servers`, con 2 espacios de indentación y claves ordenadas.

## Quién lo consume

- Java: `ContractParityIT` ejecuta todos los casos y `OpenApiContractIT` compara `paths` y `components` con `openapi.json`.
- Go: un test ejecuta todos los casos contra `httptest.NewServer` y otro verifica que el `openapi.json` embebido sea idéntico a este.
- E2E: `e2e/tests/parity.spec.ts` envía cada caso a `/api/java` y `/api/go` a través de nginx.

## Cómo agregar un caso

1. Agregá el objeto al final de `parity-cases.json` con la misma forma que los existentes.
2. Levantá el backend Java, mandá el request y copiá status, `Content-Type` y body crudo reales en `expected`.
   - `rawBody` se copia **byte a byte**. El archivo usa escapes ASCII (`\uXXXX`) para lo que no es ASCII; generalo con `json.dumps(..., ensure_ascii=True)` o editá a mano respetando eso.
   - `viaProxy: false` solo para casos que dependen del path o del query string exactos, que nginx reescribe al quitar el prefijo. El resto corre también a través del proxy.
   - El `HttpClient` de Java no permite headers restringidos (`Host`, `Content-Length`, `Connection`…): un caso que los necesite rompe `ContractParityIT`.
3. Actualizá los conteos fijos, que existen a propósito para detectar casos perdidos: `backend-go/internal/httpapi/contract_test.go` (total de casos) y `e2e/tests/parity.spec.ts` (total y casos `viaProxy`).
4. Corré `cd backend && mvn -B verify`, `make test-go` y `make e2e`; los tres deben pasar. Si Go difiere, se corrige Go: el contrato lo define Java.

## Cómo agregar o cambiar una operación

1. Implementala en Java y en Go.
2. Regenerá `openapi.json`: `cd backend && mvn -B -q package -DskipTests`, levantá el jar en un puerto libre, pedí `/v3/api-docs` y normalizalo con `python3 -I` (quitar `servers`; `json.dumps(d, indent=2, sort_keys=True, ensure_ascii=False) + "\n"`).
3. Copiá el resultado a `backend-go/internal/httpapi/openapi.json` (Go lo embebe con `go:embed`; un test exige que sea idéntico a este archivo) y agregá los casos de paridad de la operación.
4. Verificá que Java, Go y E2E pasen.
