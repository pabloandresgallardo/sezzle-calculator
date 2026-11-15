# Operaciones básicas — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development`. Los pasos usan checkboxes (`- [ ]`).

Fecha: 2026-11-15
Jira/HDU: Not provided

**Objetivo:** `add`, `subtract`, `multiply` y `divide` funcionando de punta a punta: calculadora React → `POST /api/v1/calculate` → dominio hexagonal con BigDecimal. Con TDD, cobertura ≥ 90% y E2E en verde.

**Arquitectura:** Backend hexagonal con estas piezas:
- `Operation` (enum con comportamiento) y `Operand` (record con invariantes) en `domain`;
- `CalculatorService` detrás del puerto `CalculateUseCase`;
- controller, `ProblemDetailHandler` y configuración estricta de Jackson en el adapter web.

Frontend con un reducer puro (la máquina de estados), un hook que lo conecta con la API y el teclado físico, y componentes atómicos presentacionales.

**Stack:** Java 21 (compilado con JDK 23 y `--release 21`), Spring Boot 4.1.2, Jackson 3.1.7, Lombok 1.18.48, springdoc 3.2.0, JUnit 5. React 19.3, TypeScript 6.0.3, Vitest 5.1, Testing Library 16, MSW 3. Playwright 1.65.

**Spec:** `.ai/docs/specs/2026-11-15-basic-operations.md`. Leelo antes de cada tarea: las tablas de contrato, de eventos y de ejemplos son la fuente de verdad.

## Restricciones globales

- **Rama** `feat/basic-operations`.
  - **No hacer commits ni push**: el usuario aprueba un único commit al final.
  - No tocar ramas.
- **Node 22:** los comandos de npm/npx se corren con el prefijo `fnm exec --using=22`.
- **Paquete raíz Java** `com.sezzle.calculator`.
  - El dominio (`domain.*`) no importa `org.springframework.*` ni Lombok.
- **Lombok** solo en beans de Spring. No usar MapStruct. Records para DTOs, comandos y value objects.
- **Límites de operando:** ≤ 15 dígitos significativos, |x| < 10^15 y ≤ 10 decimales (medidos tras `stripTrailingZeros()`).
- **División:** `divide(b, 10, RoundingMode.HALF_EVEN)`.
- **Resultado:** `stripTrailingZeros().toPlainString()`.
- **`title` contractuales, exactos:**
  - `Division by zero`
  - `Unsupported operation`
  - `Invalid operand count`
  - `Operand out of range`
  - `Malformed request`
  - `Internal error`
- **Orden de validación:** forma → operación → cantidad → límites (por índice) → cálculo.
- **Contrato estricto:** la operación va en minúsculas exactas; un campo desconocido → `Malformed request`; no se convierten tipos (string → número ni número → string).
- **Mensajes de UI, exactos:**
  - `Cannot divide by zero`
  - `Number out of range`
  - `Invalid request`
  - `Service unavailable`
  - `Invalid number`
  - `Too many digits`
  - `Result too long to continue`
- **`aria-label` de los botones, exactos:** `0`–`9`, `decimal point`, `add`, `subtract`, `multiply`, `divide`, `equals`, `clear`, `backspace`, `plus/minus`.
- **Puertos:** ningún test usa puertos fijos.
- **Formato:** `make lint` tiene que pasar; Spotless con Palantir se aplica con `make format`.

## Foco de revisión

Entradas que la spec implica pero que es fácil dejar sin test. Cada una tiene su test asignado en la tarea que corresponde.

1. **Doble `=` o teclas repetidas mientras hay un request en curso.** Tiene que salir un solo request. Test: F1 (`ignores input while pending`) y F3 (`sends one request on double equals`).
2. **Operador como primera tecla** (`+ 5 =`). Usa `0` como primer operando y da `5`. Test: F1 `operator on fresh state uses zero`.
3. **Operando que termina en punto** (`5. + 1 =`). Se envía como `5` y da `6`. Test: F2 `serializes trailing-dot operands as numbers`.
4. **Respuesta que no es JSON** (502 HTML de nginx con el backend caído). Debe mostrar `Service unavailable`, sin excepción sin capturar. Test: F2 `maps non-JSON 502 to null title`.
5. **± sobre `0.`**: no hace nada (cero numérico), el display no muestra `-0.`. Test: F1 `toggleSign on numeric zero is a no-op`.

## Ejecución

- Tracks **B** (backend) y **F** (frontend) sin dependencias entre sí. El contrato ya está fijo y tocan directorios distintos, así que pueden ir en paralelo en el mismo working tree.
- **E1** espera a B4 y F3.
- Cada tarea: test en rojo → implementación mínima → verde → revisor.

---

### Task B1: Dominio — `Operand`, `Operation`, `CalculationResult`, excepciones

**Archivos:**
- Crear en `backend/src/main/java/com/sezzle/calculator/domain/model/`: `Operand.java`, `Operation.java`, `CalculationResult.java`.
- Crear en `domain/exception/`:
  - `CalculationException.java` (abstracta, `extends RuntimeException`)
  - `DivisionByZeroException.java`
  - `UnsupportedCalculationException.java`
  - `InvalidOperandCountException.java`
  - `OperandOutOfRangeException.java`
- Tests en `backend/src/test/java/com/sezzle/calculator/domain/model/`: `OperandTest.java`, `OperationTest.java`, `CalculationResultTest.java`.
- Borrar los `.gitkeep` de `domain/model` y `domain/exception`.

**Interfaces producidas:**
- `record Operand(BigDecimal value)`:
  - el constructor compacto valida y lanza `OperandOutOfRangeException(String reason)`;
  - `reason` es uno de `"absolute value must be less than 10^15"`, `"has more than 15 significant digits"` o `"has more than 10 decimal places"`, chequeados **en ese orden** (la magnitud primero, porque es barata ante exponentes enormes).
- `OperandOutOfRangeException`:
  - `OperandOutOfRangeException withIndex(int index)` devuelve una excepción nueva cuyo `getMessage()` es `"operands[" + index + "] " + reason`.
- `enum Operation { ADD("add"), SUBTRACT("subtract"), MULTIPLY("multiply"), DIVIDE("divide") }`:
  - `String code()`;
  - `int arity()` (2 en las cuatro);
  - `static Operation fromCode(String code)`: coincidencia exacta y sensible a mayúsculas; si no, `UnsupportedCalculationException(code)`;
  - `BigDecimal apply(Operand left, Operand right)`; `DIVIDE` con divisor cero lanza `DivisionByZeroException`.
- `InvalidOperandCountException(Operation operation, int expected, int actual)`.
- `record CalculationResult(Operation operation, BigDecimal value)` con `String formatted()`.

- [ ] **Paso 1: Tests en rojo.**
  - `OperandTest`, parametrizado:
    - aceptados: `0`, `-0`, `999999999999999`, `-999999999999999`, `0.0000000001`, `12345.6789012345`, `1.50000000000000000` (normaliza a 2 dígitos), `1E+14`;
    - rechazados con su reason: `1000000000000000` → magnitud; `1E+999999999` → magnitud; `1234567890.12345678` (18 dígitos significativos, |x| < 10^15) → dígitos; `0.12345678901` → decimales; `1E-999999999` → decimales;
    - `withIndex(1).getMessage()` es `"operands[1] has more than 10 decimal places"`.
  - `OperationTest`, con la tabla de ejemplos de la spec:
    - `ADD 0.1 0.2` → `0.3`;
    - `SUBTRACT 5 8` → `-3`;
    - `MULTIPLY 999999999999999 999999999999999` → `999999999999998000000000000001`;
    - `MULTIPLY -2.5 0` → formatted `"0"`;
    - `DIVIDE 6 3` → `"2"`; `1 3` → `"0.3333333333"`; `2 3` → `"0.6666666667"`; `1 8` → `"0.125"`; `0.0000000001 3` → `"0"`; `5 0` → `DivisionByZeroException`;
    - `fromCode`: `"add"` → `ADD`; `"ADD"`, `"power"`, `""` y `null` → `UnsupportedCalculationException`.
  - `CalculationResultTest`: `formatted()` sobre `1E+30` da `"1000000000000000000000000000000"` (sin notación científica), y sobre `0.000` da `"0"`.
- [ ] **Paso 2:** `cd backend && mvn -B -q test -Dtest='OperandTest,OperationTest,CalculationResultTest'`. Esperado: FAIL de compilación (no existen las clases).
- [ ] **Paso 3:** Implementar las interfaces de arriba. Java puro, sin dependencias.
- [ ] **Paso 4:** El mismo comando. Esperado: `BUILD SUCCESS`, 0 fallos.

### Task B2: Aplicación — `CalculateUseCase`, `CalculateCommand`, `CalculatorService`

**Archivos:**
- Crear en `backend/src/main/java/com/sezzle/calculator/application/`:
  - `port/in/CalculateUseCase.java`
  - `port/in/CalculateCommand.java`
  - `service/CalculatorService.java`
- Test: `backend/src/test/java/com/sezzle/calculator/application/service/CalculatorServiceTest.java`
- Borrar los `.gitkeep` de `port/in` y `service`.

**Interfaces:**
- Consume: todo lo de B1.
- Produce:
  - `interface CalculateUseCase { CalculationResult calculate(CalculateCommand command); }`
  - `record CalculateCommand(String operation, List<BigDecimal> operands)`
  - `@Service class CalculatorService implements CalculateUseCase`

`CalculatorService.calculate` aplica el **orden de validación**:
1. `Operation.fromCode(operation)`;
2. `operands.size() != operation.arity()` → `InvalidOperandCountException`;
3. construye cada `Operand` por índice; si falla, relanza con `withIndex(i)`;
4. ejecuta `apply`.

- [ ] **Paso 1: Tests en rojo** en `CalculatorServiceTest`, sin Spring (`new CalculatorService()`):
  - `add [0.1, 0.2]` → `formatted()` es `"0.3"`;
  - `power [1,2,3]` → `UnsupportedCalculationException`;
  - `add [1,2,3]` → `InvalidOperandCountException`;
  - `add [1]` → `InvalidOperandCountException`;
  - `divide [1E+999999999, 0]` → `OperandOutOfRangeException` con mensaje que empieza en `"operands[0] "`;
  - `add [1, 0.12345678901]` → mensaje que empieza en `"operands[1] "`;
  - `divide [5, 0]` → `DivisionByZeroException`.
- [ ] **Paso 2:** `mvn -B -q test -Dtest=CalculatorServiceTest`. Esperado: FAIL de compilación.
- [ ] **Paso 3:** Implementar.
- [ ] **Paso 4:** El mismo comando. Esperado: PASS.

### Task B3: Adapter web — controller, ProblemDetail, Jackson estricto, Lombok, OpenAPI

**Archivos:**
- Modificar `backend/pom.xml`:
  - agregar `org.projectlombok:lombok` (`<optional>true</optional>`, versión gestionada por Boot);
  - en `maven-compiler-plugin`, declarar `<annotationProcessorPaths>` con lombok `${lombok.version}`. Es obligatorio: JDK 23 ya no descubre solo los processors.
- Crear `backend/lombok.config` con:
  ```
  config.stopBubbling = true
  lombok.addLombokGeneratedAnnotation = true
  ```
- Crear en `adapter/in/web/`:
  - `CalculatorController.java`
  - `CalculationRequest.java`
  - `CalculationResponse.java`
  - `ProblemDetailHandler.java`
- Crear `config/JacksonConfig.java`.
- Test: `backend/src/test/java/com/sezzle/calculator/adapter/in/web/CalculatorControllerTest.java` (`@WebMvcTest(CalculatorController.class)`, con `CalculatorService` real vía `@Import`, sin mocks: el dominio es puro y rápido).
- Borrar los `.gitkeep` de `adapter/in/web` y `config`.

**Interfaces:**
- Consume: `CalculateUseCase` y `CalculateCommand` (B2), y las excepciones de B1.
- Produce:
  - `record CalculationRequest(@NotNull String operation, @NotNull List<@NotNull BigDecimal> operands)`
  - `record CalculationResponse(String operation, String result)`
  - `POST /api/v1/calculate`, `consumes` y `produces` `application/json`
  - errores `application/problem+json`
- `CalculatorController`: `@RestController` + `@RequiredArgsConstructor`, con un campo `private final CalculateUseCase calculateUseCase`.
- `ProblemDetailHandler`: `@RestControllerAdvice extends ResponseEntityExceptionHandler`.
  - Sobrescribe `handleHttpMessageNotReadable` y `handleMethodArgumentNotValid` → 400 `Malformed request`.
  - Tiene `@ExceptionHandler` por cada excepción de dominio → 400 con su `title` y `detail = getMessage()`.
  - Un `@ExceptionHandler(Exception.class)` → 500 `Internal error`, con un `detail` genérico y sin stack trace.
  - El 415 queda con el comportamiento heredado.
- `JacksonConfig` (Jackson 3, paquete `tools.jackson.databind`), con un bean `JsonMapperBuilderCustomizer` que:
  - activa `FAIL_ON_UNKNOWN_PROPERTIES`;
  - configura la conversión de tipos como `CoercionAction.Fail` desde `String` y `Boolean` hacia números (`LogicalType.Float` e `Integer`), y desde `Integer`, `Float` y `Boolean` hacia `LogicalType.Textual`.
- springdoc:
  - `@Tag(name = "Calculator")` y `@Operation(summary = "Perform an arithmetic operation")`;
  - `@ApiResponse` 200 (schema `CalculationResponse`) y 400 (`application/problem+json`, schema `ProblemDetail`);
  - un `@ExampleObject` de request `{"operation":"divide","operands":[1,3]}`.

- [ ] **Paso 1: Tests en rojo** en `CalculatorControllerTest`, uno por fila. Cada uno verifica el status, el `Content-Type` y `$.title` exacto (o `$.operation` y `$.result`):
  - `{"operation":"add","operands":[0.1,0.2]}` → 200, `$.operation` `"add"`, `$.result` `"0.3"`;
  - `divide [1,3]` → 200, `"0.3333333333"`;
  - `divide [5,0]` → 400 `Division by zero`;
  - `power [2,3]` → `Unsupported operation`;
  - `ADD [1,2]` → `Unsupported operation`;
  - `add [1,2,3]` → `Invalid operand count`;
  - `add [1e999999999, 0.1]` → `Operand out of range`, `$.detail` empieza en `"operands[0] "`;
  - `add [1234567890123456,1]` → `Operand out of range`;
  - `divide [1e999999999, 0]` → `Operand out of range` (orden de validación);
  - `add ["1",2]` → `Malformed request`;
  - `{"operation":5,"operands":[1,2]}` → `Malformed request`;
  - `{"operation":"add","operands":[1,2],"foo":1}` → `Malformed request`;
  - `{"operation":"add","operands":[1,null]}` → `Malformed request`;
  - `{"operands":[1,2]}` → `Malformed request`;
  - `{not json` → `Malformed request`;
  - `add [true,2]` → `Malformed request`;
  - body válido con `Content-Type: text/plain` → 415.
- [ ] **Paso 2:** `mvn -B -q test -Dtest=CalculatorControllerTest`. Esperado: FAIL.
- [ ] **Paso 3:** Implementar, en el orden pom → `lombok.config` → DTOs → controller → handler → `JacksonConfig`.
- [ ] **Paso 4:** El mismo comando. Esperado: PASS. Después correr `mvn -B -q test`: suite completa en verde.

### Task B4: Integración — flujo HTTP real, OpenAPI y gate de cobertura

**Archivos:**
- Test: `backend/src/test/java/com/sezzle/calculator/CalculatorApiIT.java`
- Borrar `backend/src/test/java/com/sezzle/calculator/.gitkeep`.

**Interfaces:**
- Consume: el endpoint de B3.
- `@SpringBootTest(webEnvironment = RANDOM_PORT)`. El cliente HTTP queda a criterio del builder; `RestTestClient` con `@AutoConfigureRestTestClient` es lo de Boot 4.

- [ ] **Paso 1: Tests en rojo:**
  - `add [0.1,0.2]` → 200 `"0.3"`;
  - `divide [5,0]` → 400 `Division by zero` con `Content-Type: application/problem+json`;
  - `add [1e999999999,0.1]` → 400 `Operand out of range`;
  - `GET /v3/api-docs` → 200 y el body contiene `"/api/v1/calculate"`;
  - `GET /actuator/health` → 200 `{"status":"UP"}`.
- [ ] **Paso 2:** `cd backend && mvn -B verify`. Si B3 ya está hecho, los tests pasan directo. Para confirmar el rojo, correrlos una vez apuntando a un path inexistente y verificar que fallan; después dejarlos con el path correcto.
- [ ] **Paso 3:** `mvn -B verify`. Esperado:
  - `BUILD SUCCESS`;
  - failsafe con 5 tests;
  - `jacoco:check` "All coverage checks have been met";
  - `spotless:check` OK. Si falla, correr `mvn -B spotless:apply` y repetir.

---

### Task F1: Modelo — tipos, límites, mensajes y reducer

**Archivos:**
- Crear en `frontend/src/features/calculator/model/`:
  - `types.ts`
  - `limits.ts`
  - `errorMessages.ts`
  - `calculatorReducer.ts`
- Tests: `limits.test.ts`, `errorMessages.test.ts` y `calculatorReducer.test.ts`, en la misma carpeta.

**Interfaces producidas:**
- `types.ts`: `export type Operation = 'add' | 'subtract' | 'multiply' | 'divide'`.
- `limits.ts`:
  - `MAX_SIGNIFICANT_DIGITS = 15` y `MAX_DECIMALS = 10`;
  - `canAppendDigit(current: string): boolean`: cuenta los decimales tal cual se tipearon; los dígitos significativos ignoran signo y ceros a la izquierda;
  - `isWithinLimits(value: string): boolean`: semántica igual al backend, con normalización de ceros finales y |x| < 10^15;
  - `parsePastedNumber(text: string): { ok: true; value: string } | { ok: false; reason: 'invalid' | 'tooLong' }`: hace `trim`, convierte `,` en `.` y valida con `^-?(\d+\.?\d*|\.\d+)$`.
- `errorMessages.ts`:
  - `messageForApiTitle(title: string | null): string`;
  - `CLIENT_ERRORS = { invalidNumber: 'Invalid number', tooManyDigits: 'Too many digits', resultTooLong: 'Result too long to continue' } as const`.
- `calculatorReducer.ts`:
  - `CalculatorState`:
    ```
    { previous: string | null; operator: Operation | null; current: string;
      phase: 'input' | 'awaitingOperand' | 'result' | 'pending';
      error: string | null; pendingOperator: Operation | null;
      request: { operation: Operation; operands: [string, string] } | null }
    ```
  - `CalculatorAction`:
    ```
    { type: 'digit'; digit: string } | { type: 'decimal' } | { type: 'toggleSign' }
    | { type: 'backspace' } | { type: 'clear' } | { type: 'operator'; operator: Operation }
    | { type: 'equals' } | { type: 'paste'; text: string }
    | { type: 'resolved'; result: string } | { type: 'rejected'; message: string }
    ```
  - `initialState`: `current` `'0'`, `phase` `'input'` y el resto en `null`.
  - `calculatorReducer(state, action): CalculatorState`.
  - Pedir un cálculo es setear `phase: 'pending'` y `request`; `resolved` o `rejected` limpian `request`.
  - En `awaitingOperand`, `current` es `''`.

- [ ] **Paso 1: Tests en rojo.** Uno por fila de la tabla de eventos de la spec, más:
  - `limits`:
    - `canAppendDigit('999999999999999')` → false;
    - `canAppendDigit('1.0000000000')` → false;
    - `canAppendDigit('-0.5')` → true;
    - `isWithinLimits('17636684.1428571429')` → false;
    - `isWithinLimits('1000000000000000')` → false;
    - `isWithinLimits('1.50')` → true;
    - `parsePastedNumber('1..2')` → invalid;
    - `parsePastedNumber(' 3,5 ')` → `{ ok: true, value: '3.5' }`;
    - `parsePastedNumber('1e5')` → invalid;
    - `parsePastedNumber('1234567890123456')` → tooLong.
  - `errorMessages`: cada `title` contractual da su mensaje exacto; `null` y `'Internal error'` → `'Service unavailable'`; un title desconocido → `'Invalid request'`.
  - Reducer, nombres que tienen que existir:
    - `chains on second operator`: `2 + 3 ×` → request `add ['2','3']` con `pendingOperator: 'multiply'`; `resolved('5')` → `previous '5'`, `operator 'multiply'`, `phase 'awaitingOperand'`;
    - `operator replaces operator when no second operand`;
    - `digit after result starts new calculation`;
    - `operator after result continues with result`;
    - `operator after oversized result sets resultTooLong`;
    - `resolved with pendingOperator and oversized result drops operator` (`phase 'result'`, `error` `'Result too long to continue'`, `pendingOperator null`);
    - `ignores input while pending except clear`;
    - `rejected keeps operands for retry`;
    - `any key clears error before applying`;
    - `operator on fresh state uses zero` (`+` → `previous '0'`);
    - `toggleSign on numeric zero is a no-op` (`'0.'` sigue igual);
    - `backspace on '-5' yields '0'`;
    - `paste invalid keeps state and sets invalidNumber`;
    - `paste on result starts new calculation`;
    - `equals without second operand is a no-op`.
- [ ] **Paso 2:** `cd frontend && fnm exec --using=22 npx vitest run src/features/calculator/model`. Esperado: FAIL (no existen los módulos).
- [ ] **Paso 3:** Implementar. El reducer es una función pura, sin efectos ni `fetch`.
- [ ] **Paso 4:** El mismo comando. Esperado: PASS.

### Task F2: Cliente API

**Archivos:**
- Crear:
  - `frontend/src/features/calculator/api/calculatorApi.ts`
  - `frontend/src/test/msw/server.ts` (`setupServer` sin handlers por defecto)
- Modificar `frontend/src/test/setup.ts`: `server.listen({ onUnhandledRequest: 'error' })`, `resetHandlers` después de cada test y `close` al final.
- Test: `frontend/src/features/calculator/api/calculatorApi.test.ts`

**Interfaces:**
- Consume: `Operation` (F1).
- Produce:
  - `class CalculatorApiError extends Error { readonly title: string | null }`
  - `calculate(operation: Operation, operands: [string, string], signal?: AbortSignal): Promise<string>`
- Comportamiento:
  - `POST /api/v1/calculate` con `{ operation, operands: operands.map(Number) }`;
  - un 200 devuelve `result`;
  - un 4xx con un body ProblemDetail parseable lanza un error con su `title`;
  - cualquier otra cosa (red, 5xx, body que no es JSON) lanza un error con `title: null`;
  - `AbortError` se propaga tal cual.

- [ ] **Paso 1: Tests en rojo** con MSW:
  - `posts operation and numeric operands`: el body recibido es `{"operation":"add","operands":[0.1,0.2]}`;
  - `serializes trailing-dot operands as numbers`: `['5.','1']` → `[5,1]`;
  - `returns result string`;
  - `throws title from problem detail` (`Division by zero`);
  - `maps non-JSON 502 to null title`;
  - `maps network error to null title` (`HttpResponse.error()`);
  - `propagates abort`.
- [ ] **Paso 2:** `fnm exec --using=22 npx vitest run src/features/calculator/api`. Esperado: FAIL.
- [ ] **Paso 3:** Implementar.
- [ ] **Paso 4:** El mismo comando. Esperado: PASS.

### Task F3: UI — hook, atoms, molecules, organism y App

**Archivos:**
- Crear en `frontend/src/features/calculator/`:
  - `hooks/useCalculator.ts`
  - `atoms/CalcButton.tsx` + `.module.css`
  - `atoms/Display.tsx` + `.module.css`
  - `molecules/Keypad.tsx` + `.module.css`
  - `molecules/DisplayPanel.tsx` + `.module.css`
  - `organisms/CalculatorPanel.tsx` + `.module.css`
- Crear en `frontend/src/app/`: `App.tsx` y `global.css` (reset, `box-sizing`, fondo).
- Modificar `frontend/src/main.tsx`: renderizar `<App />` e importar `global.css`.
- Tests:
  - `atoms/CalcButton.test.tsx`
  - `molecules/Keypad.test.tsx`
  - `organisms/CalculatorPanel.test.tsx` (con MSW)
  - `src/app/App.test.tsx`
- Borrar los `.gitkeep` de `atoms`, `molecules` y `organisms`.

**Interfaces:**
- Consume: F1 y F2.
- Produce:
  - `useCalculator(): { state: CalculatorState; dispatch: Dispatch<CalculatorAction>; expression: string; display: string }`:
    - cuando cambia `state.request`, llama a `calculate` con un `AbortController`, que se aborta con `clear` o al desmontar;
    - despacha `resolved` o `rejected` (con `messageForApiTitle(error.title)`); ignora `AbortError`;
    - registra `keydown` (`0-9`, `.`, `,`, `+`, `-`, `*`, `/`, `Enter`, `=`, `Escape`, `Backspace`, `F9`) y `paste` en `window`.
  - `CalcButton({ label, ariaLabel, onPress, variant: 'digit' | 'operator' | 'action' | 'equals', wide?, disabled? })`
  - `Display({ text, size: 'small' | 'large' })`: achica la fuente si el texto es largo y después usa `overflow-x: auto`.
  - `DisplayPanel({ expression, value, error, pending })`: `role="status"`, `aria-live="polite"`.
  - `Keypad({ onAction: (a: CalculatorAction) => void, disabled })`: grilla 4×5 de la spec, con `0` en `grid-column: span 2`.
  - `CalculatorPanel()`.
  - `App()`.
- Responsive: el layout es usable a 360 px de ancho, sin scroll horizontal de la página. Botones de al menos 44 px de alto.

- [ ] **Paso 1: Tests en rojo:**
  - `CalcButton`: `calls onPress`; `exposes aria-label`.
  - `Keypad`: los 19 botones existen por `getByRole('button', { name })` con los labels exactos; `divide` emite `{ type: 'operator', operator: 'divide' }`; `disabled` deshabilita todo menos `clear`.
  - `CalculatorPanel` (con `userEvent` y MSW):
    - `computes 6 ÷ 3 = 2`;
    - `chains 2 + 3 × 4 = 20` (dos requests);
    - `shows Cannot divide by zero and recovers on next digit`;
    - `shows Service unavailable on network error and retries with equals`;
    - `supports physical keyboard` (`6/3{Enter}` → `2`; `{Escape}` → `0`; `F9` niega);
    - `rejects invalid paste with Invalid number` (`fireEvent.paste` con `clipboardData` `'1..2'`);
    - `sends one request on double equals`.
  - `App`: `renders calculator`.
- [ ] **Paso 2:** `fnm exec --using=22 npx vitest run src/features src/app`. Esperado: FAIL.
- [ ] **Paso 3:** Implementar en el orden hook → atoms → molecules → organism → App → `main.tsx`.
- [ ] **Paso 4:** `cd frontend && fnm exec --using=22 npm run lint && fnm exec --using=22 npm run test:coverage && fnm exec --using=22 npm run build`. Esperado: lint OK, cobertura ≥ 90% en las 4 métricas y build OK.

---

### Task E1: E2E Playwright — UI y contrato API contra el stack real

**Archivos:**
- Crear en `e2e/tests/`:
  - `helpers.ts`: `press(page, ...labels: string[])` hace click por `aria-label`; `displayValue(page)` lee el valor del `role="status"`.
  - `ui-operations.spec.ts`
  - `ui-errors.spec.ts`
  - `ui-edge-cases.spec.ts`
  - `api-contract.spec.ts`
- Borrar `e2e/tests/.gitkeep`.

**Interfaces:**
- Consume: los `aria-label` y mensajes de las restricciones globales, y el contrato de B3.
- `api-contract.spec.ts` usa el fixture `request` y corre solo en el proyecto `chromium`: `test.skip(testInfo.project.name !== 'chromium')`.

- [ ] **Paso 1: Specs:**
  - **`ui-operations`:**
    - `7 + 5 = 12`, `9 − 12 = -3`, `2.5 × 4 = 10`, `6 ÷ 3 = 2`;
    - `0.1 + 0.2 = 0.3`;
    - `2 + 3 × 4 = 20`;
    - ± por botón y `F9`: `5 ± × 2 = -10`;
    - teclado físico `8*7{Enter}` → `56`.
  - **`ui-errors`:**
    - `6 ÷ 0 =` → `Cannot divide by zero`; después `3 =` → `2`;
    - pegar `abc` → `Invalid number` (`ClipboardEvent` sintético vía `page.evaluate` con `DataTransfer`).
  - **`ui-edge-cases`:**
    - `1 ÷ 3 =` → `0.3333333333`;
    - tipear 16 dígitos → el display muestra 15;
    - `123456789 ÷ 7 =` → `17636684.1428571429`, y después `+` → `Result too long to continue`;
    - en el proyecto `mobile`, y también con `page.setViewportSize({ width: 360, height: 740 })` porque Pixel 7 mide 412 px: `document.documentElement.scrollWidth <= window.innerWidth`, y los 19 botones visibles.
  - **`api-contract`**, con status y `title` exactos:
    - `add [1e999999999,0.1]` → `Operand out of range`;
    - `add ["1",2]` → `Malformed request`;
    - `add [1,2,3]` → `Invalid operand count`;
    - `power [2,3]` → `Unsupported operation`;
    - `ADD [1,2]` → `Unsupported operation`;
    - campo extra → `Malformed request`;
    - JSON roto → `Malformed request`;
    - `divide [1e999999999,0]` → `Operand out of range`;
    - `add [0.1,0.2]` → 200 `"0.3"`.
- [ ] **Paso 2:** `cd e2e && fnm exec --using=22 npx playwright install` (solo la primera vez). Después, desde la raíz, `fnm exec --using=22 make e2e`. Esperado: todas las specs en verde en `chromium`, `firefox`, `webkit` y `mobile`, y el stack se baja al terminar.
- [ ] **Paso 3:** Si algo falla por una diferencia de navegador (por ejemplo, la simulación de paste), el ajuste va en `helpers.ts`, nunca en el código de producción, salvo que sea un bug real.
