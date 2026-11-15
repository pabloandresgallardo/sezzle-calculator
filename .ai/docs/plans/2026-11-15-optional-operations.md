# Operaciones opcionales — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: `superpowers:subagent-driven-development`. Los pasos usan checkboxes (`- [ ]`).

Fecha: 2026-11-15
Jira/HDU: Not provided

**Objetivo:** `power`, `sqrt` y `percentage` funcionando de punta a punta, con teclado 4×6 de 22 botones visibles, TDD, cobertura ≥ 90% y E2E en verde.

**Arquitectura:** Se generaliza el Strategy con enum `Operation`:
- `apply(List<Operand>)`;
- `arity()`, que cada constante puede sobrescribir;
- un hook `validate(List<Operand>)`.

`CalculatorService` agrega el paso `validate` antes de `apply`. En el frontend, el reducer suma `unaryOperator` para `√` y reutiliza `operator` para `xʸ` y `%`.

**Stack:** igual que la iteración 1 (Java 21, Spring Boot 4.1.2, React 19.3, TS 6.0.3, Vitest 5, MSW 3, Playwright 1.65).

**Spec:** `.ai/docs/specs/2026-11-15-optional-operations.md`. Tiene la fuente de verdad: las tablas de contrato, orden de validación, ejemplos y eventos del reducer. Lo que no redefine sigue rigiendo según `.ai/docs/specs/2026-11-15-basic-operations.md`.

## Restricciones globales

- Rama `feat/optional-operations`. **No commitear ni pushear.** Sin operaciones git.
- Node 22: anteponer `fnm exec --using=22` a npm, npx y make.
- El dominio (`domain.*`) no importa Spring ni Lombok. Los records se mantienen.
- **`title` nuevos, exactos:** `Invalid operand` y `Result out of range`. Los 6 existentes no cambian.
- **Mensajes nuevos de la UI, exactos:** `Invalid input` y `Result too large`.
- **`aria-label` nuevos, exactos:** `power`, `square root` y `percent`. Los 19 existentes no cambian.
- **Teclas:**
  - `@` → sqrt;
  - `^` e `y` → power;
  - `%` → percentage.
  - Shift no bloquea; Ctrl, Meta y Alt siguen ignorándose.
- **Orden de validación:** forma → operación → aridad → límites genéricos por índice → `validate` por operación → cálculo.
- **Cota de `power`:**
  - Si `L = e·log10|base| > 101`, responde `Result out of range` sin calcular.
  - Si `L < −11`, responde `"0"` sin calcular.
  - Después de calcular, verificación exacta: más de 100 dígitos enteros → `Result out of range`.
- **Escalas:**
  - `sqrt`: `DECIMAL128` y después `setScale(10, HALF_EVEN)`.
  - `power` con exponente ≥ 0: exacto y después `setScale(10, HALF_EVEN)`.
  - `power` con exponente < 0: `ONE.divide(base.pow(-e), 10, HALF_EVEN)`.
  - `percentage`: `a·b` y `movePointLeft(2)`, exacto.
- Ningún test usa puertos fijos. `make lint` tiene que quedar en verde.

## Foco de revisión

1. **Teclas que requieren Shift** (`^`, `%`, `@` en layouts US y ES). Tienen que funcionar. Test en F2: `accepts shifted symbol keys`.
2. **`√` o `xʸ` mientras hay un request en curso.** Se ignoran y se envía un solo request. Tests en F1: `unaryOperator ignored while pending`; en F2: `sends one request on sqrt then equals while pending`.
3. **Encadenar después de `xʸ`** (`2 xʸ 3 × 2 =`). Da `16`. Test en F1: `chains power then multiply`; en F2: `computes 2 ^ 3 × 2 = 16`.
4. **`0 xʸ −1` desde la UI.** Muestra `Cannot divide by zero` y se recupera con un dígito. Test en F2: `shows Cannot divide by zero for 0 ^ -1`.
5. **`√` de un negativo armado con `±`** (`4 ± √`). Muestra `Invalid input`, el display sigue en `-4` y `C` resetea. Tests en F2 y en E1.

## Ejecución

- Track **B** (B1 → B2) y track **F** (F1 → F2) van en paralelo: tocan directorios distintos y el contrato está fijado en la spec.
- **E1** va después de B2 y F2.

---

### Task B1: Dominio — Strategy generalizado, operaciones nuevas y excepciones

**Archivos:**
- Modificar `backend/src/main/java/com/sezzle/calculator/domain/model/Operation.java`.
- Crear `backend/src/main/java/com/sezzle/calculator/domain/model/PowerBounds.java` (helper package-private con la estimación de `L` y la verificación exacta).
- Crear en `domain/exception/`: `InvalidOperandException.java` y `ResultOutOfRangeException.java`.
- Tests:
  - modificar `domain/model/OperationTest.java` (las llamadas pasan a `apply(List.of(...))`);
  - crear `domain/model/OptionalOperationsTest.java` y `domain/model/PowerBoundsTest.java`.

**Interfaces producidas:**
- `Operation`:
  - constantes nuevas `POWER("power")`, `SQRT("sqrt")` y `PERCENTAGE("percentage")`;
  - `public abstract BigDecimal apply(List<Operand> operands)`;
  - `public int arity()` (2; `SQRT` → 1);
  - `public void validate(List<Operand> operands)`, que no hace nada salvo en `SQRT` y `POWER`.
- `InvalidOperandException(int index, String reason)` → `getMessage()` = `"operands[" + index + "] " + reason`. Los `reason` son `"must not be negative"` y `"must be an integer"`.
- `ResultOutOfRangeException()` → `getMessage()` = `"result would exceed 100 integer digits"`.
- El exponente fuera de rango usa `new OperandOutOfRangeException("must be between -1000 and 1000").withIndex(1)`.
- `PowerBounds`:
  - `static Estimate estimate(BigDecimal base, int exponent)`, que devuelve `TOO_LARGE`, `ROUNDS_TO_ZERO` o `COMPUTE`;
  - `static void requireWithinIntegerDigits(BigDecimal result)`.

- [ ] **Paso 1: tests en rojo.**
  - `OptionalOperationsTest`: parametrizado con **cada fila de "Ejemplos" de la spec** que no dependa del HTTP, llamando `validate` + `apply` en ese orden igual que el servicio.
    - Los valores van literales, por ejemplo `sqrt 999999999999999` → `"31622776.6016837775"` y `power 10 99` → `"1"` seguido de 99 ceros.
    - Excepciones con su mensaje exacto: `sqrt -4` → `InvalidOperandException` `"operands[0] must not be negative"`; `power 2 0.5` y `power 2 1000.5` → `"operands[1] must be an integer"`; `power 2 1001` → `OperandOutOfRangeException` `"operands[1] must be between -1000 and 1000"`; `power 10 100` → `ResultOutOfRangeException`; `power 0 -1` → `DivisionByZeroException`.
    - `arity`: `SQRT.arity() == 1` y el resto `2`.
    - `fromCode("PERCENTAGE")` lanza `UnsupportedCalculationException`.
  - `PowerBoundsTest`:
    - `estimate(999999999999999, 1000) == TOO_LARGE`;
    - `estimate(0.5, -1000) == TOO_LARGE`;
    - `estimate(3, -1000) == ROUNDS_TO_ZERO`;
    - `estimate(10, 99) == COMPUTE`;
    - `estimate(0, -1) == COMPUTE`;
    - `estimate(1, 1000) == COMPUTE`;
    - `estimate(-1, 999) == COMPUTE`;
    - `requireWithinIntegerDigits` acepta 10^99 y rechaza 10^100.
  - `@Timeout(value = 2, threadMode = SEPARATE_THREAD)` en `power 999999999999999 1000`, `power 0.5 -1000` y `power 3 -1000`, que tienen que resolverse sin calcular la potencia.
- [ ] **Paso 2:** `cd backend && mvn -B -q test -Dtest='OptionalOperationsTest,PowerBoundsTest,OperationTest'`. Esperado: falla de compilación.
- [ ] **Paso 3:** implementar. Primero migrar `apply` a `List<Operand>` en las 4 constantes existentes (`OperationTest` sigue en verde), después las 3 nuevas y `PowerBounds`.
- [ ] **Paso 4:** `cd backend && mvn -B -q spotless:apply && mvn -B -q test`. Esperado: suite completa en verde. **`CalculatorService` va a dejar de compilar** hasta B2 por el cambio de firma: si es así, se hace en esta misma tarea el cambio mínimo, que es pasar la lista. El resto del servicio (`validate`) es de B2.

### Task B2: Aplicación + web + OpenAPI + integración

**Archivos:**
- Modificar `application/service/CalculatorService.java`.
- Modificar `adapter/in/web/ProblemDetailHandler.java` y `adapter/in/web/CalculatorController.java` (anotaciones de springdoc).
- Modificar `config/OpenApiConfig.java` (descripción).
- Tests:
  - modificar `application/service/CalculatorServiceTest.java`, `adapter/in/web/CalculatorControllerTest.java` y `CalculatorApiIT.java`;
  - modificar `ProblemDetailHandlerTest.java` si cubre los handlers.

**Interfaces:**
- Consume: todo lo de B1.
- Produce:
  - `CalculatorService.calculate`: `fromCode` → aridad (`InvalidOperandCountException`) → `Operand` por índice (`withIndex`) → `operation.validate(operands)` → `operation.apply(operands)`.
  - Handlers: `InvalidOperandException` → 400 `Invalid operand`; `ResultOutOfRangeException` → 400 `Result out of range`; ambos con `detail = getMessage()`.
  - springdoc: `@Schema(allowableValues = {"add","subtract","multiply","divide","power","sqrt","percentage"})` sobre `CalculationRequest.operation`, más `@ExampleObject` para `sqrt [2]` y `percentage [20,150]`.

- [ ] **Paso 1: tests en rojo.**
  - `CalculatorServiceTest`: `sqrt [16]` → `"4"`; `sqrt [1,2]` → `InvalidOperandCountException`; `sqrt [1E+999999999]` → `OperandOutOfRangeException` con el prefijo `"operands[0] "` (los límites van antes que `validate`); `power [2,1000.5]` → `InvalidOperandException`.
  - `CalculatorControllerTest`, filas con status, `application/problem+json` y `title` exacto:
    - `sqrt [-4]` → `Invalid operand`;
    - `power [2,0.5]` → `Invalid operand`;
    - `power [2,1001]` → `Operand out of range`;
    - `power [10,100]` → `Result out of range`;
    - `power [0,-1]` → `Division by zero`;
    - `sqrt []` → `Invalid operand count`;
    - `sqrt [1,2]` → `Invalid operand count`;
    - `sqrt [1e999999999]` → `Operand out of range`;
    - `PERCENTAGE [20,150]` → `Unsupported operation`.
  - `CalculatorControllerTest`, éxitos: `power [2,64]` → `"18446744073709551616"`; `sqrt [2]` → `"1.4142135624"`; `percentage [20,150]` → `"30"`.
  - `CalculatorApiIT`:
    - éxito real por HTTP de `power [2,10]` → `"1024"`, `sqrt [9]` → `"3"` y `percentage [20,150]` → `"30"`;
    - `/v3/api-docs`, parseado como JSON: el schema de `CalculationRequest.operation` tiene un `enum` con `"sqrt"`, `"power"` y `"percentage"`.
- [ ] **Paso 2:** `cd backend && mvn -B -q test -Dtest='CalculatorServiceTest,CalculatorControllerTest'`. Esperado: FAIL.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `cd backend && mvn -B -q spotless:apply && mvn -B verify`. Esperado: `BUILD SUCCESS`, failsafe en verde y "All coverage checks have been met".

---

### Task F1: Modelo — tipos, mensajes y reducer

**Archivos:**
- Modificar en `frontend/src/features/calculator/model/`: `types.ts`, `errorMessages.ts` y `calculatorReducer.ts`.
- Tests: modificar `errorMessages.test.ts` y `calculatorReducer.test.ts`.

**Interfaces producidas:**
- `types.ts`:
  - `type Operation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power' | 'sqrt' | 'percentage'`;
  - `type BinaryOperation = Exclude<Operation, 'sqrt'>`;
  - `type UnaryOperation = 'sqrt'`.
- `CalculatorState`:
  - `operator` y `pendingOperator` pasan a ser `BinaryOperation | null`;
  - `request: { operation: Operation; operands: string[] } | null`;
  - se agrega la forma de recordar que el próximo dígito reemplaza (queda a criterio del implementador, según la spec).
- `CalculatorAction`:
  - se agrega `| { type: 'unaryOperator'; operator: UnaryOperation }`;
  - `operator` pasa a usar `BinaryOperation`.
- `errorMessages`: `'Invalid operand'` → `'Invalid input'` y `'Result out of range'` → `'Result too large'`.

- [ ] **Paso 1: tests en rojo.** Uno por cada fila de "Eventos nuevos del reducer" de la spec, más:
  - `chains power then multiply`: `2 ^ 3 ×` → request `power ['2','3']` con `pendingOperator: 'multiply'`;
  - `percentage behaves as binary`: `20 % 150 =` → request `percentage ['20','150']`;
  - `sqrt requests single operand`: `9 √` → request `{ operation: 'sqrt', operands: ['9'] }`;
  - `sqrt with pending binary keeps previous`: `2 + 9 √`, `resolved('3')` → `previous '2'`, `operator 'add'`, `current '3'`; después `digit '4'` → `current '4'` (reemplaza), y `equals` → request `add ['2','3']`;
  - `sqrt without pending goes to result`;
  - `unaryOperator in awaitingOperand is a no-op`;
  - `unaryOperator ignored while pending`;
  - `sqrt on oversized result sets resultTooLong`;
  - `rejected unary restores result phase`;
  - `toggleSign after unary keeps replace flag`;
  - `errorMessages` para los 2 títulos nuevos.
- [ ] **Paso 2:** `cd frontend && fnm exec --using=22 npx vitest run src/features/calculator/model`. Esperado: FAIL.
- [ ] **Paso 3:** implementar. El reducer sigue siendo una función pura.
- [ ] **Paso 4:** el mismo comando. Esperado: PASS. Además `fnm exec --using=22 npx tsc --noEmit`: los consumidores en `api/` y `hooks/` pueden romper por los tipos; si pasa, el ajuste mínimo de tipos va acá y el resto es de F2.

### Task F2: API, hook, teclado 4×6 y componentes

**Archivos:**
- Modificar:
  - `frontend/src/features/calculator/api/calculatorApi.ts`;
  - `hooks/useCalculator.ts` (`KEY_ACTIONS`, `SYMBOLS: Record<BinaryOperation, string>` con `power: '^'` y `percentage: '%'`, y el filtro de modificadores);
  - `molecules/Keypad.tsx` + `.module.css` (grilla 4×6);
  - `atoms/CalcButton.tsx` + `.module.css` (prop `tall?: boolean` → `grid-row: span 2`).
- Tests: modificar `calculatorApi.test.ts`, `useCalculator.test.tsx`, `Keypad.test.tsx`, `CalcButton.test.tsx` y `organisms/CalculatorPanel.test.tsx`.

**Interfaces:**
- Consume: F1.
- Produce:
  - `calculate(operation: Operation, operands: readonly string[], signal?: AbortSignal): Promise<string>`;
  - `Keypad` con 22 botones en el orden de la spec: `C ⌫ % ÷ / xʸ √ ± × / 7 8 9 − / 4 5 6 + / 1 2 3 =(tall) / 0(wide) .`;
  - el botón `√` emite `{ type: 'unaryOperator', operator: 'sqrt' }`.

- [ ] **Paso 1: tests en rojo.**
  - `calculatorApi`: `sends single operand for sqrt` (el body es `{"operation":"sqrt","operands":[9]}`).
  - `Keypad`: los 22 botones existen por `getByRole('button', { name })` con los labels exactos; `square root` emite `unaryOperator`; `power` y `percent` emiten `operator`.
  - `CalcButton`: `tall` aplica el span de 2 filas.
  - `useCalculator`: `accepts shifted symbol keys` (`@`, `^` y `%` con `shiftKey: true` despachan); `y` → power; Ctrl+`^` se ignora.
  - `CalculatorPanel` (MSW):
    - `computes 2 ^ 10 = 1024`;
    - `computes 2 ^ 3 × 2 = 16`;
    - `computes sqrt 9 = 3`;
    - `computes 2 + 9 sqrt = 5`;
    - `computes 20 % 150 = 30`;
    - `shows Invalid input for 4 ± sqrt and resets with C`;
    - `shows Result too large for 10 ^ 100`;
    - `shows Cannot divide by zero for 0 ^ -1`;
    - `sends one request on sqrt then equals while pending`;
    - `keyboard 2^8 Enter = 256 and 16@ = 4`.
- [ ] **Paso 2:** `fnm exec --using=22 npx vitest run src/features src/app`. Esperado: FAIL.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `cd frontend && fnm exec --using=22 npm run lint && fnm exec --using=22 npm run test:coverage && fnm exec --using=22 npm run build`. Esperado: todo en verde y cobertura ≥ 90%.

---

### Task E1: E2E — UI y contrato de las operaciones nuevas

**Archivos:**
- Modificar `e2e/tests/ui-operations.spec.ts`, `ui-errors.spec.ts`, `ui-edge-cases.spec.ts` (de 19 a 22 botones) y `api-contract.spec.ts`.

**Interfaces:**
- Consume: los `aria-label` y mensajes de las restricciones globales, y el contrato de B2.

- [ ] **Paso 1: specs.**
  - **UI:**
    - `2 xʸ 10 =` → `1024`;
    - `9 √` → `3`;
    - `2 + 9 √ =` → `5`;
    - `20 % 150 =` → `30`;
    - teclado `2^8{Enter}` → `256` y `16@` → `4`;
    - `2 √` → `1.4142135624`.
  - **Errores:**
    - `4 ± √` → `Invalid input`;
    - `10 xʸ 100 =` → `Result too large`, y después `C` → `0`.
  - **Bordes:** layout a 360 px y en `mobile` con **22** botones visibles y dentro del viewport (bounding boxes).
  - **API (chromium):**
    - `sqrt [-4]` → `Invalid operand`;
    - `power [2,0.5]` → `Invalid operand`;
    - `power [2,1001]` → `Operand out of range`;
    - `power [10,100]` → `Result out of range`;
    - `power [0,-1]` → `Division by zero`;
    - `sqrt [1,2]` → `Invalid operand count`;
    - `sqrt [1e999999999]` → `Operand out of range` (raw body);
    - éxitos `power [2,10]` → `"1024"`, `sqrt [2]` → `"1.4142135624"` y `percentage [20,150]` → `"30"`.
- [ ] **Paso 2:** desde la raíz, sin variables de shell para el comando de compose (zsh no hace word splitting):
  ```bash
  docker compose -p sezzle-e2e -f docker-compose.test.yml up -d --build --wait
  docker compose -p sezzle-e2e -f docker-compose.test.yml port web 80 | cut -d: -f2
  cd e2e && E2E_BASE_URL=http://localhost:<port> fnm exec --using=22 npx playwright test --project=chromium --project=firefox --project=mobile
  docker compose -p sezzle-e2e -f docker-compose.test.yml down -v
  ```
  Esperado: todas las specs en verde. WebKit se verifica aparte, en el contenedor Linux.

---

### Task F3 (anexo): Tema oscuro / claro

**Archivos:**
- Crear en `frontend/src/shared/theme/`:
  - `theme.ts`: `type Theme = 'dark' | 'light'`, `THEME_STORAGE_KEY = 'sezzle-calculator-theme'`, `readStoredTheme(): Theme | null` y `storeTheme(theme: Theme): void`, todo protegido con `try/catch`;
  - `useTheme.ts`: `useTheme(): { theme: Theme; toggle: () => void }`; el tema inicial sale de `document.documentElement.dataset.theme` y cae a `'dark'`; aplica el atributo y persiste.
  - `ThemeToggle.tsx` + `.module.css`, con sus tests.
- Modificar:
  - `frontend/index.html`: script inline antes del bundle;
  - `frontend/src/app/global.css`: variables CSS por tema y fondo del `body`;
  - `frontend/src/app/App.tsx` y `App.module.css`: el toggle va arriba a la derecha;
  - los `.module.css` de `atoms`, `molecules` y `organisms` reemplazan los colores fijos por variables.
- Crear `e2e/tests/ui-theme.spec.ts`.
- Borrar `frontend/src/shared/.gitkeep`.

- [ ] **Paso 1: tests en rojo:**
  - `theme.test.ts`: storage disponible, `setItem` que lanza, `getItem` que lanza y valor inválido;
  - `ThemeToggle.test.tsx`: `aria-label` según el tema, el click alterna `document.documentElement.dataset.theme` y persiste, y Enter con foco no dispara el `=` del listener global (se verifica en `CalculatorPanel` o `App`);
  - `App.test.tsx`: arranca en oscuro sin storage.
- [ ] **Paso 2:** `cd frontend && fnm exec --using=22 npx vitest run src/shared src/app`. Esperado: FAIL.
- [ ] **Paso 3:** implementar.
- [ ] **Paso 4:** `cd frontend && fnm exec --using=22 npm run lint && fnm exec --using=22 npm run test:coverage && fnm exec --using=22 npm run build`. Después, correr los E2E de chromium, firefox y mobile, incluido `ui-theme`, con el procedimiento de compose de E1. Todo en verde.
