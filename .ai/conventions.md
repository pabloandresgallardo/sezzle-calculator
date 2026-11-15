# Convenciones — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15

## Generales

- Código, identificadores y mensajes de la API en **inglés**. Documentación de `.ai/` en español.
- Commits con [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`, `ci:`. Scope opcional: `feat(backend):`, `feat(frontend):`, `test(e2e):`.
- Versionado semver; la versión inicial es `0.1.0`.
- Sin trailers `Co-Authored-By` en los commits.

## Backend (Java 21)

- Formato con **Palantir Java Format** vía Spotless 3.11.0. `make format` lo aplica y `make lint` lo verifica, y también corre en `mvn verify`.
- Records para DTOs, comandos y value objects. Sin Lombok.
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
