# Simulador de Migración — tablero del programa Meta4 → Axton

Tablero con el que se revisa el programa de migración con los stakeholders: timeline de fases
por persona, avance por trimestre para gerencia, y la pestaña Equipo con horas contra
capacidad, solapamientos explicados, quién hace qué y salidas por mes.

Deploy automático a `https://bhidalgo-ar.github.io/planmigracion/` en cada push a `main`.

## Correr localmente

```bash
npm install
npm run dev
```

Si la carpeta está bajo una ruta con `&` (OneDrive de H&A), los shims de npm fallan:
`node node_modules/vite/bin/vite.js` en lugar de `npm run dev`, y lo mismo para `tsc` y
`esbuild`.

Tests: `npm test` (o cada suite con `node node_modules/esbuild/bin/esbuild test/<x>.test.ts ...`).

## Mapa

```
CLAUDE.md          ← contexto para Claude Code: modelo, reglas, confidencialidad (leer primero)
specs/             ← fuente de verdad funcional (brief, documento de ideas, spec de duraciones)
data/              ← seed: personas, proyectos, asignaciones, config (solo alias)
src/
  capacidad.ts     ← la matemática de horas (única)
  rules.ts         ← las seis reglas del programa
  validacionPlan.ts← Zod: valida el JSON al importar
  confidencial.ts  ← pestaña confidencial (hash, sesión, vista)
  insights*.ts     ← lógica de Insights y Equipo
  components/      ← UI
test/              ← suites (esbuild + node) y el fixture del plan v3
docs/_archivo/     ← documentos del producto anterior, solo históricos
```

## Privacidad

Solo alias y nombres comerciales de cuenta. Nunca nombres de empleados, CUIT/CUIL, sueldos
ni legajos. Los datos de disponibilidad del equipo no están en el repo: viven en el JSON
local que se importa, y la pestaña que los muestra solo existe si el plan los trae.
