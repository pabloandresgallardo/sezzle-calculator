# ADR-001: Selección de stack tecnológico

Fecha: 2026-11-15
Jira/HDU: Not provided
Estado: Aceptado

## Contexto

Calculadora fullstack: un frontend React consume un microservicio REST para hacer operaciones aritméticas. El requerimiento prioriza diseño prolijo, código mantenible y arquitectura testeable. Pide React con TypeScript y prefiere Go para el backend. **Esta primera implementación del backend es en Java**; una versión en Go se hará en una etapa posterior y deberá respetar el mismo contrato.

## Decisión

| Capa | Stack |
|------|-------|
| Backend | Java 21 LTS · Spring Boot 4.1.2 (webmvc, validation, actuator) · Maven 3.9 · springdoc-openapi 3.2.0 |
| Arquitectura backend | Hexagonal: `domain` / `application` (port in + service) / `adapter.in.web`. Sin puertos de salida |
| Frontend | Node 22 LTS · React 19.3 · TypeScript 6.0.3 (strict) · Vite 8.3 · CSS Modules |
| Arquitectura frontend | Feature-based, con Atomic Design dentro de cada feature |
| Estado / HTTP | `useReducer` en `useCalculator` · `fetch` tipado en `calculatorApi` |
| Testing | TDD · JUnit 5, `@WebMvcTest`, `@SpringBootTest` RANDOM_PORT · Vitest 5.1, Testing Library 16, MSW 3 · Playwright 1.65 |
| Calidad | JaCoCo 0.8.16 y v8 con gate de 90% · Spotless 3.11 (Palantir) · ESLint 10 + typescript-eslint 8.72 + Prettier 3.10 |
| Infra | Dockerfile por capa · nginx como front y proxy de `/api` · docker-compose (dev y test aislado) · GitHub Actions |

**Contrato**: `POST /api/v1/calculate` con `{operation, operands[]}`. Responde `200 {operation, result}`, con `result` como string decimal, o `400` ProblemDetail (RFC 9457).

**Números**: `BigDecimal`. La división usa escala 10 con `HALF_EVEN` y quita los ceros finales.

**Alcance v1**: `add`, `subtract`, `multiply` y `divide`.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|-------------|---------------------|
| Backend en Go (lo que prefiere el requerimiento) | Se difiere: se hace después y debe respetar el mismo contrato |
| Layered MVC (Java) | Acopla el dominio a Spring y dificulta la portabilidad a Go |
| CQRS | No hay lecturas ni escrituras separadas: sería complejidad sin beneficio |
| Spring Boot 3.4 / 3.5 | Sin soporte open source a noviembre de 2026 |
| Spring Boot 4.0 | Su soporte termina antes que el de 4.1 y no ofrece ninguna ventaja |
| Lombok | Los records de Java 21 cubren DTOs y value objects |
| Endpoint por operación (`/operations/add`) | Más rutas y más superficie del contrato a replicar en Go. Se prefirió extender un enum |
| Evaluar expresiones (`"2+3*4"`) | Exige un parser y va más allá del requerimiento |
| `double` | Errores de redondeo visibles (`0.1 + 0.2`) y hay que filtrar NaN e Infinity a mano |
| `result` como número JSON | JavaScript lo pasa a double y pierde la precisión de BigDecimal |
| Node 26 | No es LTS |
| React 18 | Sin soporte activo |
| TypeScript 7.0 | typescript-eslint 8.72 solo soporta TS `<6.1`, así que se perdería el lint con chequeo de tipos |
| Frontend layer-based / Atomic puro | Layer-based escala peor por dominio; Atomic puro agrega mucho overhead para este alcance |
| Tailwind CSS | Llena el JSX de clases y los atoms quedan como wrappers de clases |
| styled-components | Agrega trabajo en runtime y una dependencia sin beneficio |
| Zustand / Redux Toolkit | El estado es local de una sola feature: alcanza con `useReducer` |
| UI de formulario (dos inputs + selector) | Es menos intuitiva como calculadora. Su ventaja de validación se conserva aceptando entrada por teclado físico |
| Cypress | WebKit experimental y paralelizar en CI es más complicado |
| Google Java Format | Indentación de 2 espacios y líneas de 100: se lee peor con lambdas |
| Configurar CORS | Innecesario: el proxy de Vite y el de nginx sirven todo desde el mismo origen |
| Puertos 8080 / 5173 | Ocupados por otros contenedores en la máquina de desarrollo; se usan 8090, 5180 y 3000, configurables |

## Decisiones diferidas (operaciones opcionales)

Se implementan en una etapa posterior. Lo que ya está acordado:

| Operación | Operandos | Regla |
|-----------|-----------|-------|
| `percentage` | `[a, b]` | a% de b: `percentage [20, 150] = 30` |
| `power` | `[base, exponent]` | El exponente es entero, entre -1000 y 1000. Fuera de eso → `400`, como protección contra DoS |
| `sqrt` | `[a]` | `a < 0` → `400`. Resultado con escala 10 `HALF_EVEN` |

Al agregarlas, la validación de cantidad de operandos pasa a depender de cada operación.

## Consecuencias

- **Positivas:**
  - El dominio queda puro y es portable a Go.
  - El contrato es único y está documentado en OpenAPI.
  - Precisión decimal exacta.
  - Los E2E están aislados en un puerto efímero.
  - El 90% de cobertura viene garantizado por TDD y no hay que perseguirlo después.
- **Negativas / trade-offs:**
  - Spring Boot 4 y Jackson 3 tienen menos material de referencia.
  - Hexagonal agrega indirección para un dominio chico.
  - Exigir 90% de branches obliga a testear cada rama de error.
  - TypeScript queda fijado en 6.0 hasta que typescript-eslint soporte TS 7.
  - typescript-eslint trae vulnerabilidades moderadas por `minimatch`, solo en desarrollo; no llegan al bundle de producción.

## Artefactos relacionados

- Fundaciones: `.ai/architecture.md`
- Diagrama de arquitectura: `.ai/diagrams/architecture-overview.png` (fuente `.mmd`)
- Flujo de datos: `.ai/diagrams/data-flow.png` (fuente `.mmd`)
- Testing: `.ai/testing.md` · Guardrails: `.ai/guardrails.md`
