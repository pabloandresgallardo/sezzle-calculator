# Convenciones — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15 · evidencia verificada — 2026-11-15

## Evidencia observada

| Convención | Fuente |
|------------|--------|
| Palantir Java Format + `removeUnusedImports` + `importOrder` (Spotless 3.11.0, `check` en la fase `verify`) | `backend/pom.xml` |
| ESLint: `strictTypeChecked`, `react-hooks`, `react-refresh`, `eslint-config-prettier` | `frontend/eslint.config.js` |
| Prettier: `singleQuote`, `trailingComma: all`, `printWidth: 100` | `frontend/.prettierrc` |
| TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` | `frontend/tsconfig.json` |
| Conventional Commits (`chore: …`) | `git log` |
| Tests `*IT` en failsafe | `backend/pom.xml` (failsafe 3.6.1, con los includes por defecto) |
| Records en dominio y DTOs (`Operand`, `CalculationResult`, `CalculateCommand`, `CalculationRequest`, `CalculationResponse`) | `backend/src/main/java/com/sezzle/calculator/**` |
| Dominio sin Spring ni Lombok | `domain/**` (sin imports `org.springframework` ni `lombok`) |
| Lombok `@RequiredArgsConstructor` en el controller; `lombok.config` con `addLombokGeneratedAnnotation` | `adapter/in/web/CalculatorController.java`, `backend/lombok.config` |
| Lombok en `annotationProcessorPaths` (JDK 23+) y excluido del jar | `backend/pom.xml` |
| Componentes en PascalCase con `.module.css` y `.test.tsx` al lado | `frontend/src/features/calculator/{atoms,molecules,organisms}/` |
| Selectores E2E por rol y `aria-label` | `e2e/tests/helpers.ts` |

## Generales

- Código, identificadores y mensajes de la API en **inglés**. Documentación de `.ai/` en español.
- Commits con [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`, `ci:`. Scope opcional: `feat(backend):`, `feat(frontend):`, `test(e2e):`.
- Versionado semver; la versión inicial es `0.1.0`.
- Sin trailers `Co-Authored-By` en los commits.

## Backend (Java 21)

- Formato con **Palantir Java Format** vía Spotless 3.11.0. `make format` lo aplica y `make lint` lo verifica, y también corre en `mvn verify`.
- Records para DTOs, comandos y value objects. Lombok solo en beans de Spring (`@RequiredArgsConstructor`), nunca en `domain` (ADR-002). Sin MapStruct.
- El dominio no importa `org.springframework.*`.
- Errores de dominio como excepciones propias en `domain.exception`, que se traducen a ProblemDetail en `adapter.in.web`.
- Nombres de tests: `*Test` para unitarios (surefire) y `*IT` para integración (failsafe).
- Inyección por constructor, sin `@Autowired` en campos.

## Frontend (React 19 + TypeScript 6)

- TypeScript `strict` con `noUncheckedIndexedAccess`. No usar `any`.
- ESLint 10 con `typescript-eslint` `strictTypeChecked`, `react-hooks` y `react-refresh`. Prettier con comillas simples, trailing commas y ancho 100.
- Componentes en PascalCase, uno por archivo: `CalcButton.tsx` con `CalcButton.module.css` y `CalcButton.test.tsx` al lado.
- Hooks con prefijo `use`. La comunicación HTTP vive solo en `calculatorApi.ts`.
- Atoms presentacionales: reciben props y no llaman hooks de dominio.
- Accesibilidad: botones con `aria-label` y el display con `role="status"` / `aria-live` para que se anuncien los resultados y errores.

## E2E

- Un archivo por escenario: `tests/basic-operations.spec.ts`, `tests/errors.spec.ts`, `tests/edge-cases.spec.ts`.
- Selectores por rol y nombre accesible (`getByRole`), no por clases CSS.

## Backend Go (`backend-go/`)

- `gofmt` y `go vet` limpios, verificados por `make lint-go` y en CI. Solo biblioteca estándar, sin dependencias externas salvo que un ADR diga lo contrario.
- Mismo hexágono que Java: `internal/decimal` (aritmética decimal con semántica de BigDecimal), `internal/domain` (operandos, tabla de operaciones con `apply`/`arity`/`validate`, errores tipados con los mensajes exactos de Java), `internal/app` (pipeline de validación) e `internal/httpapi` (transporte). El dominio no importa `net/http`.
- Los errores de dominio son tipos (`*OperandOutOfRangeError`, `*InvalidOperandError`, …) y se mapean a `title` solo en `httpapi`.
- Sobre un valor recién parseado solo se usan `Precision`, `Scale`, `Signum`, `StripTrailingZeros` y `Cmp`; toda la aritmética corre sobre operandos ya normalizados (evita materializar `10^n` con exponentes enormes).
- Tests de tabla con `t.Run`; los casos del contrato viven en `contract/parity-cases.json`, no se duplican en Go.
- En máquinas con `GO111MODULE=off` los comandos se corren con `GO111MODULE=on` (el Makefile ya lo hace).
