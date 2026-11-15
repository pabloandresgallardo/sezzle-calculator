# Guardrails — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15 · evidencia verificada — 2026-11-15

## Evidencia observada

| Guardrail | Cómo se hace cumplir | Fuente |
|-----------|----------------------|--------|
| Lint obligatorio | `spotless:check` en `verify`; `npm run lint` en CI | `backend/java/pom.xml`, `.github/workflows/ci.yml` |
| Cobertura ≥ 90% | `jacoco:check`; umbrales de Vitest | `backend/java/pom.xml`, `frontend/vite.config.ts` |
| `.env` fuera del repo | ignorado | `.gitignore` |
| Puertos configurables | `SERVER_PORT` (Java), `PORT` (Go), `WEB_PORT`, `BACKEND_JAVA_PORT`, `BACKEND_GO_PORT`, `VITE_PORT`, `VITE_JAVA_TARGET`, `VITE_GO_TARGET`; `make up` busca puertos libres | `application.yml`, `backend/go/cmd/server`, `vite.config.ts`, `docker-compose.yml`, `scripts/up.sh` |
| Paridad Java == Go | `ContractParityIT`, `TestParityCases`, `e2e/tests/parity.spec.ts` sobre `contract/parity-cases.json` | `contract/` |
| Contrato estable con `title` exactos y orden de validación | `CalculatorControllerTest` (todas las filas de la spec) y `e2e/tests/api-contract.spec.ts` | ADR-002 |
| BigDecimal en todo el cálculo; `result` como string | `Operation.apply`, `CalculationResult.formatted()` | `backend/java/.../domain/model/` |
| Límites de operando y normalización (anti-DoS) | `Operand` + `OperandTest` (exponentes extremos, cero con exponente enorme con `@Timeout`) | `backend/java/.../domain/model/` |
| Dominio sin Spring | sin imports de Spring ni Lombok en `domain/**` | `backend/java/.../domain/` |
| ProblemDetail sin stack trace; `detail` en inglés y acotado | `ProblemDetailHandler` + tests | `backend/java/.../adapter/in/web/` |

## Blocking (sin esto no se integra)

- `make lint` en verde: Spotless con Palantir y ESLint + Prettier.
- Cobertura ≥ 90% en líneas y branches, en backend y frontend.
- TDD: cada cambio de comportamiento entra con su test, escrito primero.
- El contrato `POST /api/v1/calculate` no cambia sin un ADR nuevo, y cualquier cambio se hace a la vez en Java, Go y `contract/` (los tres tests de paridad tienen que pasar).
- Go usa solo la biblioteca estándar; no se agregan dependencias sin un ADR.
- `result` es siempre un string decimal. Nunca `double` ni `float` en el cálculo del backend.
- El dominio del backend no depende de Spring.
- Sin secretos ni configuración sensible en el repo. `.env` está en `.gitignore` y solo se versiona `.env.example`.
- Todo error de la API sale como ProblemDetail (RFC 9457). No se exponen stack traces.

## Required

- Validar la entrada en las dos capas: el cliente valida el formato numérico y el servidor el contrato completo.
- Que los E2E cubran éxito, error y bordes antes de cerrar una feature.
- Puertos configurables por variables: no hardcodear `8080` ni `5173`.
- Versiones de dependencias fijadas, con lockfiles versionados.

## Guidance

- Preferir composición de atoms y molecules antes que componentes grandes.
- Mantener la UI usable a 360 px de ancho.
- Para una operación nueva: agregar una constante en el enum `Operation`, con `apply`, `arity` y `validate` si hace falta. No agregar rutas ni `switch`.
- Mantener la regla de colores del teclado: todas las operaciones con el estilo `operator`, y `C`, `⌫` y `±` con el estilo `action`. Los colores nuevos se definen como variables en los dos temas.
- Cuando typescript-eslint soporte TypeScript 7, evaluar la actualización.
