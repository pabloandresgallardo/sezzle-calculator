# ADR-002: Operaciones básicas — modelo de dominio, límites y contrato estricto

Fecha: 2026-11-15
Jira/HDU: Not provided
Estado: Aceptado

## Contexto

Es la primera implementación del contrato `POST /api/v1/calculate` (ADR-001) para `add`, `subtract`, `multiply` y `divide`. ADR-001 no fijaba tres cosas: los límites de los operandos (hay riesgo de DoS por exponentes de BigDecimal y de pérdida de precisión en JavaScript), lo estricto que es el contrato y cómo modelar las operaciones en el dominio. Las tres las va a heredar el backend en Go.

## Decisión

- **Modelo de dominio:**
  - enum `Operation` con comportamiento (`apply`, `fromCode` y `arity`);
  - record `Operand` que valida sus invariantes al construirse;
  - las reglas viven en `domain`, sin Spring.
- **Operandos:** números JSON con límites. Como máximo 15 dígitos significativos, |x| < 10^15 y hasta 10 decimales (tras `stripTrailingZeros`). Se validan en las dos capas.
- **Contrato estricto:**
  - la operación va en minúsculas exactas;
  - un campo desconocido es un error;
  - no se convierten tipos entre string y número.
- **Orden de validación**, parte del contrato: forma → operación → cantidad → límites → cálculo.
- **Normalización de operandos:** `Operand` valida y después guarda el valor con `stripTrailingZeros()`. Así, toda operación trabaja con escala acotada. La revisión final lo agregó tras encontrar un DoS con `0e-999999`.
- **Detalles de contrato que Go debe replicar:**
  - ProblemDetail sin `type` (equivale a `about:blank`) y con `instance`.
  - `detail` en inglés, independiente de `Accept-Language`, y el código de operación recibido truncado a 32 caracteres.
  - Literales numéricos de más de 1000 caracteres → `Malformed request` (límite de Jackson).
  - Claves JSON duplicadas: gana la última (igual que `encoding/json`).
- **`title` estables** como contrato de error: `Division by zero`, `Unsupported operation`, `Invalid operand count`, `Operand out of range`, `Malformed request` e `Internal error`.
- **Herramientas:**
  - **Lombok** solo en los beans de Spring (`@RequiredArgsConstructor`), con `lombok.addLombokGeneratedAnnotation` para que JaCoCo no lo cuente. Esto revierte la línea "sin Lombok" de ADR-001, a pedido del desarrollador.
  - **Records** para DTOs, comandos y value objects.
  - **Sin MapStruct.**
  - **Maven** queda confirmado de forma explícita.
- **Frontend:** reducer puro (máquina de estados), con encadenamiento como el de una calculadora física y `±` / `F9` como en Windows.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|-------------|---------------------|
| Un `@Component` por operación en un `Map` | Mete Spring en el dominio o exige registrar a mano; son 4 clases para 4 líneas |
| Límites con Bean Validation en el DTO | Reglas de negocio en el adapter y dominio vacío; habría que reescribirlas en Go |
| Operandos como strings decimales | Cambia el contrato de ADR-001 y no evita igual los límites contra DoS |
| Aceptar número o string | Contrato ambiguo, el doble de validación y dos formatos para replicar en Go |
| Contrato tolerante (mayúsculas indistintas, campos extra ignorados) | Relajarlo después no rompe clientes; endurecerlo sí |
| MapStruct | Mapeos de 2 campos: sería un annotation processor y clases generadas a cambio de 3 líneas |
| Lombok en todo, incluido el dominio | Los records cubren el dominio; Lombok solo ahorra código en los constructores de los beans |
| Gradle | Un solo módulo: su caché y su DSL no aportan nada notable; Maven ya estaba instalado y validado en CI |
| Una operación por vez en la UI | Menos natural que una calculadora física |
| `−` al inicio para ingresar negativos | Ambiguo en `2 × − 3`; se prefirió `±` como en Windows |

## Consecuencias

- **Positivas:**
  - El costo de cada request queda acotado: el peor caso es `multiply` con 30 dígitos.
  - JavaScript representa exactamente cada operando válido.
  - El contrato es determinista y portable a Go: mismo orden, mismos `title`, mismo rigor.
  - El dominio se testea sin Spring.
- **Negativas / trade-offs:**
  - Hay que mantener los mismos límites en el cliente y en el servidor.
  - El contrato estricto rechaza clientes descuidados (`"ADD"`, campos extra).
  - Un resultado de más de 15 dígitos no se puede encadenar.
  - Lombok suma un annotation processor, que en JDK 23+ hay que declarar de forma explícita.
- **Neutrales:**
  - Las operaciones de la iteración 2 (`power`, `sqrt`, `percentage`) se agregan como constantes nuevas de `Operation`. `arity()` habilita `sqrt` con un solo operando.

## Artefactos relacionados

- Spec: `.ai/docs/specs/2026-11-15-basic-operations.md`
- Plan: `.ai/docs/plans/2026-11-15-basic-operations.md`
- Base: `.ai/decisions/ADR-001-stack-selection.md`
