# Arquitectura — sezzle-calculator

Fuente: intención de proyecto — 2026-11-15

## Visión

Calculadora fullstack en un monorepo. El frontend React consume un único endpoint REST del backend Java. El backend es **stateless**: no persiste nada ni tiene puertos de salida.

Diagramas: `.ai/diagrams/architecture-overview.png`, `.ai/diagrams/data-flow.png`.

## Estructura del repositorio

| Carpeta | Contenido |
|---------|-----------|
| `backend/` | Microservicio Java 21 + Spring Boot 4.1.2 (Maven) |
| `frontend/` | SPA React 19.3 + TypeScript 6.0 + Vite 8 |
| `e2e/` | Suite Playwright 1.65 contra el stack dockerizado |
| `.ai/` | Documentación de ingeniería, ADRs y diagramas |

## Backend — Hexagonal (ports & adapters)

Paquete raíz `com.sezzle.calculator`:

| Paquete | Responsabilidad | Depende de |
|---------|-----------------|------------|
| `domain.model` | `Operation`, operandos y reglas de cálculo con BigDecimal. Java puro | nada |
| `domain.exception` | Errores de dominio (por ejemplo, divisor cero) | nada |
| `application.port.in` | `CalculateUseCase`, el puerto de entrada | domain |
| `application.service` | `CalculatorService`, implementa el puerto | domain |
| `adapter.in.web` | `CalculatorController`, DTOs (records) y handler de ProblemDetail | application |
| `config` | Wiring de Spring (excluido de la cobertura) | todos |

Regla de dependencia: `adapter → application → domain`. El dominio no importa nada de Spring, así la lógica se puede portar a Go sin cambios conceptuales.

Sin puertos de salida: el servicio no tiene historial ni persistencia en la v1.

## Contrato REST (v1)

```
POST /api/v1/calculate
Content-Type: application/json

{ "operation": "add" | "subtract" | "multiply" | "divide", "operands": [number, number] }
```

| Caso | Respuesta |
|------|-----------|
| Éxito | `200 {"operation": "divide", "result": "2"}`: `result` es un **string** decimal |
| Operación desconocida, cantidad de operandos inválida, número malformado | `400` ProblemDetail (RFC 9457) |
| Divisor cero | `400` ProblemDetail, `title: "Division by zero"` |

Reglas numéricas:
- Todo se calcula con `BigDecimal`. `result` viaja como string para que JavaScript no lo pase a double y pierda precisión.
- La división usa escala 10 con `RoundingMode.HALF_EVEN` y quita los ceros finales.

El contrato es **compartido con la futura implementación en Go**: el frontend no debe cambiar al reemplazar el backend.

Otros endpoints: `GET /actuator/health`, `GET /v3/api-docs`, `GET /swagger-ui.html`.

## Frontend — Feature-based + Atomic interno

```
src/
  features/calculator/
    atoms/        botones y display: presentacionales, sin estado
    molecules/    filas del teclado y display con error
    organisms/    CalculatorPanel: compone todo
    useCalculator.ts   máquina de estados con useReducer
    calculatorApi.ts   fetch tipado; traduce ProblemDetail a un error tipado
  shared/         elementos reutilizables entre features
  test/setup.ts
```

- Estilos con CSS Modules, uno por componente.
- Interacción con teclado en pantalla y teclado físico: `Enter` equivale a `=` y `Esc` a `C`. El display acepta escribir y pegar texto, con validación de números mal formados en el cliente.

## Red y despliegue

| Entorno | Front | Back | Cómo llega `/api` |
|---------|-------|------|-------------------|
| Desarrollo | Vite `:5180` | `mvn spring-boot:run` `:8090` | proxy de Vite |
| docker-compose | nginx `:3000` | contenedor `:8090` | proxy de nginx |
| E2E | nginx en puerto efímero | contenedor interno | proxy de nginx |

Front y back comparten origen en todos los entornos, así que **no se configura CORS**.

## Alcance diferido

`power`, `sqrt` y `percentage` se agregan en una etapa posterior. Las decisiones ya tomadas están en ADR-001.
