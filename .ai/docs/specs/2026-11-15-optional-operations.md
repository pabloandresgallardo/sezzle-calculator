# SPEC — Operaciones opcionales (power, sqrt, percentage)

Fecha: 2026-11-15
Jira/HDU: Not provided
Clasificación: GRANDE
Rama: `feat/optional-operations`
Base: ADR-001 (decisiones diferidas) · ADR-002 (contrato, límites, orden de validación) · spec `2026-11-15-basic-operations.md` (todo lo que no se redefine acá sigue vigente)

## Intención

Completar los requisitos opcionales del challenge: exponenciación, raíz cuadrada y porcentaje, de punta a punta. Los botones nuevos van **directamente en el teclado**, sin menú ni botón de "más operaciones" (pedido del usuario). El contrato sigue siendo el que va a replicar el backend en Go.

## Objetivos

- `power`, `sqrt` y `percentage` en `POST /api/v1/calculate`, con las reglas de abajo.
- Teclado 4×6 estilo Windows con 22 botones, usable a 360 px.
- `√` es unaria e inmediata; `xʸ` y `%` son binarias y encadenan como `+`.
- Atajos en el teclado físico: `@` (√), `^` / `y` (xʸ), `%` (%).
- ADR-003 con las decisiones de esta iteración.
- Cobertura ≥ 90%, E2E en verde, OpenAPI actualizado.

## No objetivos

- El `%` contextual de Windows (`150 + 10 %` → `165`). Acá `%` es siempre "a% de b" (ADR-001).
- Otras funciones científicas (`x²`, `1/x`, trigonometría), memoria e historial.
- Precedencia de operadores (`2 + 3 xʸ 2` encadena: `(2+3)^2 = 25`).

## Anti-objetivos

- Que un request válido y corto consuma CPU o memoria sin límite (por ejemplo `power [999999999999999, 1000]`, `power [0.5, -1000]` o `power [1.0000000001, 1000]`).
- Que `√(-4)` muestre "Number out of range".
- Romper cualquier comportamiento de la iteración 1: los tests existentes siguen pasando sin cambios, salvo los ajustes de layout y aridad explícitos acá.

## Enfoques considerados (backend)

| Enfoque | Trade-off | Elegido |
|---------|-----------|---------|
| **A. Generalizar el enum `Operation`** (Strategy con enum): `apply(List<Operand>)`, `arity()` que cada constante puede sobrescribir y el hook `validate(List<Operand>)` | Un lugar por operación; el patrón no cambia; se porta directo a Go | ✅ elegido por el usuario |
| B. `sealed interface` con enums binario y unario y `switch` con pattern matching | Tipos más expresivos, pero más piezas, `fromCode` sobre dos enums y menos directo de portar a Go | ❌ |
| Mantener `apply(Operand, Operand)` y que `SQRT` ignore el segundo operando | Parche: operando ficticio que rompe la validación de cantidad | ❌ |

## Contrato REST (delta sobre ADR-002)

`operation` acepta además `power`, `sqrt` y `percentage` (en minúsculas exactas).

| Operación | Aridad | Semántica |
|-----------|--------|-----------|
| `power` | 2 | `operands[0]` elevado a `operands[1]` |
| `sqrt` | 1 | raíz cuadrada de `operands[0]` |
| `percentage` | 2 | `operands[0]` % de `operands[1]` = `a × b / 100` |

### Errores nuevos (los `title` son contrato)

| `title` | Status | Cuándo | `detail` (texto libre, en inglés) |
|---------|--------|--------|-----------------------------------|
| `Invalid operand` | 400 | `sqrt` de un negativo; exponente no entero | `operands[0] must not be negative` · `operands[1] must be an integer` |
| `Result out of range` | 400 | El resultado tendría más de 100 dígitos enteros | `result would exceed 100 integer digits` |

Un exponente fuera de [−1000, 1000] → `Operand out of range`, con `detail` `operands[1] must be between -1000 and 1000`.

### Orden de validación (actualizado; parte del contrato)

Gana el primer error:

1. Forma del JSON → `Malformed request`
2. Operación → `Unsupported operation`
3. Cantidad según la aridad (`sqrt` = 1, el resto = 2) → `Invalid operand count`
4. Límites genéricos de cada operando (ADR-002), por índice → `Operand out of range`
5. **Validez por operación** (hook `validate`), en este orden:
   - `sqrt`: negativo → `Invalid operand`
   - `power`: exponente no entero → `Invalid operand`; exponente fuera de [−1000, 1000] → `Operand out of range`; resultado estimado con más de 100 dígitos enteros → `Result out of range`
6. Cálculo → `Division by zero` (incluye `power [0, negativo]`)

Ejemplos: `sqrt [1e999999999]` → `Operand out of range` (paso 4 antes que 5); `power [2, 1000.5]` → `Invalid operand`; `power [0, -1]` → `Division by zero`.

### Reglas de cálculo

| Operación | Regla |
|-----------|-------|
| `sqrt` | `value.sqrt(MathContext.DECIMAL128)` y después `setScale(10, HALF_EVEN)`. Con operandos de ≤ 10 decimales no hay empates exactos en el decimal 11, así que el doble redondeo es seguro. |
| `power`, exponente ≥ 0 | `base.pow(e)` exacto y después `setScale(10, HALF_EVEN)`. Una base con decimales puede generar miles de decimales; se recortan. `0^0 = 1`. |
| `power`, exponente < 0 | `ONE.divide(base.pow(-e), 10, HALF_EVEN)`; base 0 → `DivisionByZeroException` |
| `percentage` | `a.multiply(b).movePointLeft(2)`, exacto (como `multiply`: hasta 22 decimales) |
| Todas | Resultado con `stripTrailingZeros().toPlainString()` (igual que hoy) |

**Cota de costo de `power`** (anti-objetivo). Antes de calcular `base.pow(|e|)`:

- Estimar `L = e × log10(|base|)` en `double`. `log10(|base|)` sale de `log10(unscaledValue) − scale`; el unscaled tiene ≤ 15 dígitos, así que es exacto en double.
- Si `L > 101`: `Result out of range` **sin calcular**. El margen de 1 cubre el error del `double`.
- Si `L < −11`: el resultado redondea a 0 a escala 10, así que se devuelve `0` **sin calcular**.
- Si no: calcular y verificar exacto. Si `precision − scale` del resultado es > 100 → `Result out of range`.
- Base 0 o |base| = 1: no estimar (log indefinido o 0) y calcular directo, que es trivial.

### Ejemplos que deben cumplirse literalmente (tests)

| Request | Respuesta |
|---------|-----------|
| sqrt [2] | `"1.4142135624"` |
| sqrt [16] | `"4"` |
| sqrt [0.25] | `"0.5"` |
| sqrt [3] | `"1.7320508076"` |
| sqrt [0.0000000001] | `"0.00001"` |
| sqrt [999999999999999] | `"31622776.6016837775"` |
| sqrt [0] | `"0"` |
| sqrt [-4] | 400 `Invalid operand` |
| sqrt [1, 2] | 400 `Invalid operand count` |
| sqrt [] | 400 `Invalid operand count` |
| sqrt [1e999999999] | 400 `Operand out of range` |
| power [2, 64] | `"18446744073709551616"` |
| power [2, -3] | `"0.125"` |
| power [3, -5] | `"0.0041152263"` |
| power [1.5, 3] | `"3.375"` |
| power [0.5, 10] | `"0.0009765625"` |
| power [0.1234567891, 3] | `"0.0018816764"` |
| power [-2, 3] | `"-8"` |
| power [0, 0] | `"1"` |
| power [10, 99] | `"1" + 99 ceros` (100 dígitos enteros: se acepta) |
| power [10, 100] | 400 `Result out of range` |
| power [999999999999999, 1000] | 400 `Result out of range`, sin calcular (test con `@Timeout`) |
| power [0.5, -1000] | 400 `Result out of range` (≈ 302 dígitos) |
| power [3, -1000] | `"0"`, sin calcular (L < −11) |
| power [2, 0.5] | 400 `Invalid operand` |
| power [2, 1000.5] | 400 `Invalid operand` |
| power [2, 1001] | 400 `Operand out of range` |
| power [0, -1] | 400 `Division by zero` |
| percentage [20, 150] | `"30"` |
| percentage [12.5, 80] | `"10"` |
| percentage [0.1, 0.1] | `"0.0001"` |
| percentage [-15, 200] | `"-30"` |
| PERCENTAGE [20, 150] | 400 `Unsupported operation` (contrato estricto) |

## Backend — diseño

- **`Operation`:**
  - Constantes nuevas: `POWER("power")`, `SQRT("sqrt")` y `PERCENTAGE("percentage")`.
  - `public abstract BigDecimal apply(List<Operand> operands)` reemplaza la firma binaria; las 4 constantes existentes se adaptan.
  - `public int arity()` devuelve 2; `SQRT` lo sobrescribe y devuelve 1.
  - `public void validate(List<Operand> operands)` no hace nada por defecto; `SQRT` y `POWER` lo sobrescriben.
- **Excepciones de dominio nuevas:**
  - `InvalidOperandException(int index, String reason)`, con mensaje `operands[i] <reason>`.
  - `ResultOutOfRangeException()`, con mensaje `result would exceed 100 integer digits`.
  - El exponente fuera de rango reutiliza `OperandOutOfRangeException(reason).withIndex(1)`.
- **`CalculatorService`:** `fromCode` → aridad → `Operand` por índice → `operation.validate(operands)` → `operation.apply(operands)`. Sin `get(0)` ni `get(1)`.
- **`ProblemDetailHandler`:** dos handlers nuevos, `Invalid operand` y `Result out of range`, ambos con status 400.
- **OpenAPI:**
  - El esquema de `operation` lista los 7 valores (`allowableValues`).
  - Se suman ejemplos de request para `sqrt` y `percentage`.
  - La descripción de la API menciona las operaciones.
  - `CalculatorApiIT` verifica que `/v3/api-docs` lista `"sqrt"` entre los valores de `operation`.

## Frontend — diseño

### Teclado (decisión del usuario): 4 columnas × 6 filas, 22 botones

| | | | |
|---|---|---|---|
| C | ⌫ | % | ÷ |
| xʸ | √ | ± | × |
| 7 | 8 | 9 | − |
| 4 | 5 | 6 | + |
| 1 | 2 | 3 | = (ocupa 2 filas) |
| 0 (doble) | | . | (=) |

- `aria-label` nuevos: `power`, `square root`, `percent`. Los 19 existentes no cambian.
- Etiquetas visibles: `xʸ`, `√`, `%`.
- Mientras hay un request en curso (`pending`), siguen deshabilitados todos los botones menos `clear`.
- A 360 px, la grilla sigue sin scroll horizontal y los botones miden ≥ 44 px de alto.

### Modelo

- **`Operation` (TS)** suma `'power' | 'sqrt' | 'percentage'`.
- **Request a la API:** el payload pasa a `operands: string[]` (1 o 2). `calculatorApi.calculate(operation, operands: readonly string[], signal?)` mantiene el envío como `Number(x)`.
- **Símbolos en la línea de expresión:** `power` → `^`, `percentage` → `%`. `√` no aparece en la línea de expresión porque es inmediata.
- **`errorMessages`:**
  - `Invalid operand` → `"Invalid input"`
  - `Result out of range` → `"Result too large"`

#### Eventos nuevos del reducer

| Evento | Comportamiento |
|--------|----------------|
| `operator('power' \| 'percentage')` | Igual que cualquier binaria: encadena, reemplaza el operador si falta el segundo operando y continúa desde un `result`. |
| `unaryOperator('sqrt')` con un número en el display (`input`, o `result` dentro de los límites) | Pide `sqrt [current]` y deja `phase: 'pending'`. `previous` y `operator` se conservan. |
| `unaryOperator('sqrt')` en `awaitingOperand` (sin segundo número) | No hace nada. |
| `unaryOperator('sqrt')` sobre un `result` fuera de límites | Error `Result too long to continue`. |
| `resolved` de una unaria **con** binaria pendiente (`2 + 9 √`) | `current = "3"`; vuelve a la fase de entrada, pero el próximo dígito o `.` **reemplaza** `current` en lugar de agregarse, y `backspace` no hace nada. `=` usa `"3"` como segundo operando. |
| `resolved` de una unaria **sin** binaria pendiente (`9 √`) | `phase: 'result'` con `current = "3"`. Aplican las reglas vigentes de `result`: un dígito empieza de cero y un operador continúa. |
| Resultado de una unaria fuera de límites (por ejemplo `√999999999999999`, 18 dígitos) | Se muestra completo. Usarlo como operando (`=` u operador) da `Result too long to continue`, la regla vigente. |
| `rejected` de una unaria | Restaura exactamente el estado previo: `current` sigue siendo el radicando, y vuelve a `phase: 'result'` si la unaria se pidió desde un `result`, o a `input` si no. Muestra el mensaje. *(Decisión del controller.)* |
| `toggleSign` después de una unaria con binaria pendiente (`2 + 9 √ ±`) | Niega `current` (`-3`) y mantiene el flag de "el próximo dígito reemplaza". *(Decisión del controller.)* |

- **Teclado físico:** `@` → `unaryOperator('sqrt')`; `^` y `y` → `operator('power')`; `%` → `operator('percentage')`. Con `Shift` presionado se aceptan igual (`^`, `%` y `@` lo requieren en muchos layouts). *Actualizado tras la revisión final:* `@`, `^` y `%` también se aceptan cuando se producen con AltGr (`getModifierState('AltGraph')`) u Option (`altKey` sin Ctrl ni Meta), porque así se escriben en los layouts en español. Cualquier otra combinación con Ctrl o Alt, y toda combinación con Meta, se sigue ignorando. `Y` en mayúscula también mapea a `power`.

## Testing

| Nivel | Qué cubre |
|-------|-----------|
| Unitario backend | Cada fila de "Ejemplos"; `validate` por operación; la estimación de `power` (bordes `10^99` y `10^100`, sin calcular en los casos extremos, con `@Timeout`); aridad de `SQRT` |
| `@WebMvcTest` | Los `title` nuevos, el orden de validación (`sqrt [1e999999999]`, `power [2, 1000.5]`), la aridad de `sqrt` (0 y 2 operandos) y `PERCENTAGE` en mayúsculas |
| Integración (`*IT`) | Un éxito por operación nueva y `/v3/api-docs` con los valores de `operation` |
| Unitario frontend | Las filas nuevas del reducer; `errorMessages` nuevos; mapeo de teclas nuevas |
| Componentes (MSW) | `2 xʸ 10 = 1024`; `9 √ → 3`; `2 + 9 √ = 5`; `20 % 150 = 30`; `4 ± √ → Invalid input`; teclado `@`, `^`, `%`; el `Keypad` tiene 22 botones con sus nombres |
| E2E (Playwright) | **UI:** `2 xʸ 10 = 1024`, `9 √` → `3`, `2 + 9 √ =` → `5`, `20 % 150 =` → `30`, teclado `2^8{Enter}` → `256` y `16@` → `4`, `4 ± √` → `Invalid input`, `10 xʸ 100 =` → `Result too large`, `2 √` → `1.4142135624`; layout a 360 px con **22** botones dentro del viewport. **API (chromium):** las filas de error y orden de esta spec, y un éxito por operación. |

## Queda a criterio del builder

- Cómo representar en el estado del reducer el flag de "el próximo dígito reemplaza" tras una unaria, siempre que cumpla la tabla.
- La estructura interna de la estimación de `power`, siempre que cumpla las cotas y los ejemplos.
- ~~Los estilos de los botones de función.~~ *Lo decidió el usuario:* las 7 operaciones (÷ × − + xʸ % √) comparten el estilo `operator`, y `C`, `⌫` y `±` el estilo `action`.

## Anexo — Tema oscuro / claro (pedido del usuario, 2026-11-15)

- **Por defecto, modo oscuro**, sin importar la preferencia del sistema operativo (`prefers-color-scheme` se ignora).
- **Botón de tema arriba a la derecha de la página**, fuera de la tarjeta de la calculadora. Alterna entre oscuro y claro.
  - Muestra el ícono del modo de destino: ☀ en oscuro, ☾ en claro.
  - `aria-label` exacto: `Switch to light mode` en oscuro y `Switch to dark mode` en claro.
  - Tiene `aria-pressed` o equivalente; queda a criterio del builder.
  - Responde a click, a Enter y a Space cuando tiene foco. No compite con el listener global de teclas: el `Enter` global no debe disparar `=` mientras el foco está en este botón.
- **Persistencia** en `localStorage`, con la clave `sezzle-calculator-theme` y los valores `"dark"` o `"light"`.
  - Todo acceso va en `try/catch`: en modo privado o con storage bloqueado, la app funciona en oscuro sin persistir.
  - Un valor inválido guardado se trata como "no hay preferencia", o sea oscuro.
- **Sin parpadeo:** un script inline mínimo en `frontend/index.html` aplica `document.documentElement.dataset.theme` antes de que monte React. React lee el tema inicial de ese atributo.
- **Colores:** todos los colores pasan a variables CSS definidas en `:root[data-theme="dark"]` y `:root[data-theme="light"]`. Se mantiene la regla de colores del teclado: las 7 operaciones con el mismo color de operador; `C`, `⌫` y `±` en gris de acción; dígitos y `.` aparte; `=` destacado. El contraste del texto es AA en ambos temas.
- **Tests:**
  - Unitarios del módulo de tema: lectura y escritura con storage disponible, bloqueado e inválido.
  - Componente: click alterna, `aria-label` y persistencia.
  - E2E (`e2e/tests/ui-theme.spec.ts`):
    - abre con `html[data-theme="dark"]`;
    - el click pasa a `light`;
    - al recargar sigue en `light`;
    - el botón está dentro del viewport a 360 px;
    - el layout mobile sigue sin scroll horizontal.
