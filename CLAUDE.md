# CLAUDE.md — Contexto para Claude Code

> Leé este archivo primero y completo. Después, la fuente de verdad funcional está en
> `specs/`: el brief `specs/2026-09-10-simulador-BRIEF-para-implementar.md` (qué se
> construyó y con qué reglas), el documento de ideas `specs/2026-09-10-simulador-tablero-de-migracion.md`
> (el porqué) y `specs/disponibilidad-por-persona-y-ano.md` (duraciones por horas).
> Lo que hay en `docs/_archivo/` describe un producto que ya no existe: no lo uses.

---

## 1. Qué es

El **tablero con el que Willy revisa el programa de migración Meta4 → Axton con los
stakeholders**. Un sitio estático (React + Vite + TypeScript + Zustand + date-fns), sin
backend, desplegado a GitHub Pages desde `main`. El plan vive en un JSON que se importa y
exporta; el seed de `data/` es solo un punto de partida.

Cuatro pestañas más una:
- **Timeline**: personas en filas, semanas en columnas, fases como barras arrastrables.
- **Insights**: para gerencia. Cuándo termina la migración, trimestre a trimestre, y la ola.
- **Equipo**: para el equipo de payroll. Horas por persona y mes contra capacidad, el
  solapamiento explicado en prosa, quién hace qué en cada cuenta, salidas por mes, insumos.
- **Resumen**: el mismo relato para gerencia, como video de 45 s (1920×1080). Todo lo que
  dice y dibuja sale del plan cargado (`src/resumen/`), nada está escrito en el componente.
- **Disponibilidad del equipo** (confidencial): solo aparece si el plan importado trae
  `config.equipo_confidencial`. Ver §5.

Qué NO es: no reemplaza a Monday (Monday sigue siendo la ejecución), no se conecta a su API,
no maneja datos personales. TASA/Toyota y TPA están fuera del plan.

## 2. El modelo

**Tres fases por cuenta**: Relevamiento → Configuración → Pruebas. Nada de UAT, Paralelo ni
gates. Una cuenta la trabajan varias personas a la vez (Willy y Moni configuran en paralelo;
Gaby, Moni y Willy prueban): **el solapamiento es el diseño, no una falla**.

**Capacidad, todo en horas** (`src/capacidad.ts`, el único lugar con esta matemática):
- Jornada disponible: **7 h por día hábil** (`config.capacidad.horas_dia_default`). Gaby
  tiene `horas_dia: 4` en su persona.
- `dedicacion_pct` es la fracción de esa jornada que una fase consume.
- Horas de una fase en un mes = días hábiles de la fase en ese mes × horas_dia × dedicación.
- Capacidad de una persona en un mes = días hábiles del mes × horas_dia × disponibilidad.
- Disponibilidad por mes: bloque confidencial si lo hay; Moni por fórmula
  (`max(piso, base − caída × (cuentas en Axton − base))`, perillas en `config.capacidad`);
  quien tiene `horas_dia` propio, 1,0; el resto, `config.disponibilidad` por año.

**Mes de salida en vivo es dato** (`config.salidas_en_vivo_propuestas`), no se deduce del
fin de las fases. POF y Finadiet salen sin fases (`salidas_en_vivo_fuera_del_plan`).

## 3. Las reglas (`src/rules.ts`)

| tipo | severidad | qué controla |
|---|---|---|
| `carga_mes` | rojo | horas de una persona en el mes > su capacidad |
| `carga_semana` | ámbar | horas en la semana > capacidad × `aviso_semanal_tolerancia` (aviso) |
| `tope_salidas` | rojo / info | más salidas en vivo en un mes que `tope_salidas_en_vivo_por_mes`; 3 se permiten si 2 son tier chico (informativo) |
| `margen` | rojo | menos de `margen_minimo_habiles` días hábiles entre el fin de Pruebas y el corte de novedades (el día del corte cuenta) |
| `blackout` | rojo | una Configuración toca `tiers_v3.blackout_config` |
| `dependencia` | rojo | Pruebas arranca antes o el mismo día en que cierra la Configuración de su cuenta, sin importar la persona |

Los mensajes son para un gerente: nombran cuenta, fase y fecha en `dd/mm`. Nunca un id.

Con el plan v3 (`test/fixtures/plan-v3.json`) el resultado esperado es: 0 dependencia,
0 margen, 0 blackout, 0 tope en rojo, 1 informativo (marzo 2027), 1 rojo de carga
(enero 2027 de Willy) y algunos avisos semanales. Si cambia, algo se rompió.

## 3.1 El video del resumen (`src/resumen/`)

Cuatro archivos, una responsabilidad cada uno:

- `derivarResumen.ts` — función pura `(personas, proyectos, asignaciones, config, hoy) →
  ResumenData`: cuántas cuentas hay en Axton, las salidas por trimestre y por mes, cuándo
  cierra el programa, el mes crítico con su gantt y las dos alertas. Reusa `capacidad.ts`
  y `rules.ts`; no duplica matemática. **Nunca lee `equipo_confidencial`.**
- `guion.ts` — los textos y los tiempos. Cada string es una función de `ResumenData`.
- `motion.ts` — los tres únicos movimientos (`enter`, `draw`, `pop`) y el easing.
- `ResumenAnimado.tsx` — un reloj `T` y un árbol siempre montado; todo se dibuja como
  función pura de `(T, data)`. La paleta va literal (no `var(--celeste)`): el lienzo es
  blanco fijo y no puede cambiar con el modo oscuro de quien lo mira.

El mes crítico es el de la primera alerta roja de `carga_mes`, y las cuentas que muestra
son las de la persona sobrecargada. Con el plan v3: enero 2027, Copetro, Campari, Marval y
Lowsedo. La referencia de diseño está en `docs/handoff/resumen-animado/`.

## 4. Datos

- `data/` es el seed. Alias, nunca nombres reales. Los campos en `null` se muestran como
  "sin definir", no se rellenan.
- El JSON exportado es contrato: las claves existentes de `Asignacion`, `Persona`,
  `Proyecto` y `Config` no se renombran ni se quitan; solo se agregan opcionales, siempre al
  tipo (`src/types.ts`) y al JSON a la vez.
- Al importar, `src/validacionPlan.ts` (Zod) valida forma y referencias. Errores de forma
  frenan el import con un cartel legible; una fase con persona inexistente entra y se ve en
  la fila "Sin asignar" del timeline.
- Leo y Lucas no son personas del plan: no tienen fases de migración. Solo aparecen en el
  bloque confidencial como AS IS / TO BE del equipo.

## 5. Confidencialidad (regla dura)

Los datos de disponibilidad del equipo (`config.equipo_confidencial`) **nunca entran al
repo, al seed ni al deploy**. Viven solo en el JSON local de Willy. `conFallbackDeSeed`
nunca rellena esa clave. La contraseña de la pestaña es una cortina, no una llave: en el
código va solo su hash SHA-256 (`src/confidencial.ts`), el desbloqueo vive en
`sessionStorage` atado a la carga de la página, y el export omite el bloque si la sesión está
bloqueada. Si ves la contraseña o un dato del bloque en un archivo del repo, es un error.

Privacidad general: nunca nombres reales de personas, CUIT, CUIL, sueldos ni legajos. Lo
que falta se escribe como `[FALTA: ...]` visible, nunca se estima.

## 6. Cómo trabajar

- Cada tramo de trabajo es un PR contra `main` con sus tests en `test/` (esbuild + node,
  sin framework; `npm test` los corre todos, también en CI antes del build).
- Por el `&` de la ruta de OneDrive, en la notebook de Willy los shims de npm fallan: usar
  `node node_modules/vite/bin/vite.js`, `node node_modules/typescript/bin/tsc` y
  `node node_modules/esbuild/bin/esbuild ...` directo.
- Verificar en el navegador importando el plan v3 antes de dar algo por hecho.
- Comentarios, labels y mensajes en español (Argentina). Nombres de variables en inglés
  está bien.
