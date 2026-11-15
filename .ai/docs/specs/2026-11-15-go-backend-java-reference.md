# Java backend: HTTP behavior reference for Go parity

Target: `backend/` (Java 21, Spring Boot 4.1.2, Spring MVC 7 on Tomcat, Jackson 3.1.7, springdoc 3.2.0).
Date of observation: 2026-11-15.

**Evidence sources**
- **Code**: `backend/src/main/...` cited as `File.java:line`. All paths below are under `backend/src/main/java/com/sezzle/calculator/` unless stated.
- **Observed**: requests sent as raw HTTP/1.1 bytes (a Python socket client, so every byte is controlled) to:
  - a jar built from a copy of `backend/` (`mvn -B -q package -DskipTests`) running on `:18099`, and
  - the dev stack backend on `:8090` (read-only requests).

  All 80 fixture cases (section 7) returned byte-identical status, headers and body on both. Response bodies are quoted verbatim. `Date` headers are left out, and `Connection: close` only appears in quotes where the server added it on its own (see section 6).
- **Binding docs**: ADR-002 (`.ai/decisions/ADR-002-operaciones-basicas-contrato-y-modelo.md`), ADR-003, `.ai/docs/specs/2026-11-15-basic-operations.md`, `.ai/docs/specs/2026-11-15-optional-operations.md`, `.ai/architecture.md`.

Companion files in the same scratchpad folder:
- `/private/tmp/claude-501/-Users-gallardo-Downloads/656343d5-83a3-4e73-9269-ef1423c0f7bf/scratchpad/java-parity-fixtures.json`: the 80 verified cases as machine-readable JSON, with exact `rawBody` strings.
- `/private/tmp/claude-501/-Users-gallardo-Downloads/656343d5-83a3-4e73-9269-ef1423c0f7bf/scratchpad/java-openapi-v3-api-docs.json`: the live `/v3/api-docs` document.
- `/private/tmp/claude-501/-Users-gallardo-Downloads/656343d5-83a3-4e73-9269-ef1423c0f7bf/scratchpad/probe/`: probe scripts (`s1.py`…`s7.py`, `fixtures.py`) and their raw outputs (`*.out`). To re-run the fixture against a Go server: `python3 -I fixtures.py out.json` after changing the ports in `run()`.

---

## 0. The 15 parity traps that matter most

1. **ProblemDetail JSON keys are in alphabetical order**: `detail, instance, status, title`. This is not the order of RFC 9457 and not the order in which the handler sets them. Jackson 3 turns on `MapperFeature.SORT_PROPERTIES_ALPHABETICALLY` by default (confirmed: `isEnabled(...) == true` on the bundled `jackson-databind-3.1.7`). Success bodies are `operation, result`, which is both the record order and alphabetical order.
2. **Error `Content-Type` is exactly `application/problem+json`**, with no charset. Success is exactly `application/json`, with no charset, unless the client's `Accept` carries parameters (trap 12).
3. **The `detail` of `Malformed request` is not always constant.**
   - Bean Validation failures produce `"<field> must not be null"` entries. They are sorted as Java strings (lexicographic, so `operands[10]` sorts before `operands[2]`) and joined with `"; "`.
   - Everything else (syntax, types, unknown fields, trailing tokens) produces the constant `Request body is not valid JSON or does not match the expected shape`.
4. **An empty string or a blank string as an operand (`""`, `" "`) is coerced to `null`.** The response is `Malformed request` with detail `operands[0] must not be null`, not the constant detail. `"1"` gives the constant detail.
5. **Null checks run before the operation lookup.** `{"operation":"nope","operands":[null]}` returns `Malformed request` (`operands[0] must not be null`), not `Unsupported operation`.
6. **Case-sensitive keys.** `{"Operation":...}` is an unknown field, so `Malformed request`. Go's `encoding/json` matches keys case-insensitively, and `DisallowUnknownFields` does not prevent that.
7. **Strings are not numbers.** Go's `json.Number` accepts the JSON string `"1"`. Java rejects it with `Malformed request`.
8. **Number literal limits come from Jackson.**
   - An integer literal may have at most 1000 digits.
   - A float literal may have at most 1000 digits in total, counting integer, fraction and exponent digits together. Sign, `.`, `e` and the exponent sign are not counted.
   - The resulting BigDecimal scale (number of fraction digits minus the exponent) must be within [−2147483647, 2147483647].
   - Anything beyond these limits is `Malformed request`. Within them, the domain checks apply (usually `Operand out of range`).
9. **Body-level JSON quirks.**
   - A UTF-8 BOM is accepted.
   - Invalid UTF-8 is `Malformed request`.
   - UTF-16 bodies are auto-detected and accepted.
   - `charset=ISO-8859-1` is honored.
   - Trailing tokens after the object are `Malformed request`. Trailing whitespace is allowed.
   - Duplicate keys: the last one wins.
10. **The truncation in `unsupported operation: <code>` counts UTF-16 code units.**
    - The code is cut to 32 units and then `…` (U+2026) is appended.
    - The cut can split a surrogate pair. The output then contains the escape `\uD83D` (uppercase hex).
    - Output escaping follows Jackson, not Go: `<`, `>` and `&` stay raw, U+2028 and U+2029 stay raw, control characters use the uppercase form `\u001F`, and `\t \n \r \b \f` use short escapes.
11. **Status precedence in the HTTP layer**: 404 (path) → 405 (method) → 415 (Content-Type) → 406 (Accept) → body parsing → validation → domain. The 405, 406 and 415 bodies are Spring's own ProblemDetails, with titles `Method Not Allowed`, `Not Acceptable` and `Unsupported Media Type`.
12. **`Accept` quirks.**
    - `Accept: application/problem+json` gives **406**, even for requests that would produce an error.
    - `Accept: garbage` gives 406 with an **empty body** and no Content-Type.
    - Parameters in `Accept` are echoed into the response `Content-Type`. For example `Accept: application/json;foo=bar` gives `Content-Type: application/json;foo=bar`.
    - `Accept: application/json;charset=ISO-8859-1` gives **500** with `{"detail":"Failed to write request",...,"title":"Internal Server Error"}`.
13. **`instance` is the raw request URI path.** It keeps percent-encoding and matrix parameters and drops the query string: `/api/v1/calculate;a=b`, `/api/v1/%63alculate`. Matrix parameters (`;jsessionid=1`) still route to the endpoint. A trailing slash gives 404.
14. **Negative zero is never printed.** Every zero result is `"0"` (for example `divide [-1, 2e10]` and `multiply [-2.5, 0]`). Rounding is HALF_EVEN (banker's rounding) at 10 decimals for divide, sqrt and power. Percentage is exact and can have up to 22 decimals.
15. **Power checks run in a fixed order**: exponent must be an integer → exponent must be in [−1000, 1000] → estimate `L = e·log10|b|`, rejecting when L > 101 and returning `0` when L < −11 → compute → exact check for more than 100 integer digits. An exponent with |e| ≥ 10^15 fails earlier, at the generic operand check, with detail `operands[1] absolute value must be less than 10^15` rather than the "between -1000 and 1000" text.

---

## 1. Endpoints

### 1.1 Routes exposed

| Route | Source | Observed |
|---|---|---|
| `POST /api/v1/calculate` | `CalculatorController.java:23` (`@RequestMapping("/api/v1")`) and `:68-71` (`@PostMapping(path="/calculate", consumes=application/json, produces=application/json)`) | see §2–§5 |
| `GET /actuator/health` (+ `/liveness`, `/readiness`) | `application.yml:11-19` (exposure `health`, probes enabled) | see 1.3 |
| `GET /actuator` | actuator discovery (Spring default) | 200 `application/vnd.spring-boot.actuator.v3+json`, `{"_links":{"self":{"href":"http://localhost:18099/actuator","templated":false},"health-path":{"href":"http://localhost:18099/actuator/health/{*path}","templated":true},"health":{"href":"http://localhost:18099/actuator/health","templated":false}}}`. The hrefs are absolute and built from the `Host` header. |
| `GET /v3/api-docs` | `application.yml:21-23`, `OpenApiConfig.java:8-17` | 200 `Content-Type: application/json`, OpenAPI 3.1.0. `servers[0].url` is built from the request host (`"http://localhost:18099"`, `"description":"Generated server url"`). A copy is saved as `java-openapi-v3-api-docs.json`. |
| `GET /v3/api-docs.yaml` | springdoc | 200 `Content-Type: application/vnd.oai.openapi` |
| `GET /v3/api-docs/swagger-config` | springdoc | 200 `application/json` `{"configUrl":"/v3/api-docs/swagger-config","oauth2RedirectUrl":"http://localhost:18099/swagger-ui/oauth2-redirect.html","url":"/v3/api-docs","validatorUrl":""}` |
| `GET /swagger-ui.html` | `application.yml:24-25` | **302** `Location: /swagger-ui/index.html`, `Content-Length: 0` |
| `GET /swagger-ui/index.html` | springdoc | 200 `text/html`, `Cache-Control: no-store` |
| `GET /actuator/info`, `/actuator/env` | not exposed | 404 problem (see 1.4) |
| `GET /error` | Spring Boot `BasicErrorController` | 500 `application/json` `{"timestamp":"…","status":999,"error":"None"}`. This is a framework artifact; nothing in the contract uses it. |

Note: the nginx in `frontend/nginx.conf` proxies **only `/api/`** to the backend. Behind `:3000`, `/actuator/health` and `/v3/api-docs` return the SPA's `index.html` (200 `text/html`). The only path that is part of the contract for the browser is `/api/v1/calculate`.

### 1.2 Other methods on `/api/v1/calculate` (observed)

```
GET /api/v1/calculate                  (same for PUT, DELETE, PATCH; Accept and Content-Type do not matter)
HTTP/1.1 405
Allow: POST
Content-Type: application/problem+json
Transfer-Encoding: chunked

{"detail":"Method 'GET' is not supported.","instance":"/api/v1/calculate","status":405,"title":"Method Not Allowed"}
```
- The detail substitutes the method: `Method 'PUT' is not supported.`, `Method 'DELETE' …`, `Method 'PATCH' …`.
- `PUT` with `Content-Type: text/plain` still returns 405, so the method check runs before the Content-Type check.
- `HEAD /api/v1/calculate` → `405`, `Allow: POST`, `Content-Type: application/problem+json`, no body.
- `OPTIONS /api/v1/calculate` → `200`, `Allow: POST,OPTIONS`, `Accept-Patch: ` (empty value), `Content-Length: 0`.
- `OPTIONS` with `Origin` and `Access-Control-Request-Method: POST` → `200`, `Allow: GET, HEAD, POST, PUT, DELETE, OPTIONS, PATCH`, no `Access-Control-*` headers. CORS is not configured (`.ai/architecture.md:122`).
- `POST` with an `Origin` header → normal 200 and no CORS headers.

### 1.3 Health (exact)

```
GET /actuator/health
HTTP/1.1 200
Content-Type: application/vnd.spring-boot.actuator.v3+json
Transfer-Encoding: chunked

{"groups":["liveness","readiness"],"status":"UP"}
```
- With `Accept: application/json` → same body, `Content-Type: application/json`.
- `GET /actuator/health/liveness` and `/readiness` → `{"status":"UP"}`, same Content-Type rules.
- `HEAD /actuator/health` → 200, no body.
- `OPTIONS` → `Allow: GET,HEAD,OPTIONS`.
- `POST` → 405 `Allow: GET` `{"detail":"Method 'POST' is not supported.","instance":"/actuator/health","status":405,"title":"Method Not Allowed"}`.
- The Docker healthcheck uses `curl -fs http://localhost:${SERVER_PORT}/actuator/health` (`backend/Dockerfile`), so only the 200 status matters for it.

### 1.4 Unknown paths, trailing slash, case, query strings (observed)

```
GET /nope                     (any Accept: text/html, application/json, or none)
HTTP/1.1 404
Content-Type: application/problem+json
Transfer-Encoding: chunked

{"detail":"No static resource nope.","instance":"/nope","status":404,"title":"Not Found"}
```
- The detail is `No static resource <path without leading slash>.`
  - `/` → `No static resource .`
  - `/api/v1` → `No static resource api/v1.`
- `POST /api/v1/calculate/` (trailing slash) → 404 `{"detail":"No static resource api/v1/calculate.","instance":"/api/v1/calculate/","status":404,"title":"Not Found"}`. The trailing slash is stripped in `detail` but kept in `instance`.
- `POST /api/v1/Calculate` → 404 (paths are case-sensitive). `POST /api/v1/calculate.json` → 404. `POST /api/v1//calculate` → 404 (`instance` is `/api/v1//calculate`, `detail` says `api/v1/calculate.`).
- `POST /api/v1/calculate;jsessionid=1` → **200** (matrix parameter ignored for routing).
- `POST /api/v1/calculate?x=1&operation=sub` → **200**. The query string is ignored.
- `POST /api/v1/%63alculate` → routed to the endpoint (decoded). Its error `instance` is the raw `/api/v1/%63alculate`.

---

## 2. Request parsing

### 2.1 Content-Type (the `consumes` value at `CalculatorController.java:70`)

| Request `Content-Type` | Result |
|---|---|
| `application/json` | accepted |
| `application/json;charset=UTF-8`, `application/json; charset=utf-8`, `APPLICATION/JSON` | accepted |
| `application/json;charset=ISO-8859-1` | accepted, and the body **is decoded as Latin-1**: byte `E1` gives `á`, so `{"operation":"\xE1dd"}` → `unsupported operation: ádd` |
| `application/json;charset=UTF-16BE` with a UTF-16BE body | accepted |
| `application/json;charset=bogus` | 415 `{"detail":"Could not parse Content-Type.","instance":"/api/v1/calculate","status":415,"title":"Unsupported Media Type"}` |
| missing, or empty `Content-Type:` | 415 `{"detail":"Content-Type 'null' is not supported.",…}` |
| `text/plain` | 415 (raw below) |
| `application/problem+json`, `application/merge-patch+json`, `application/*`, `application/x-www-form-urlencoded` | 415 `Content-Type '<value>' is not supported.` |
| `garbage` | 415 `Could not parse Content-Type.` |

```
POST /api/v1/calculate   Content-Type: text/plain
HTTP/1.1 415
Accept: application/json
Content-Type: application/problem+json
Transfer-Encoding: chunked

{"detail":"Content-Type 'text/plain' is not supported.","instance":"/api/v1/calculate","status":415,"title":"Unsupported Media Type"}
```
Every 415 includes the response header **`Accept: application/json`**. 415 is checked before 406: `Content-Type: text/plain` together with `Accept: text/plain` gives 415.

### 2.2 Accept (the `produces` value at `CalculatorController.java:71`)

| Request `Accept` | Result |
|---|---|
| none, `*/*`, `application/json`, `application/*`, `application/*+json`, `*/*;q=0.1`, `text/plain, application/json`, `application/json, application/problem+json`, empty value | 200 `Content-Type: application/json` |
| `application/json;q=0` | 200 (q=0 is not treated as a rejection) |
| `application/json;charset=UTF-8` / `;charset=utf-8` / `;q=0.9;charset=UTF-8` / `;foo=bar` | 200, and the response `Content-Type` **echoes the parameters**: `application/json;charset=UTF-8`, `application/json;charset=utf-8`, `application/json;foo=bar` |
| `application/json;charset=ISO-8859-1` or `;charset=UTF-16` | **500** `{"detail":"Failed to write request","instance":"/api/v1/calculate","status":500,"title":"Internal Server Error"}` (`application/problem+json`). This happens only on the success path; errors are still written as problem+json. |
| `text/plain`, `text/html`, `application/xml`, **`application/problem+json`** | 406 (raw below), on both the success and the error path |
| `garbage` | 406, **empty body**, headers only `Accept: application/json` and `Content-Length: 0` |
| `Accept-Charset`, `Accept-Encoding: gzip` | no effect (no compression) |

```
POST /api/v1/calculate   Content-Type: application/json   Accept: text/plain
HTTP/1.1 406
Accept: application/json
Content-Type: application/problem+json
Transfer-Encoding: chunked

{"detail":"Acceptable representations: [application/json].","instance":"/api/v1/calculate","status":406,"title":"Not Acceptable"}
```
406 is checked before the body is parsed (`{` with `Accept: text/plain` → 406) and before domain errors (`divide [1,0]` with `Accept: application/problem+json` → 406). Error responses negotiated with `Accept: application/json` are still sent as `application/problem+json`.

### 2.3 Body shape (all observed; "MR-const" means 400 `Malformed request` with the constant detail `Request body is not valid JSON or does not match the expected shape`)

| Body | Result |
|---|---|
| empty (`Content-Length: 0`), whitespace only | MR-const |
| `null`, `[]`, `[{…}]`, `5`, `"add"`, `true` | MR-const |
| `{}` | MR `operands must not be null; operation must not be null` |
| `{"operation":"add"}` / `{"operands":[1,2]}` / `{"operation":null,…}` | MR `operands must not be null` / `operation must not be null` / `operation must not be null` |
| `{"operation":null,"operands":null}` | MR `operands must not be null; operation must not be null` |
| `{"operation":null,"operands":[null]}` | MR `operands[0] must not be null; operation must not be null` |
| `{…} x`, `{…}{}`, `{…} {"a":1}`, `{…}]` (trailing tokens) | MR-const (Jackson 3 `FAIL_ON_TRAILING_TOKENS` is on by default; confirmed `true`) |
| `{…}\n\n`, leading `\n\t `, spaces around tokens | accepted |
| trailing comma in an object or array, single quotes, unquoted keys, `//` or `/* */` comments | MR-const |
| raw TAB inside a string, invalid escape `\x` | MR-const |
| raw DEL (0x7F) inside a string | accepted (the character is echoed raw in `detail`) |
| duplicate key `{"operation":"subtract","operation":"add",…}` | **last wins** → 200 `add` |
| `{"operation":"add","operands":[1,2],"operands":[5,5]}` | 200 `"10"` |
| `{…,"operands":[1,2],"operands":null}` | MR `operands must not be null` |
| `{"operation":"add","operands":[1,2],"operation":5}` | MR-const (type error on the later key) |
| unknown field (`"foo":1`, `"foo":null`, nested `"foo":[[[…600 deep…]]]`) | MR-const (`JacksonConfig.java:20` `FAIL_ON_UNKNOWN_PROPERTIES`) |
| case-variant key `{"Operation":"add",…}` | MR-const |
| UTF-8 BOM prefix | **accepted** (200) |
| UTF-16LE or UTF-16 with BOM, no charset | **accepted** (Jackson detects the encoding) |
| invalid UTF-8 byte (`\xE1` without charset) | MR-const |
| `"add"` (escaped) | treated as `add` (200) |
| a 5,000,000-character operation string | 400 `Unsupported operation` (truncated detail). No size limit is enforced (Jackson `maxStringLength` = 100,000,000; Tomcat sets no limit on JSON bodies). |
| 200,000 operands | 400 `add requires 2 operands, got 200000` |

### 2.4 Field types (`CalculationRequest.java:14-15, 21-22`; coercion rules at `JacksonConfig.java:21-31`)

| Field value | Result |
|---|---|
| `operation`: number `5` or `5.5`, boolean, array `["add"]` or `[]`, object | MR-const (Textual coercion from Integer, Float and Boolean set to `Fail`) |
| `operation`: `""` | 400 `Unsupported operation`, `unsupported operation: ` (note the trailing space) |
| `operation`: `" add"` | `unsupported operation:  add` (two spaces) |
| `operands`: number `1`, string `"1,2"`, string `""`, object, boolean | MR-const |
| `operands`: `[]` | 400 `Invalid operand count` (`add requires 2 operands, got 0`) |
| operand `"1"` (string) or `true` | MR-const (`JacksonConfig.java:22-26`) |
| operand `""` or `" "` (empty or blank string) | **MR `operands[0] must not be null`**. EmptyString coercion is not configured, so Jackson's default turns it into null, and `@NotNull` then reports it. |
| operand `null` | MR `operands[i] must not be null` |
| operand `{}`, `[1]`, `[]` | MR-const |

### 2.5 Number grammar and limits (observed)

| Literal | Result |
|---|---|
| `01`, `-01`, `+1`, `.5`, `5.`, `NaN`, `Infinity`, `0x10`, `1e` | MR-const (strict JSON) |
| `1e3`, `1E+3`, `1e-3`, `1E1`, `1e+0`, `1e-0`, `1e00000000002` | accepted (`1E+3` gives 1000; leading zeros in the exponent are allowed) |
| `-0`, `-0.0`, `-0e5`, `0.0` | accepted as zero |
| `1.0e0`, `2.000`, `100e-2` | normalized (trailing zeros stripped) |

**Jackson `StreamReadConstraints.maxNumberLength = 1000`** (read from the bundled jackson-core 3.1.7: `maxNumberLength=1000`, `maxNestingDepth=500`, `maxStringLength=100000000`, `maxDocumentLength=-1`). Cut-offs found by binary search:

| Shape | Max accepted | First rejected (MR-const) |
|---|---|---|
| integer `1…` (digits) | 1000 digits | 1001 digits |
| negative integer `-1…` | 1000 digits (the sign is not counted) | 1001 digits |
| `0.` + n zeros | n = 999 (1 + 999 = 1000 digits) | n = 1000 |
| `1.` + n zeros | n = 999 | n = 1000 |
| `1…1.0` | 999 integer digits + 1 | 1000 + 1 |
| `1…1.0…0`, equal split | 500 + 500 | 501 + 501 |
| 500 integer digits + n fraction digits | n = 500 | n = 501 |
| `1e` + n exponent digits | n = 999 | n = 1000 |
| `1e-` + n exponent digits, `1e+` + n | n = 999 | n = 1000 |
| `1…1e0` | 999 + 1 | 1000 + 1 |
| `0.` + n zeros + `e0` | n = 998 (1 + 998 + 1) | n = 999 |

**Rule**: `intDigits ≤ 1000` for integer tokens, and `intDigits + fracDigits + expDigits ≤ 1000` for float tokens. Sign characters, `.`, `e`/`E` and the exponent sign are **not counted**. ADR-002's wording ("more than 1000 characters") is approximate.

**BigDecimal scale range** (observed over HTTP and confirmed directly against `tools.jackson` 3.1.7). Let `scale = fracDigits − exponent`, computed with big integers and counting raw fraction digits including trailing zeros. The literal is accepted only when **−2147483647 ≤ scale ≤ 2147483647**:

| Literal | scale | Result |
|---|---|---|
| `1e2147483647` | −2147483647 | accepted → `Operand out of range` (magnitude) |
| `1e2147483648` | −2147483648 | MR-const (Jackson: "value exceeds limits") |
| `0.1e2147483648` | −2147483647 | **accepted**, even though the exponent does not fit in an int32 → `Operand out of range` |
| `0.12e2147483649`, `0.01e2147483649` | −2147483647 | accepted |
| `10e2147483648`, `12e2147483648`, `0e2147483648` | −2147483648 | MR-const |
| `1e-2147483647` | 2147483647 | accepted → `operands[0] has more than 10 decimal places` |
| `1e-2147483648`, `0.1e-2147483647`, `1.5e-2147483647`, `10e-2147483648`, `0e-2147483648` | 2147483648 | MR-const |
| `1e9999999999`, `0e9999999999`, `1e-9999999999` | out of range | MR-const (zero is not exempt) |
| `0e-999999999`, `0e+999999999` | in range | accepted → `0` |

---

## 3. Validation order, errors and exact bodies

### 3.1 Pipeline (first error wins)

1. **HTTP layer** (Spring): path 404 → method 405 → Content-Type 415 → Accept 406.
2. **JSON parsing and binding** (Jackson): syntax, types, unknown fields, trailing tokens, number limits → MR-const (`ProblemDetailHandler.java:45-49`).
3. **Bean Validation** (`@Valid`, `CalculatorController.java:72`; `@NotNull` at `CalculationRequest.java:14,21-22`). It reports all null violations together, sorted and joined (`ProblemDetailHandler.java:51-59`). Each entry is `<field> must not be null`, or `<field> is invalid` for a non-NotNull code, which cannot happen today (`:62-65`).
4. `Operation.fromCode` (exact, case-sensitive `equals`) → `Unsupported operation` (`CalculatorService.java:20`, `Operation.java:143-150`).
5. Arity → `Invalid operand count` (`CalculatorService.java:22-24`).
6. `new Operand(value)` in index order. The first failure is rethrown with `operands[i] ` prepended (`CalculatorService.java:26-32`, `OperandOutOfRangeException.java:12-14`).
7. `operation.validate(operands)` (`CalculatorService.java:33`): sqrt negative; power integer, then exponent range, then estimate.
8. `operation.apply(operands)`: division by zero, power exact check (`CalculatorService.java:34`).
9. Any other exception → `Internal error` (`ProblemDetailHandler.java:97-101`).

Order examples (observed): `xxx [1e999999999]` → Unsupported; `add [1e999999999]` → count; `divide [1e999999999,0]` → range; `sqrt [-1e999999999]` → range (operands[0] magnitude); `power [1e999999999,0.5]` → range idx 0; `power [2,1000.5]` → Invalid operand (integer check before range); `power [2,1e999999999]` → range from the generic check (`operands[1] absolute value must be less than 10^15`); `{"operation":"nope","operands":[null]}` → Malformed.

### 3.2 ProblemDetail body format

- **Key order**: `detail`, `instance`, `status`, `title`. **No `type`** (it defaults to about:blank and is omitted). No `properties` and no extra members.
- `status` is a JSON number. `instance` is the raw request path (§1.4).
- Built by `ProblemDetail.forStatusAndDetail` plus `setTitle` (`ProblemDetailHandler.java:112-116`). Spring fills in `instance`.
- Headers: `Content-Type: application/problem+json`. The observed body is sent chunked (no `Content-Length`). 400 and 500 responses also carry `Connection: close` (§6).

Canonical raw example:
```
POST /api/v1/calculate   {"operation":"divide","operands":[1,0]}
HTTP/1.1 400
Content-Type: application/problem+json
Transfer-Encoding: chunked
Connection: close

{"detail":"division by zero","instance":"/api/v1/calculate","status":400,"title":"Division by zero"}
```

### 3.3 Every contract error (titles: `ProblemDetailHandler.java:32-39`)

| Title | Status | Exact `detail` | Source |
|---|---|---|---|
| `Malformed request` | 400 | `Request body is not valid JSON or does not match the expected shape` | `ProblemDetailHandler.java:41-42,45-49` |
| `Malformed request` | 400 | sorted `"; "` join of `operation must not be null`, `operands must not be null`, `operands[<i>] must not be null` | `:51-65` |
| `Unsupported operation` | 400 | `unsupported operation: <code>`. The code is cut to its first 32 UTF-16 code units and `…` (U+2026) appended when longer than 32. The code is the raw received string (it can be `""`). | `UnsupportedCalculationException.java:5-16` |
| `Invalid operand count` | 400 | `<op> requires <n> operand, got <m>` when n = 1 (sqrt), `<op> requires <n> operands, got <m>` otherwise. `<op>` is the lowercase code. `<m>` is not pluralized. | `InvalidOperandCountException.java:8-9` |
| `Operand out of range` | 400 | `operands[<i>] absolute value must be less than 10^15` | `Operand.java:14-16` + `withIndex` |
| `Operand out of range` | 400 | `operands[<i>] has more than 15 significant digits` | `Operand.java:18-20` |
| `Operand out of range` | 400 | `operands[<i>] has more than 10 decimal places` | `Operand.java:21-23` |
| `Operand out of range` | 400 | `operands[1] must be between -1000 and 1000` | `Operation.java:54-56` |
| `Invalid operand` | 400 | `operands[0] must not be negative` (sqrt) | `Operation.java:92-94`, `InvalidOperandException.java:6` |
| `Invalid operand` | 400 | `operands[1] must be an integer` (power exponent) | `Operation.java:51-53` |
| `Result out of range` | 400 | `result would exceed 100 integer digits` | `ResultOutOfRangeException.java:6` |
| `Division by zero` | 400 | `division by zero` (lowercase) | `DivisionByZeroException.java:6` |
| `Internal error` | 500 | `An unexpected error occurred` | `ProblemDetailHandler.java:43,97-101` (unit test: `ProblemDetailHandlerTest`). **I found no HTTP request that reaches it.** |
| `Internal Server Error` (Spring) | 500 | `Failed to write request` | reachable with `Accept: application/json;charset=ISO-8859-1` (§2.2) |
| `Method Not Allowed` / `Unsupported Media Type` / `Not Acceptable` / `Not Found` (Spring) | 405/415/406/404 | see §1–§2 | inherited `ResponseEntityExceptionHandler` |

Plural and truncation examples (observed):
- `sqrt requires 1 operand, got 0`, `sqrt requires 1 operand, got 2`, `add requires 2 operands, got 1`, `divide requires 2 operands, got 11`, `percentage requires 2 operands, got 0`.
- 32 × `a` → echoed intact. 33 × `a` → `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…`. 40 × `á` → 32 × `á` + `…` (code units, not bytes).
- 31 × `a` + 😀 → `"unsupported operation: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\uD83D…"` (lone high surrogate, uppercase escape). 30 × `a` + 😀 (32 units) → echoed intact with a raw 😀. 30 × `a` + 😀 + `b` → `…aa😀…`.
- The escaped lone surrogate `"\ud800x"` → `"unsupported operation: \uD800x"`.
- Escaping in the output: input `a\tb\nc\rd\be\ff\u0001g\u001fh\u007fi j k/l\\m` gives `"unsupported operation: a\tb\nc\rd\be\ff\u0001g\u001Fh<DEL>i<U+2028>j<U+2029>k/l\\m"`. DEL, U+2028 and U+2029 are emitted raw and `/` is not escaped. `<script>&'"` gives `<script>&'\"`. A NUL escape gives `add\u0000`.

**Locale independence (observed)**:
- `Accept-Language: es-ES`, `de`, `fr` and `ja` do not change any detail. Examples: `operands[0] must not be null`, `operands must not be null`, the 405, 406 and 415 texts, and `ok`.
- No `Content-Language` or `Vary` header is ever sent.
- Bean Validation default messages are bypassed on purpose (`ProblemDetailHandler.java:61-65`).

---

## 4. Success responses

```
POST /api/v1/calculate   Content-Type: application/json   {"operation":"add","operands":[1,2]}
HTTP/1.1 200
Content-Type: application/json
Content-Length: 32

{"operation":"add","result":"3"}
```
- Body: `{"operation":<lowercase code>,"result":<string>}`, in that order, without spaces (`CalculationResponse.java:6-14`, `CalculatorController.java:75`). `operation` is the canonical code (`result.operation().code()`), which equals the request value because matching is exact.
- `result` = `value.stripTrailingZeros().toPlainString()` (`CalculationResult.java:7-9`):
  - never uses an exponent (`1E+3` → `"1000"`, `1E-22` → `"0.0000000000000000000001"`);
  - never has trailing fraction zeros or a trailing `.`;
  - zero of any scale or sign → `"0"`;
  - a minus sign appears only when the value is non-zero.

Concrete examples (all observed):

| Request | result |
|---|---|
| add [0.1, 0.2] | `0.3` |
| add [1E+3, 1e-3] | `1000.001` |
| add [999999999999999, 999999999999999] | `1999999999999998` |
| subtract [5, 8] | `-3` |
| subtract [-999999999999999, 999999999999999] | `-1999999999999998` |
| subtract [0, 0] | `0` |
| multiply [999999999999999, 999999999999999] | `999999999999998000000000000001` |
| multiply [-2.5, 0] / [-1, 0] / [-0.0, 5] | `0` |
| multiply [0.0000000001, 0.0000000001] | `0.00000000000000000001` |
| divide [6,3] / [1,3] / [2,3] / [1,8] | `2` / `0.3333333333` / `0.6666666667` / `0.125` |
| divide [0.0000000001, 3] | `0` |
| divide [-1, 3] | `-0.3333333333` |
| divide [1, 20000000000] (exact 0.00000000005, tie) | `0` |
| divide [3, 20000000000] (tie at 1.5) / [5, 20000000000] (tie at 2.5) | `0.0000000002` / `0.0000000002` (HALF_EVEN) |
| divide [-1, 20000000000] / [0, -5] | `0` / `0` |
| divide [999999999999999, 0.0000000001] | `9999999999999990000000000` |
| sqrt [2] / [16] / [0.25] / [3] | `1.4142135624` / `4` / `0.5` / `1.7320508076` |
| sqrt [0.0000000001] / [0.0000000002] | `0.00001` / `0.0000141421` |
| sqrt [999999999999999] | `31622776.6016837775` |
| sqrt [0] / [-0] | `0` / `0` |
| power [2,64] | `18446744073709551616` |
| power [2,-3] / [3,-5] / [-2,-3] / [-2,-1] | `0.125` / `0.0041152263` / `-0.125` / `-0.5` |
| power [1.5,3] / [0.5,10] / [0.1234567891,3] / [-2,3] | `3.375` / `0.0009765625` / `0.0018816764` / `-8` |
| power [0.5,11] (exact 0.00048828125, tie) / [-0.5,11] | `0.0004882812` / `-0.0004882812` |
| power [0,0] / [0,0.0] / [2,-0] / [1,1000] / [1,-1000] / [-1,999] / [-1,-1000] / [0,1000] | `1` / `1` / `1` / `1` / `1` / `-1` / `1` / `0` |
| power [2,2.0] | `4` (2.0 normalizes to an integer) |
| power [10,99] | `1` followed by 99 zeros (100 integer digits, accepted) |
| power [2,332] | `8749002899132047697490008908470485461412677723572849745703082425639811996797503692894052708092215296` (100 digits) |
| power [9.9999999999,100] | `9999999990000000004949999998383000000392122499924712480011920523998399243920186087894280977681917731.0309455024` |
| power [3,-1000] / [2,-1000] / [-3,-999] | `0` (L < −11 short-circuit) |
| power [10,-11] / [-10,-11] / [0.1,11] | `0` (L = −11 exactly, so it is computed, then rounds to 0) |
| power [10,-10] | `0.0000000001` |
| power [2,-34] | `0.0000000001` (5.82e-11 rounds up) |
| power [1.0000000001,1000] / [0.9999999999,1000] | `1.0000001` / `0.9999999` |
| power [999999999999999,6] | `999999999999994000000000000014999999999999980000000000000014999999999999994000000000000001` |
| percentage [20,150] / [12.5,80] / [0.1,0.1] / [-15,200] / [0,-5] | `30` / `10` / `0.0001` / `-30` / `0` |
| percentage [-0.0000000001, 0.0000000001] | `-0.0000000000000000000001` (exact, 22 decimals) |
| percentage [999999999999999, 999999999999999] | `9999999999999980000000000000.01` |

---

## 5. Arithmetic semantics to reproduce

### 5.1 Operand (`Operand.java:6-27`)

The checks run in this order, on the parsed BigDecimal `v`:
1. **Magnitude**, on the raw value: `v ≠ 0 && precision(v) − scale(v) > 15` → `absolute value must be less than 10^15`. For non-zero values this is the same as `|v| ≥ 10^15`, and it does not depend on trailing zeros. Zero is always exempt.
2. Normalize: `n = v.stripTrailingZeros()`. Zero becomes plain `0` (precision 1, scale 0).
3. `precision(n) > 15` → `has more than 15 significant digits`.
4. `scale(n) > 10` → `has more than 10 decimal places`. A negative scale (for example `1E+14`) is fine.
5. Store `n`. Every later step uses normalized values (`Operand.java:24-26`).

Observed boundaries:

| Input | Result |
|---|---|
| `999999999999999` | ok |
| `1e15`, `-1000000000000000` | magnitude |
| `999999999999999.0` | ok |
| `999999999999999.9` | 16 sig digits |
| `9.99999999999999e14` | ok |
| `1000000000000000e-1` | ok → `100000000000000` |
| `1234567890123456e-5` | 16 sig digits (magnitude is fine: 11 integer digits) |
| `0.1234567890123456` | 16 sig digits (that check runs before the decimals check) |
| `12345678901.2345` | ok |
| `0.00000000010`, `1e-10`, `10e-11` | ok → `0.0000000001` |
| `0.00000000001`, `1e-11` | decimals |
| `1.00000000000000000000` | ok → `1` |
| `123456789012345.0000000000` | ok |

The magnitude check comes first. `1234567890123456` (16 digits) reports the magnitude reason, not the significant-digits reason.

### 5.2 Operations (`Operation.java`)

- **add / subtract / multiply** (`:18-35`): exact.
- **divide** (`:36-45`): the divisor is checked for zero first (`signum == 0`, which also covers `-0.000`), giving `DivisionByZeroException`. Otherwise `a.divide(b, 10, HALF_EVEN)`: one rounding of the exact quotient, at scale 10.
- **sqrt** (`:84-102`):
  - arity 1;
  - `validate`: `signum < 0` → `operands[0] must not be negative`. `-0` normalizes to 0, so it passes;
  - `apply` re-runs `validate`, then computes `v.sqrt(MathContext.DECIMAL128)`: 34 significant digits, HALF_EVEN. That value is then rounded with `setScale(10, HALF_EVEN)`, so there are two roundings. The spec argues that double rounding is safe for inputs with ≤ 10 decimals (`2026-11-15-optional-operations.md`, rules table).
  - A Go port that computes a correctly rounded value at 10 decimals in one step (for example an integer sqrt of `v·10^20` with a HALF_EVEN tie check) gives the same output on every case in this document.
- **power** (`:46-83`):
  - `validate` (`:48-60`):
    1. the normalized exponent must have `scale > 0` false, otherwise `operands[1] must be an integer`;
    2. `e < -1000 || e > 1000` → `operands[1] must be between -1000 and 1000` (`OperandOutOfRangeException(...).withIndex(1)`);
    3. `PowerBounds.estimate(base, e) == TOO_LARGE` → `Result out of range`.
  - `apply` (`:63-82`):
    1. re-runs validate;
    2. if the estimate is `ROUNDS_TO_ZERO`, returns `BigDecimal.ZERO`;
    3. if `e ≥ 0`, computes `base.pow(e).setScale(10, HALF_EVEN)`, with exact `0^0 = 1`;
    4. otherwise, `base == 0` → `DivisionByZeroException`, else `ONE.divide(base.pow(-e), 10, HALF_EVEN)`;
    5. finally `requireWithinIntegerDigits(result)`: `precision − scale > 100` → `Result out of range`. This runs on the result after setScale.
- **PowerBounds.estimate** (`PowerBounds.java:25-41`):
  - `|base|` equal to 0 or 1 → COMPUTE.
  - Otherwise `log10 = Math.log10(unscaled(|base|) as double) − scale(|base|)` and `L = e × log10` (in double).
    - `L > 101` → TOO_LARGE.
    - `L < −11` → ROUNDS_TO_ZERO.
    - otherwise COMPUTE.
  - Observed: `10^100` (L = 100) is computed and then rejected by the exact check. `-10^101` (L = 101, not > 101) is computed and rejected. `2^333` (L ≈ 100.24) is computed and rejected. `10^-11` (L = −11, not < −11) is computed → `0`.
  - The double estimate decides cost, not the outcome: with the 1-digit margin, TOO_LARGE and ROUNDS_TO_ZERO always agree with what exact computation would give. A Go port therefore has to keep the short-circuits for CPU reasons, but only the exact results have to match.
- **percentage** (`:103-108`): `a.multiply(b).movePointLeft(2)`. Exact, no rounding, at most 22 decimals.

### 5.3 Defense in depth (not observable, but keep for cost bounds)

- Operand values are stored normalized, so a zero with a huge raw scale (`0e-999999999`) does not trigger huge scale alignment (`Operand.java:24-26`).
- `POWER.apply` and `SQRT.apply` re-run `validate` (`Operation.java:65,99`).
- The cost of power is bounded by the estimate. The worst case that still computes is about 101 integer digits, or ≤ 10,000 fraction digits before `setScale` (for example `0.9999999999^1000`).
- Operands are ≤ 15 significant digits, so `multiply` produces ≤ 30 digits.

---

## 6. Response headers a client can observe

| Header | Value | Notes |
|---|---|---|
| `Content-Type` (success) | `application/json` | `Accept` parameters are echoed (§2.2) |
| `Content-Type` (any ProblemDetail) | `application/problem+json` | no charset |
| `Content-Length` vs `Transfer-Encoding: chunked` | success responses send `Content-Length: 32`; ProblemDetail and health responses are chunked | not semantically relevant |
| `Allow` | `POST` on 405; `POST,OPTIONS` on OPTIONS | |
| `Accept` | `application/json` on 415 and 406 | |
| `Connection: close` | Tomcat adds it to **400 and 500** responses even on keep-alive connections. 404, 405, 406 and 415 keep the connection open. | Tomcat's status-drops-connection list |
| Status line | `HTTP/1.1 200 ` (Tomcat sends no reason phrase) | Go sends `200 OK`; clients ignore it |
| Not sent | `Vary`, `Content-Language`, CORS headers, `Cache-Control` (except swagger-ui), `Server` (nginx adds `Server: nginx/1.29.8` on :3000) | |

The frontend (`frontend/src/features/calculator/api/calculatorApi.ts:31-64`) depends only on:
- `response.ok` and `body.result` (a string) on success;
- `body.title` for 4xx;
- any 5xx, which is shown as "Service unavailable" whatever the title.

It always sends `Content-Type: application/json`, and operands as `Number(x)`. A JS number can serialize to exponent form (for example `1e-7`), so the Go parser must accept exponents.

---

## 7. Parity fixture: 80 cases, all verified

- Machine-readable form, including exact headers and `rawBody` strings to compare byte for byte: `/private/tmp/claude-501/-Users-gallardo-Downloads/656343d5-83a3-4e73-9269-ef1423c0f7bf/scratchpad/java-parity-fixtures.json`.
- Each entry has `request{method,path,headers,body}`, `expected{status,contentType,allow?,body,rawBody}` and `verified{"jar:18099":true,"devstack:8090":true}`.
- "Default headers" means `Content-Type: application/json`. Long bodies and results are shortened here; the JSON file has them in full.
- Every ProblemDetail in the fixture has `"instance":"<request path>"` and keys in the order `detail, instance, status, title`.

| # | name | request (method path / headers if not default / body) | status | expected | 8090 |
|---|------|------|--------|----------|------|
| 1 | add 0.1+0.2 | POST /api/v1/calculate `{"operation":"add","operands":[0.1,0.2]}` | 200 | result `0.3` [application/json] | ✓ |
| 2 | add exponent forms | POST /api/v1/calculate `{"operation":"add","operands":[1E+3,1e-3]}` | 200 | result `1000.001` [application/json] | ✓ |
| 3 | subtract negative result | POST /api/v1/calculate `{"operation":"subtract","operands":[5,8]}` | 200 | result `-3` [application/json] | ✓ |
| 4 | multiply 30 digits | POST /api/v1/calculate `{"operation":"multiply","operands":[999999999999999,999999999999999]}` | 200 | result `999999999999998000000000000001` [application/json] | ✓ |
| 5 | multiply negative zero | POST /api/v1/calculate `{"operation":"multiply","operands":[-2.5,0]}` | 200 | result `0` [application/json] | ✓ |
| 6 | divide 1/3 | POST /api/v1/calculate `{"operation":"divide","operands":[1,3]}` | 200 | result `0.3333333333` [application/json] | ✓ |
| 7 | divide 2/3 rounds | POST /api/v1/calculate `{"operation":"divide","operands":[2,3]}` | 200 | result `0.6666666667` [application/json] | ✓ |
| 8 | divide rounds to zero | POST /api/v1/calculate `{"operation":"divide","operands":[0.0000000001,3]}` | 200 | result `0` [application/json] | ✓ |
| 9 | divide negative | POST /api/v1/calculate `{"operation":"divide","operands":[-1,3]}` | 200 | result `-0.3333333333` [application/json] | ✓ |
| 10 | divide half-even tie 1.5 -> 2 | POST /api/v1/calculate `{"operation":"divide","operands":[3,20000000000]}` | 200 | result `0.0000000002` [application/json] | ✓ |
| 11 | divide half-even tie 2.5 -> 2 | POST /api/v1/calculate `{"operation":"divide","operands":[5,20000000000]}` | 200 | result `0.0000000002` [application/json] | ✓ |
| 12 | divide negative tiny -> 0 (no -0) | POST /api/v1/calculate `{"operation":"divide","operands":[-1,20000000000]}` | 200 | result `0` [application/json] | ✓ |
| 13 | sqrt 2 | POST /api/v1/calculate `{"operation":"sqrt","operands":[2]}` | 200 | result `1.4142135624` [application/json] | ✓ |
| 14 | sqrt 1e-10 | POST /api/v1/calculate `{"operation":"sqrt","operands":[0.0000000001]}` | 200 | result `0.00001` [application/json] | ✓ |
| 15 | sqrt max | POST /api/v1/calculate `{"operation":"sqrt","operands":[999999999999999]}` | 200 | result `31622776.6016837775` [application/json] | ✓ |
| 16 | sqrt -0 | POST /api/v1/calculate `{"operation":"sqrt","operands":[-0]}` | 200 | result `0` [application/json] | ✓ |
| 17 | power 2^64 | POST /api/v1/calculate `{"operation":"power","operands":[2,64]}` | 200 | result `18446744073709551616` [application/json] | ✓ |
| 18 | power 0.5^11 half-even tie | POST /api/v1/calculate `{"operation":"power","operands":[0.5,11]}` | 200 | result `0.0004882812` [application/json] | ✓ |
| 19 | power -2^-3 | POST /api/v1/calculate `{"operation":"power","operands":[-2,-3]}` | 200 | result `-0.125` [application/json] | ✓ |
| 20 | power 0^0 | POST /api/v1/calculate `{"operation":"power","operands":[0,0]}` | 200 | result `1` [application/json] | ✓ |
| 21 | power exponent 2.0 is integer | POST /api/v1/calculate `{"operation":"power","operands":[2,2.0]}` | 200 | result `4` [application/json] | ✓ |
| 22 | power 10^99 (100 int digits ok) | POST /api/v1/calculate `{"operation":"power","operands":[10,99]}` | 200 | result `1000000000000000000000000000000000000000…(100 chars)` [application/json] | ✓ |
| 23 | power 9.9999999999^100 (L<100, 100 int digits) | POST /api/v1/calculate `{"operation":"power","operands":[9.9999999999,100]}` | 200 | result `9999999990000000004949999998383000000392…(111 chars)` [application/json] | ✓ |
| 24 | power 3^-1000 short-circuit 0 | POST /api/v1/calculate `{"operation":"power","operands":[3,-1000]}` | 200 | result `0` [application/json] | ✓ |
| 25 | power 10^-11 (L=-11 computed, rounds 0) | POST /api/v1/calculate `{"operation":"power","operands":[10,-11]}` | 200 | result `0` [application/json] | ✓ |
| 26 | power 2^-34 rounds up | POST /api/v1/calculate `{"operation":"power","operands":[2,-34]}` | 200 | result `0.0000000001` [application/json] | ✓ |
| 27 | power 1.0000000001^1000 | POST /api/v1/calculate `{"operation":"power","operands":[1.0000000001,1000]}` | 200 | result `1.0000001` [application/json] | ✓ |
| 28 | percentage 20 of 150 | POST /api/v1/calculate `{"operation":"percentage","operands":[20,150]}` | 200 | result `30` [application/json] | ✓ |
| 29 | percentage tiny exact 22 decimals | POST /api/v1/calculate `{"operation":"percentage","operands":[-0.0000000001,0.0000000001]}` | 200 | result `-0.0000000000000000000001` [application/json] | ✓ |
| 30 | percentage large | POST /api/v1/calculate `{"operation":"percentage","operands":[999999999999999,999999999999999]}` | 200 | result `9999999999999980000000000000.01` [application/json] | ✓ |
| 31 | operand 1e999999999 magnitude | POST /api/v1/calculate `{"operation":"add","operands":[1e999999999,0.1]}` | 400 | **Operand out of range** — `operands[0] absolute value must be less than 10^15` [application/problem+json] | ✓ |
| 32 | operand 11 decimals | POST /api/v1/calculate `{"operation":"add","operands":[0.12345678901,1]}` | 400 | **Operand out of range** — `operands[0] has more than 10 decimal places` [application/problem+json] | ✓ |
| 33 | operand 16 sig digits | POST /api/v1/calculate `{"operation":"add","operands":[999999999999999.9,1]}` | 400 | **Operand out of range** — `operands[0] has more than 15 significant digits` [application/problem+json] | ✓ |
| 34 | operand 1e15 boundary | POST /api/v1/calculate `{"operation":"add","operands":[1,1e15]}` | 400 | **Operand out of range** — `operands[1] absolute value must be less than 10^15` [application/problem+json] | ✓ |
| 35 | operand 0e-999999999 ok | POST /api/v1/calculate `{"operation":"add","operands":[0e-999999999,1]}` | 200 | result `1` [application/json] | ✓ |
| 36 | operand order idx0 first | POST /api/v1/calculate `{"operation":"add","operands":[1e999999999,1e-999999999]}` | 400 | **Operand out of range** — `operands[0] absolute value must be less than 10^15` [application/problem+json] | ✓ |
| 37 | operand jackson max int digits 1000 | POST /api/v1/calculate `{"operation":"add","operands":[10000000000000000000000000000…(1035 chars)` | 400 | **Operand out of range** — `operands[0] absolute value must be less than 10^15` [application/problem+json] | ✓ |
| 38 | operand jackson int digits 1001 | POST /api/v1/calculate `{"operation":"add","operands":[10000000000000000000000000000…(1036 chars)` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 39 | operand jackson fp digits 1000 | POST /api/v1/calculate `{"operation":"add","operands":[1.000000000000000000000000000…(1036 chars)` | 200 | result `2` [application/json] | ✓ |
| 40 | operand jackson fp digits 1001 | POST /api/v1/calculate `{"operation":"add","operands":[1.000000000000000000000000000…(1037 chars)` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 41 | operand scale overflow | POST /api/v1/calculate `{"operation":"add","operands":[1e-2147483648,1]}` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 42 | operand exponent beyond int but scale fits | POST /api/v1/calculate `{"operation":"add","operands":[0.1e2147483648,1]}` | 400 | **Operand out of range** — `operands[0] absolute value must be less than 10^15` [application/problem+json] | ✓ |
| 43 | unsupported uppercase | POST /api/v1/calculate `{"operation":"ADD","operands":[1,2]}` | 400 | **Unsupported operation** — `unsupported operation: ADD` [application/problem+json] | ✓ |
| 44 | unsupported empty | POST /api/v1/calculate `{"operation":"","operands":[1,2]}` | 400 | **Unsupported operation** — `unsupported operation: ` [application/problem+json] | ✓ |
| 45 | unsupported truncated 33 | POST /api/v1/calculate `{"operation":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","operands":[1,2]}` | 400 | **Unsupported operation** — `unsupported operation: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…` [application/problem+json] | ✓ |
| 46 | unsupported html chars not escaped | POST /api/v1/calculate `{"operation":"<b>&","operands":[1,2]}` | 400 | **Unsupported operation** — `unsupported operation: <b>&` [application/problem+json] | ✓ |
| 47 | unsupported before count | POST /api/v1/calculate `{"operation":"xxx","operands":[1e999999999]}` | 400 | **Unsupported operation** — `unsupported operation: xxx` [application/problem+json] | ✓ |
| 48 | count add 3 | POST /api/v1/calculate `{"operation":"add","operands":[1,2,3]}` | 400 | **Invalid operand count** — `add requires 2 operands, got 3` [application/problem+json] | ✓ |
| 49 | count sqrt 2 | POST /api/v1/calculate `{"operation":"sqrt","operands":[1,2]}` | 400 | **Invalid operand count** — `sqrt requires 1 operand, got 2` [application/problem+json] | ✓ |
| 50 | range before div zero | POST /api/v1/calculate `{"operation":"divide","operands":[1e999999999,0]}` | 400 | **Operand out of range** — `operands[0] absolute value must be less than 10^15` [application/problem+json] | ✓ |
| 51 | division by zero | POST /api/v1/calculate `{"operation":"divide","operands":[5,0]}` | 400 | **Division by zero** — `division by zero` [application/problem+json] | ✓ |
| 52 | sqrt negative | POST /api/v1/calculate `{"operation":"sqrt","operands":[-4]}` | 400 | **Invalid operand** — `operands[0] must not be negative` [application/problem+json] | ✓ |
| 53 | power non-integer before range | POST /api/v1/calculate `{"operation":"power","operands":[2,1000.5]}` | 400 | **Invalid operand** — `operands[1] must be an integer` [application/problem+json] | ✓ |
| 54 | power exponent > 1000 | POST /api/v1/calculate `{"operation":"power","operands":[2,1001]}` | 400 | **Operand out of range** — `operands[1] must be between -1000 and 1000` [application/problem+json] | ✓ |
| 55 | power 10^100 exact check | POST /api/v1/calculate `{"operation":"power","operands":[10,100]}` | 400 | **Result out of range** — `result would exceed 100 integer digits` [application/problem+json] | ✓ |
| 56 | power -10^101 (L=101 computed) | POST /api/v1/calculate `{"operation":"power","operands":[-10,101]}` | 400 | **Result out of range** — `result would exceed 100 integer digits` [application/problem+json] | ✓ |
| 57 | power estimate too large | POST /api/v1/calculate `{"operation":"power","operands":[999999999999999,1000]}` | 400 | **Result out of range** — `result would exceed 100 integer digits` [application/problem+json] | ✓ |
| 58 | power 0^-1 division by zero | POST /api/v1/calculate `{"operation":"power","operands":[0,-1]}` | 400 | **Division by zero** — `division by zero` [application/problem+json] | ✓ |
| 59 | malformed string operand | POST /api/v1/calculate `{"operation":"add","operands":["1",2]}` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 60 | malformed unknown field | POST /api/v1/calculate `{"operation":"add","operands":[1,2],"foo":1}` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 61 | malformed broken json | POST /api/v1/calculate `{"operation":"add","operands":[1,2` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 62 | malformed empty body | POST /api/v1/calculate (empty) | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 63 | malformed trailing tokens | POST /api/v1/calculate `{"operation":"add","operands":[1,2]}{}` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 64 | malformed leading zero | POST /api/v1/calculate `{"operation":"add","operands":[01,2]}` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 65 | malformed both missing (sorted, joined) | POST /api/v1/calculate `{}` | 400 | **Malformed request** — `operands must not be null; operation must not be null` [application/problem+json] | ✓ |
| 66 | malformed null operand beats unknown op | POST /api/v1/calculate `{"operation":"nope","operands":[null]}` | 400 | **Malformed request** — `operands[0] must not be null` [application/problem+json] | ✓ |
| 67 | malformed nulls sorted lexicographically | POST /api/v1/calculate `{"operation":"add","operands":[1,1,null,1,1,1,1,1,1,1,null]}` | 400 | **Malformed request** — `operands[10] must not be null; operands[2] must not be null` [application/problem+json] | ✓ |
| 68 | duplicate key last wins | POST /api/v1/calculate `{"operation":"subtract","operation":"add","operands":[1,2]}` | 200 | result `3` [application/json] | ✓ |
| 69 | empty-string operand coerced to null | POST /api/v1/calculate `{"operation":"add","operands":["",1]}` | 400 | **Malformed request** — `operands[0] must not be null` [application/problem+json] | ✓ |
| 70 | case-variant key is unknown | POST /api/v1/calculate `{"Operation":"add","operands":[1,2]}` | 400 | **Malformed request** — `Request body is not valid JSON or does not match the expected shape` [application/problem+json] | ✓ |
| 71 | BOM accepted | POST /api/v1/calculate `<BOM>{"operation":"add","operands":[1,2]}` | 200 | result `3` [application/json] | ✓ |
| 72 | 415 text/plain | POST /api/v1/calculate `{"Content-Type": "text/plain"}` `{"operation":"add","operands":[1,2]}` | 415 | **Unsupported Media Type** — `Content-Type 'text/plain' is not supported.` [application/problem+json] | ✓ |
| 73 | 415 missing content-type | POST /api/v1/calculate `{}` `{"operation":"add","operands":[1,2]}` | 415 | **Unsupported Media Type** — `Content-Type 'null' is not supported.` [application/problem+json] | ✓ |
| 74 | charset param accepted | POST /api/v1/calculate `{"Content-Type": "application/json;charset=UTF-8"}` `{"operation":"add","operands":[1,2]}` | 200 | result `3` [application/json] | ✓ |
| 75 | 406 accept text/plain | POST /api/v1/calculate `{"Content-Type": "application/json", "Accept": "text/plain"}` `{"operation":"add","operands":[1,2]}` | 406 | **Not Acceptable** — `Acceptable representations: [application/json].` [application/problem+json] | ✓ |
| 76 | 406 accept problem+json | POST /api/v1/calculate `{"Content-Type": "application/json", "Accept": "application/problem+json"}` `{"operation":"divide","operands":[1,0]}` | 406 | **Not Acceptable** — `Acceptable representations: [application/json].` [application/problem+json] | ✓ |
| 77 | 405 GET | GET /api/v1/calculate `{}` | 405 | **Method Not Allowed** — `Method 'GET' is not supported.` (Allow: POST) [application/problem+json] | ✓ |
| 78 | 404 trailing slash | POST /api/v1/calculate/ `{"operation":"add","operands":[1,2]}` | 404 | **Not Found** — `No static resource api/v1/calculate.` [application/problem+json] | ✓ |
| 79 | query string ignored | POST /api/v1/calculate?operation=subtract `{"operation":"add","operands":[1,2]}` | 200 | result `3` [application/json] | ✓ |
| 80 | health | GET /actuator/health `{}` | 200 | `{"groups": ["liveness", "readiness"], "status": "UP"}` [application/vnd.spring-boot.actuator.v3+json] | ✓ |

---

## 8. Ambiguities and inconsistencies in the Java API (reported, not fixed)

1. **The constant `Malformed request` detail is not constant.**
   - Null and missing fields list the field names.
   - Empty or blank string operands become `operands[i] must not be null`, because `JacksonConfig.java:21-26` configures `String` and `Boolean` coercion to `Fail` but not `EmptyString`.
   - `"1"` gets the constant detail, so two string operands receive different details.
   - The spec says a string operand is `Malformed request`: the title matches, the detail does not.
2. **The sort is lexicographic, not by index** (`ProblemDetailHandler.java:56`): `operands[10] must not be null; operands[2] must not be null`.
3. **Null checks come before the operation check.** An unknown operation with a null operand is `Malformed`. This fits the spec ("shape first"), but means Bean Validation is part of the shape step.
4. **The documented `Internal error` 500 cannot be reached over HTTP**, as far as I could find. Meanwhile **a different 500 can be reached**: `Accept: application/json;charset=ISO-8859-1` (or `charset=UTF-16`) gives `title: "Internal Server Error"`, `detail: "Failed to write request"`. Nothing is logged at ERROR. The frontend treats both as "Service unavailable".
5. **`Accept: application/problem+json` returns 406 even when the response would be an error.** A client that asks for exactly what the API returns on errors gets 406. Error bodies are always problem+json, even under `Accept: application/json`.
6. **Accept parameters leak into the success `Content-Type`** (`application/json;foo=bar`).
7. **`Accept: garbage` returns 406 with an empty body**, the only non-2xx response without a ProblemDetail.
8. **A missing Content-Type is reported as `Content-Type 'null' is not supported.`** (Java's `null`). An unparseable charset gives `Could not parse Content-Type.`
9. **Request charset handling is generous**: Latin-1 is honored, UTF-16 is auto-detected and the BOM is skipped. Invalid UTF-8 is still rejected.
10. **Truncation splits surrogate pairs** (it counts UTF-16 code units), which can put a lone `\uD83D` into the JSON output. The echoed code is otherwise unsanitized: control characters, NUL, U+2028 and HTML characters pass through.
11. **Two different texts for an exponent out of range**: `operands[1] must be between -1000 and 1000` when |e| < 10^15, and `operands[1] absolute value must be less than 10^15` when |e| ≥ 10^15, because the generic check runs first.
12. **The number-length limit depends on the literal, not the value.**
    - `"0." + 999 zeros` is a valid 0, while `"0." + 1000 zeros` is Malformed.
    - `1e-2147483647` is `Operand out of range`, while `1e-2147483648` is Malformed.
    - `0.1e2147483648` is accepted (its exponent is beyond int32), while `1e2147483648` is not.
    - ADR-002 describes this as "literals of more than 1000 characters"; it is actually 1000 *digits*.
13. **`instance` reflects the raw URI** (percent-encoding and matrix parameters), and matrix parameters such as `;jsessionid=1` still route. A trailing slash gives 404 whose detail (`No static resource …`) exposes internal wording.
14. **The OpenAPI document** declares only 200 and 400 for `/api/v1/calculate`; 405, 406 and 415 are not listed.
    - Its `ProblemDetail` schema lists `type` and `properties`, but neither is ever emitted.
    - `CalculationResponse` has no `required` list.
    - `servers[0].url` depends on the `Host` header.
15. **The CORS preflight** (`OPTIONS` with `Origin`) answers 200 with `Allow: GET, HEAD, POST, PUT, DELETE, OPTIONS, PATCH`, listing methods that actually return 405. A plain `OPTIONS` says `POST,OPTIONS`.
16. **The `/error` endpoint can be called directly** and returns `{"timestamp":…,"status":999,"error":"None"}` with HTTP 500.
17. **No request-size limit.** A 5 MB body is parsed in full and 200,000 operands are counted. If a Go port adds `http.MaxBytesReader` or a similar limit, behavior will differ for large bodies; that would need its own decision.
18. **The spec's "Rules of result" claims** (`-0` impossible, `0` for zero) hold, but only because BigDecimal has no negative zero. Go decimal or float libraries can print `-0`. Cases: `divide [-1,2e10]`, `power [-0.5, 35]`, `multiply [-2.5,0]`.
