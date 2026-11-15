# Guardrails — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15

## Blocking (sin esto no se integra)

- `make lint` en verde: Spotless con Palantir y ESLint + Prettier.
- Cobertura ≥ 90% en líneas y branches, en backend y frontend.
- TDD: cada cambio de comportamiento entra con su test, escrito primero.
- El contrato `POST /api/v1/calculate` no cambia sin un ADR nuevo, porque lo comparte la futura implementación en Go.
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
- Agregar las operaciones opcionales (`power`, `sqrt`, `percentage`) siguiendo las decisiones diferidas de ADR-001.
- Cuando typescript-eslint soporte TypeScript 7, evaluar la actualización.
