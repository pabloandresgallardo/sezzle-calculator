# ADR-003: Operaciones opcionales — Strategy generalizado, errores nuevos y teclado 4×6

Fecha: 2026-11-15
Jira/HDU: Not provided
Estado: Aceptado

## Contexto

Se agregan `power`, `sqrt` y `percentage`, los requisitos opcionales del challenge. El Strategy con enum de ADR-002 tenía una firma binaria (`apply(Operand, Operand)`) y validación genérica, pero `sqrt` es unaria y cada operación nueva necesita reglas propias. El usuario pidió que los botones nuevos estén **visibles directamente** en el teclado.

## Decisión

- **Backend:** generalizar el Strategy con enum:
  - `apply(List<Operand>)`;
  - `arity()` que cada constante puede sobrescribir (`SQRT` = 1);
  - un hook `validate(List<Operand>)` que se ejecuta después de los límites genéricos y antes del cálculo.
- **Errores nuevos de contrato:**
  - `Invalid operand`: `√` de un negativo, o exponente no entero.
  - `Result out of range`: un resultado de `power` con más de 100 dígitos enteros.
  - El exponente fuera de [−1000, 1000] sigue siendo `Operand out of range`.
- **Cota de costo de `power`:** antes de calcular se estima `L = e·log10|base|`.
  - `L > 101`: se rechaza sin calcular.
  - `L < −11`: se responde `0` sin calcular.
  - Después de calcular, verificación exacta.
- **Teclado 4×6 estilo Windows con 22 botones:**
  - fila nueva `C ⌫ % ÷` / `xʸ √ ± ×`;
  - `=` ocupa dos filas;
  - sin menú de "más operaciones".
- **Comportamiento de la UI:**
  - `√` es unaria e inmediata, como en Windows.
  - `xʸ` y `%` son binarias y encadenan.
  - `%` es "a% de b", como fijó ADR-001; no es el `%` contextual de Windows.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|-------------|---------------------|
| `sealed interface` con enums binario y unario y `switch` con pattern matching | Más piezas, `fromCode` sobre dos enums y menos directo de portar a Go. El enum generalizado resuelve lo mismo |
| Mantener `apply(Operand, Operand)` con un operando ficticio para `sqrt` | Parche que rompe la validación de cantidad |
| Reutilizar `Operand out of range` para `√(-4)` | La UI mostraría "Number out of range", y el número no está fuera de rango |
| `power` sin límite de resultado | Hasta 15.000 dígitos (unos 15 KB) por request y un display ilegible |
| Limitar el resultado a 15 dígitos (los mismos límites que los operandos) | Demasiado restrictivo: `2^60` sería un error |
| Teclado de 5 columnas | Botones de unos 52 px a 360 px y una celda vacía |
| Fila de funciones agregada arriba del teclado actual | Deja una celda vacía o un botón ancho sin sentido |
| Botón "más operaciones" o menú | Descartado de forma explícita por el usuario |
| `%` contextual de Windows (`150 + 10 %` → `165`) | Contradice ADR-001 y depende del operador pendiente |

## Consecuencias

- **Positivas:**
  - Cada operación vive en un solo lugar (cálculo, aridad y validación), con el mismo patrón que en la iteración 1.
  - El costo de `power` queda acotado incluso en los peores casos.
  - Los errores son claros para el usuario ("Invalid input", "Result too large").
  - El teclado mantiene la posición de los dígitos y de la columna de operadores.
- **Negativas / trade-offs:**
  - El contrato suma 2 `title` que Go tiene que replicar.
  - La estimación con `double` necesita un margen y una verificación exacta.
  - El reducer suma el estado "el próximo dígito reemplaza" después de `√`.
  - `±` cambia de posición en el teclado.
- **Neutrales:**
  - `percentage` es exacto, igual que `multiply`.
  - `sqrt` y `power` redondean a escala 10 con `HALF_EVEN`, igual que `divide`.

## Artefactos relacionados

- Spec: `.ai/docs/specs/2026-11-15-optional-operations.md`
- Plan: `.ai/docs/plans/2026-11-15-optional-operations.md`
- Base: ADR-001 (decisiones diferidas), ADR-002 (contrato y límites)

## Anexo — Tema oscuro / claro (2026-11-15)

**Decisión:**
- Modo oscuro por defecto, sin mirar la preferencia del sistema operativo (pedido del usuario).
- Un botón de tema arriba a la derecha de la página.
- La elección se guarda en `localStorage`, con todos los accesos en `try/catch`.
- Un script inline en `index.html` aplica el tema antes de que monte React, para evitar el parpadeo.
- Los colores pasan a variables CSS por tema.

| Alternativa | Por qué se descartó |
|-------------|---------------------|
| Seguir `prefers-color-scheme` | El usuario pidió oscuro por defecto |
| Botón dentro de la tarjeta, arriba del display | Le suma altura a la calculadora en mobile; el usuario eligió la esquina de la página |
| Guardar el tema en el estado de React solamente | Se pierde al recargar |
| Aplicar el tema en un `useEffect` | Provoca un frame en claro al cargar |

## Anexo — Colores del teclado y teclado físico (2026-11-15)

- **Colores (decisión del usuario):** las 7 operaciones (÷ × − + xʸ % √) comparten el estilo `operator`; `C`, `⌫` y `±` comparten `action`. Se descartó separar `√` (inmediata) de `xʸ` y `%` (binarias) por color, porque visualmente se leía como un error.
- **Teclado físico (hallazgo de la revisión final):** en los layouts en español, `@` se escribe con AltGr u Option, que antes quedaban filtrados. Por eso `√` no tenía atajo. Ahora `@`, `^` y `%` se aceptan con AltGr (`getModifierState('AltGraph')`) u Option, y el resto de las combinaciones con Ctrl, Alt o Meta se siguen ignorando. Alternativa descartada: sumar una tecla nueva para √ (por ejemplo `r`), porque se aleja de la convención de Windows que el usuario tomó como referencia.
