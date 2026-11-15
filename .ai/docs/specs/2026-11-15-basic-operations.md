# SPEC — Operaciones básicas (add, subtract, multiply, divide)

Fecha: 2026-11-15
Jira/HDU: Not provided
Clasificación: GRANDE
Rama: `feat/basic-operations`
Base: ADR-001 (stack, contrato, BigDecimal) · `.ai/architecture.md` · `.ai/testing.md`

> **Nota (2026-11-15):** esta spec describe la iteración 1. La superan parcialmente `2026-11-15-optional-operations.md` y ADR-003: `power` ya no es `Unsupported operation`, el teclado pasó de 4×5 (19 botones) a 4×6 (22 botones), `sqrt` usa 1 operando y se agregaron el paso de validez por operación y el tema oscuro/claro.

## Intención

Primera funcionalidad real de la calculadora: las cuatro operaciones básicas funcionando de punta a punta, desde el teclado en pantalla o el teclado físico hasta el backend hexagonal, con TDD y E2E de éxito, error y bordes. El contrato que se implementa acá es el mismo que después va a implementar un backend en Go: el frontend no debe cambiar cuando se reemplace el backend.

## Objetivos

- `POST /api/v1/calculate` implementado para `add`, `subtract`, `multiply` y `divide`, según el contrato de abajo.
- Calculadora usable en desktop y mobile (360 px), con teclado en pantalla y teclado físico.
- Validación en las dos capas: el cliente valida formato y límites, y el servidor valida el contrato completo.
- Cobertura ≥ 90% en líneas y branches en ambas capas. E2E en verde en los 4 proyectos de Playwright.
- Endpoint documentado en OpenAPI (springdoc).

## No objetivos

- `power`, `sqrt` y `percentage`: van en la iteración 2 (ver las decisiones diferidas de ADR-001).
- Historial, persistencia, autenticación, internacionalización y memoria (M+/M−).
- Precedencia de operadores: `2 + 3 × 4` encadena como una calculadora física y da `20`, no `14`.

## Anti-objetivos (cuentan como fallo aunque "funcione")

- Que `0.1 + 0.2` muestre `0.30000000000000004` en cualquier capa.
- Que un request corto y válido (por ejemplo `[1e999999999, 0.1]`) consuma memoria o CPU sin límite.
- Que el dominio del backend importe Spring.
- Que el frontend tenga que conocer detalles de Java (stack traces, nombres de excepciones).
- Que un error deje la calculadora en un estado del que no se puede salir sin recargar.

## Enfoques considerados (backend)

| Enfoque | Trade-off | Elegido |
|---------|-----------|---------|
| **A. Enum `Operation` con comportamiento + value object `Operand` con invariantes** | Dominio puro, una constante por operación, se porta casi literal a Go (`map[string]func` + `NewOperand`) | ✅ el usuario lo eligió |
| B. Interfaz + un `@Component` por operación en un `Map` | Mete Spring en el dominio o exige registro manual; 4 clases para 4 líneas | ❌ |
| C. Límites con Bean Validation en el DTO | Reglas de negocio en el adapter; dominio vacío; hay que reescribirlas en Go | ❌ |

Frontend: un solo camino razonable. Un reducer puro con la máquina de estados, un hook que lo conecta con la API y el teclado, y componentes presentacionales. Se descarta poner la lógica en los componentes porque mezcla reglas con render y obliga a testear todo vía DOM.

## Contrato REST

```
POST /api/v1/calculate
Content-Type: application/json

{ "operation": "add" | "subtract" | "multiply" | "divide", "operands": [number, number] }
```

### Reglas de entrada (validadas en el dominio del backend y replicadas en el cliente)

Para cada operando, normalizado con `stripTrailingZeros()`:

| Regla | Valor |
|-------|-------|
| Dígitos significativos (`precision()`) | ≤ 15 |
| Valor absoluto | < 10^15 |
| Decimales (`scale()`, si es > 0) | ≤ 10 |

- La cantidad de operandos es exactamente 2 para las 4 operaciones.
- **Contrato estricto** (decisión del usuario):
  - `operation` distingue mayúsculas y minúsculas: solo se acepta en minúsculas, así que `"ADD"` → `Unsupported operation`.
  - Un campo desconocido en el body → `Malformed request`.
  - `operation` tiene que ser un string JSON: `{"operation": 5}` → `Malformed request`, porque la conversión de tipos también se desactiva para `String`.
- Los operandos tienen que ser **números JSON**. Un string (`"1"`), un booleano o `null` → `Malformed request`. Jackson por defecto convierte `"1"` en número, así que hay que **desactivar esa conversión** para `BigDecimal`.
- Los límites cortan el ataque de DoS por exponente: `1e999999999` tiene precisión 1 pero valor ≥ 10^15, y `1e-999999999` tiene escala > 10.
- **Normalización obligatoria:** `Operand` guarda el valor ya normalizado (`stripTrailingZeros()`), no el crudo. Sin esto, un cero con exponente enorme (`0e-999999`, `0e+999999999`) pasa la validación y la alineación de escalas de BigDecimal consume CPU sin límite. Hallazgo de la revisión final, cubierto con tests en el dominio, el controller y E2E.

### Orden de validación (parte del contrato; el backend en Go lo replica)

Gana el primer error:

1. Forma del JSON: sintaxis, tipos, campos faltantes, `null`, campos desconocidos → `Malformed request`
2. Operación → `Unsupported operation`
3. Cantidad de operandos → `Invalid operand count`
4. Límites de cada operando, en orden de índice → `Operand out of range`
5. Cálculo → `Division by zero`

Ejemplos: `power [1,2,3]` → `Unsupported operation`; `divide [1e999999999, 0]` → `Operand out of range`. El `detail` de un operando fuera de rango usa índice desde 0 (`operands[1] has more than 15 significant digits`).

### Respuestas

| Caso | Status | Body |
|------|--------|------|
| Éxito | 200 | `{"operation": "<op>", "result": "<decimal string>"}` |
| Divisor cero | 400 | ProblemDetail `title: "Division by zero"` |
| `operation` desconocida | 400 | `title: "Unsupported operation"` |
| Cantidad de operandos ≠ 2 | 400 | `title: "Invalid operand count"` |
| Operando fuera de límites | 400 | `title: "Operand out of range"`, con `detail` que dice qué límite y en qué índice |
| JSON inválido, campo faltante, `null`, tipo incorrecto | 400 | `title: "Malformed request"` |
| `Content-Type` incorrecto | 415 | ProblemDetail por defecto de Spring |
| Error inesperado | 500 | `title: "Internal error"`, sin stack trace |

- Los `title` son **parte del contrato**: estables, en inglés, sin cambiar mayúsculas ni puntuación. El frontend los mapea a mensajes para el usuario.
- `type` se **omite** (Spring 7 no lo emite cuando vale el default; RFC 9457 lo hace equivalente a `about:blank`). `detail` es texto libre en inglés, independiente del idioma del request. Cuando incluye el código de operación recibido, lo trunca a 32 caracteres. El body incluye además `instance` con el path.

### Reglas de resultado

| Operación | Cálculo |
|-----------|---------|
| add / subtract / multiply | Exacto con BigDecimal |
| divide | `a.divide(b, 10, RoundingMode.HALF_EVEN)` |

- Siempre `stripTrailingZeros()` y después `toPlainString()`: sin notación científica ni ceros sobrantes.
- El cero sale como `"0"`. BigDecimal no tiene `-0`, así que la normalización es natural.
- Peor caso con los límites: `multiply` de dos operandos de 15 dígitos da ≤ 30 dígitos y 20 decimales. El costo queda acotado.

### Ejemplos que deben cumplirse literalmente (tests)

| Request | `result` |
|---------|----------|
| add [0.1, 0.2] | `"0.3"` |
| subtract [5, 8] | `"-3"` |
| multiply [999999999999999, 999999999999999] | `"999999999999998000000000000001"` |
| multiply [-2.5, 0] | `"0"` |
| divide [6, 3] | `"2"` |
| divide [1, 3] | `"0.3333333333"` |
| divide [2, 3] | `"0.6666666667"` |
| divide [1, 8] | `"0.125"` |
| divide [0.0000000001, 3] | `"0"` (redondea a escala 10) |
| divide [5, 0] | 400 `Division by zero` |
| add [1e999999999, 0.1] | 400 `Operand out of range` |
| add [1234567890123456, 1] | 400 `Operand out of range` (16 dígitos) |
| add [0.12345678901, 1] | 400 `Operand out of range` (11 decimales) |
| add ["1", 2] | 400 `Malformed request` |
| add [1, 2, 3] | 400 `Invalid operand count` |
| power [2, 3] | 400 `Unsupported operation` (iteración 2) |
| ADD [1, 2] | 400 `Unsupported operation` |
| `{"operation": 5, "operands": [1, 2]}` | 400 `Malformed request` |
| `{"operation": "add", "operands": [1, 2], "foo": 1}` | 400 `Malformed request` |
| divide [1e999999999, 0] | 400 `Operand out of range` (orden de validación) |

## Backend — diseño

Paquete raíz `com.sezzle.calculator`.

| Tipo | Paquete | Forma |
|------|---------|-------|
| `Operation` | `domain.model` | enum `ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE`; `BigDecimal apply(Operand a, Operand b)`; `static Operation fromCode(String)` que lanza `UnsupportedCalculationException` |
| `Operand` | `domain.model` | record `Operand(BigDecimal value)` que valida los límites en el constructor compacto y lanza `OperandOutOfRangeException` |
| `CalculationResult` | `domain.model` | record `(Operation operation, BigDecimal value)` |
| Excepciones | `domain.exception` | base `CalculationException` (unchecked) y subclases `DivisionByZeroException`, `UnsupportedCalculationException`, `InvalidOperandCountException`, `OperandOutOfRangeException` |
| `CalculateUseCase` | `application.port.in` | `CalculationResult calculate(CalculateCommand command)` |
| `CalculateCommand` | `application.port.in` | record `(String operation, List<BigDecimal> operands)`; valida la cantidad según la operación |
| `CalculatorService` | `application.service` | implementa el puerto; `@Service` + `@RequiredArgsConstructor` (no tiene dependencias hoy, pero sigue la convención) |
| `CalculatorController` | `adapter.in.web` | `@RestController`, `POST /api/v1/calculate`; `@RequiredArgsConstructor`; anotaciones de springdoc |
| `CalculationRequest` / `CalculationResponse` | `adapter.in.web` | records; el request usa `@NotNull` sobre `operation` y `operands` |
| `ProblemDetailHandler` | `adapter.in.web` | `@RestControllerAdvice` que traduce excepciones de dominio, errores de parseo y de validación a la tabla de respuestas |
| Config de Jackson | `config` | desactiva la conversión de tipos hacia `BigDecimal` y hacia `String`; falla ante campos desconocidos |

- **Dominio**: Java puro y records. Lombok solo en beans de Spring.
- **Lombok**: `lombok.config` en `backend/` con `lombok.addLombokGeneratedAnnotation = true`, para que JaCoCo ignore el código generado. Esto revierte la línea "sin Lombok" de ADR-001 y queda registrado en ADR-002.
- **MapStruct**: no. El mapeo request → command → response son 2 campos por paso. Se reevalúa si el mapeo crece.
- **Nombres**: se usa `UnsupportedCalculationException` y no `UnsupportedOperationException`, para no chocar con `java.lang.UnsupportedOperationException`.
- **OpenAPI**: `@Operation`, `@ApiResponse` para 200 y 400, y ejemplos de request y response. Un test de integración verifica que `/v3/api-docs` contiene `/api/v1/calculate`.

## Frontend — diseño

```
src/
  app/App.tsx                       monta CalculatorPanel
  features/calculator/
    model/
      calculatorReducer.ts          máquina de estados pura
      limits.ts                     reglas de límites (las mismas que el backend)
      errorMessages.ts              title → mensaje para el usuario
    api/calculatorApi.ts            fetch tipado; lanza CalculatorApiError(title, detail)
    hooks/useCalculator.ts          reducer + llamadas a la API + teclado físico
    atoms/CalcButton.tsx, Display.tsx
    molecules/Keypad.tsx, DisplayPanel.tsx
    organisms/CalculatorPanel.tsx
```

### Estado y eventos

Estado: `previous: string | null`, `operator: Operation | null`, `current: string`, `phase: 'input' | 'awaitingOperand' | 'result' | 'pending'`, `error: string | null`, `pendingOperator: Operation | null`.

| Evento | Comportamiento |
|--------|----------------|
| `digit(d)` | Si hay un `result`: empieza una cuenta nueva. Si `current` es `"0"`, lo reemplaza. Se ignora si superaría 15 dígitos significativos o 10 decimales. |
| `decimal` | Agrega `.` si no hay uno; si la entrada está vacía, pone `"0."` |
| `toggleSign` (± / F9) | Niega `current`. No hace nada si es `"0"`. Sobre un `result`, lo niega y permite seguir con él. |
| `backspace` | Borra el último carácter. Si queda vacío o `"-"`, deja `"0"`. No hace nada sobre un `result`. |
| `clear` (C / Esc) | Resetea todo. Si hay un request en curso, lo cancela con `AbortController`. |
| `operator(op)` | Con `previous`, `operator` y un segundo operando ya tipeado: calcula y guarda `op` en `pendingOperator`; al resolver, `previous = result` y `operator = op`. Sin segundo operando: reemplaza el operador. Sobre un `result`: si está dentro de los límites, pasa a ser `previous`; si no, error "Result too long to continue". |
| `equals` (= / Enter) | Con `previous`, `operator` y `current`: calcula; al resolver, `phase = result`. Si falta un operando, no hace nada. |
| `paste(text)` | Normaliza `,` → `.` y aplica `trim`. Formato aceptado: `^-?(\d+\.?\d*|\.\d+)$`, sin notación científica. Si es válido y está dentro de los límites, reemplaza `current`; sobre un `result`, empieza una cuenta nueva. Si no: "Invalid number" o "Too many digits", y el estado no cambia. |
| `resolved(result)` / `rejected(error)` | Cierran `pending`. Un error conserva `previous`, `operator` y `current`, así que se puede corregir o reintentar con `=`. |
| `resolved` con `pendingOperator`, si el resultado excede los límites | Muestra el resultado completo (`phase = result`), descarta `pendingOperator` y pone el error "Result too long to continue". Para seguir: `C`, o tipear un dígito para empezar una cuenta nueva. |

- Mientras `phase` es `pending`, solo se acepta `clear`. Cualquier otro evento limpia el `error` antes de aplicarse.
- **Teclado físico**: `0-9`, `.` y `,` (decimal), `+ - * /`, `Enter` y `=`, `Escape`, `Backspace`, `F9`, y `Ctrl/Cmd+V` (pegar). Se escucha en `window` y se ignora si el foco está en un input ajeno.
- **Mensajes** (`errorMessages.ts`):

  | Origen | Mensaje |
  |--------|---------|
  | `Division by zero` | "Cannot divide by zero" |
  | `Operand out of range` | "Number out of range" |
  | `Unsupported operation`, `Invalid operand count`, `Malformed request` | "Invalid request" |
  | Fallo de red o 5xx | "Service unavailable" |
  | Errores del cliente | "Invalid number", "Too many digits", "Result too long to continue" |

- **Envío**: `current` y `previous` son strings. Se envían como `Number(x)`; dentro de los límites, la conversión es exacta.
- **Límite al tipear**: se cuentan los decimales tal cual se escriben, incluidos los ceros finales. Así `1.0000000000` llega a 10 y la tecla siguiente no suma.
- **Grilla**: 4 columnas × 5 filas, con 19 botones. El `0` ocupa dos celdas.

  | | | | |
  |---|---|---|---|
  | C | ⌫ | ± | ÷ |
  | 7 | 8 | 9 | × |
  | 4 | 5 | 6 | − |
  | 1 | 2 | 3 | + |
  | 0 (doble) | | . | = |

- **Display**: arriba la cuenta en curso (`5 ×`), abajo `current` o el resultado. El texto se achica si es largo y después hace scroll horizontal; no puede romper el layout a 360 px.
- **Accesibilidad**: el display es `role="status"` con `aria-live="polite"`. Cada botón tiene un `aria-label` estable: `"0"`–`"9"`, `"decimal point"`, `"add"`, `"subtract"`, `"multiply"`, `"divide"`, `"equals"`, `"clear"`, `"backspace"`, `"plus/minus"`. Los selectores E2E dependen de esos nombres.

## Testing

| Nivel | Qué cubre |
|-------|-----------|
| Unitario backend | `Operand` (cada límite en su borde: 15 y 16 dígitos, 10 y 11 decimales, 10^15 − 1 y 10^15, exponentes extremos); `Operation` (tabla de ejemplos); `CalculateCommand` (cantidad); `CalculatorService` |
| `@WebMvcTest` | Cada fila de la tabla de respuestas, incluidos los `title` exactos, el string como operando, JSON roto y el 415 |
| Integración (`*IT`, RANDOM_PORT) | Flujo HTTP real: éxito, división por cero, operando fuera de rango y `/v3/api-docs` |
| Unitario frontend | `calculatorReducer` (cada fila de la tabla de eventos), `limits`, `errorMessages` |
| Componentes (MSW) | `CalculatorPanel`: cuenta completa, encadenamiento, error del backend visible y recuperable, fallo de red, teclado físico, pegar |
| E2E (Playwright, 4 proyectos) | **UI:** las 4 operaciones, `0.1 + 0.2 = 0.3`, encadenamiento `2 + 3 × 4 = 20`, ± y F9, teclado físico, `÷ 0` → "Cannot divide by zero" y recuperación, `1 ÷ 3`, límite de 15 dígitos al tipear, "Result too long to continue", pegar inválido, sin scroll horizontal en mobile. **API** (fixture `request`): `1e999999999`, string como operando, 3 operandos, operación desconocida, `"ADD"`, campo extra, JSON roto y el orden de validación (`divide [1e999999999, 0]`), con sus `title` |

El E2E corre con `make e2e`, en un puerto efímero. Ningún test usa puertos fijos.

## Queda a criterio del builder

- Cliente HTTP en los tests de integración (`RestTestClient` u otro equivalente de Boot 4).
- Estilos concretos (paleta, tipografía) con CSS Modules, mientras se respeten el layout de la grilla 4×5 y el mínimo de 360 px.
- La forma interna de las acciones del reducer, siempre que cumpla la tabla de eventos.
- El texto de `detail` en los ProblemDetail.
