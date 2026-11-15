# ADR-005: Backends en `backend/java` y `backend/go`, y Go como backend por defecto

Fecha: 2026-11-15
Jira/HDU: Not provided
Estado: Aceptado

## Contexto

Antes de entregar el challenge, dos cosas no reflejaban lo que pide la consigna, que prefiere Go para el backend:

- La estructura ponía Java en `backend/` y Go en `backend-go/`. Eso hacía que Go pareciera un agregado lateral y no un backend con el mismo peso.
- La app abría con Java seleccionado (ADR-004). Un evaluador que la abre veía Java primero.

## Decisión

- **Estructura:** los dos backends viven bajo `backend/`, uno por carpeta: `backend/java/` y `backend/go/`.
  - Se movieron con `git mv` para conservar el historial.
  - El module path de Go pasa a ser `github.com/pabloandresgallardo/sezzle-calculator/backend/go`.
  - Se actualizaron las rutas relativas al contrato en los tests: Java usa `../../contract`, Go usa `../../../../contract`.
  - También se actualizaron los build contexts de Compose, el Makefile y el CI. El job de CI `backend` pasa a llamarse `backend-java`.
- **Go por defecto:** `DEFAULT_BACKEND = 'go'`, y el selector muestra `Go | Java`, con Go primero.
  - Las reglas de ADR-004 no cambian, solo se intercambian los roles: la selección no se persiste, el fallback por salud sigue igual, y tras una recuperación la app vuelve sola al backend por defecto, salvo que el usuario haya elegido el otro.
  - Java sigue siendo la **referencia de comportamiento** del contrato: los casos de `contract/parity-cases.json` salen de respuestas reales de Java.
- **Compatibilidad:** se mantiene todo lo que ADR-004 dejó como compatible.
  - Los nombres de servicio en Compose (`backend-java`, `backend-go`) y el alias `backend`.
  - `/api/v1/calculate` hacia Java.
  - Las variables viejas.
  - Los targets de Make `test-backend` y `run-backend`, que quedan como alias de `test-java` y `run-java`.

## Alternativas consideradas

| Alternativa | Por qué descartada |
|-------------|-------------------|
| Mantener `backend/` (Java) y `backend-go/` | La estructura sugiere un backend principal y uno secundario; con dos implementaciones del mismo contrato, la simetría es más clara |
| Mantener Java por defecto y explicarlo en el README | La consigna prefiere Go; el evaluador debería ver Go al abrir la app sin tener que leer nada |
| Renombrar también los servicios de Compose (`java`, `go`) | Rompe a quien ya usa `backend-java` o el alias `backend` y no aporta claridad extra |
| Persistir la elección del usuario | Fuera de alcance; ADR-004 ya decidió no persistirla |

## Consecuencias

- **Positivas:**
  - La estructura muestra las dos implementaciones con el mismo peso.
  - Lo primero que ve el evaluador es Go.
  - Ningún consumidor existente se rompe.
- **Negativas / trade-offs:**
  - Cambian rutas que estaban documentadas en ADRs anteriores. ADR-001 a ADR-004 quedan como registro histórico con las rutas de su momento, y la documentación vigente usa las nuevas.
  - Quien tenga un clon viejo debe reconstruir las imágenes, porque cambian los build contexts.
- **Neutrales:**
  - Las capturas de `docs/screenshots/` muestran el selector con el orden anterior (`Java | Go`). Siguen siendo correctas como ejemplo de cada backend.

## Artefactos relacionados

- ADR-004: `.ai/decisions/ADR-004-backend-go-paridad-y-seleccion.md`
- Tests que fijan el default: `frontend/src/shared/backend/useBackends.test.ts`, `BackendSelector.test.tsx`, `frontend/src/app/App.test.tsx`, `e2e/tests/ui-backend.spec.ts`
