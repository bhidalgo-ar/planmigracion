# Replanificar desde el corte — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cambiar el mes de salida en vivo de una cuenta (desde el panel de la cuenta) rearme sus fases hacia atrás desde el corte de novedades de ese mes, con las mismas reglas que hoy aplica el script Python `armar_calendario_migracion.py`, actualice `config.salidas_en_vivo_propuestas` y muestre antes de elegir en qué meses la cuenta entra y en cuáles no.

**Architecture:** Un módulo puro nuevo, `src/planificador.ts`, porta el algoritmo del script (pruebas → configuración → relevamiento hacia atrás desde el corte; cierre pegado al corte) sobre las barras que la cuenta ya tiene (conserva id, persona, duración y dedicación; solo mueve fechas) y ofrece la simulación por mes candidato. El store gana dos acciones delgadas (`moverCuentaAMes`, `replanificarDesdeElCorte`). El panel de detalle reemplaza "Mover cuenta entera ±1 sem" por un bloque "Sale en vivo" con la tira de meses coloreada, previsualización fantasma en el timeline al pasar el mouse, y un resumen de qué cambió al aplicar. Insights, Equipo y el video no se tocan: ya leen `salidas_en_vivo_propuestas`.

**Tech Stack:** React 18 + TypeScript + Zustand + date-fns. Tests sin framework (esbuild + node), fixture `test/fixtures/plan-v3.json`.

## Global Constraints

- Claves de `Asignacion`, `Persona`, `Proyecto`, `Config` del JSON exportado: **nunca se renombran ni se quitan**; solo se agregan opcionales (ninguna hace falta en este plan).
- Mensajes para la UI en español rioplatense, nombrando cuenta y fecha `dd/mm`; **nunca un id** en un texto que ve el usuario.
- **Cero invención**: si a una cuenta le falta el día de corte, se muestra `[FALTA: corte de novedades de <Cuenta>]` y no se planifica.
- Nada de datos personales: alias, nunca nombres reales.
- No tocar `src/theme/`, `src/index.css`, headers ni footers. Colores solo vía tokens existentes (`--ok-*`, `--warn-*`, `--error-*`, `--celeste*`, `--line*`).
- Por el `&` de la ruta de OneDrive: `node node_modules/esbuild/bin/esbuild …`, `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`. **Nunca `npm run` ni `npx`.**
- Branch: `feat/replanificar-desde-el-corte`. Commits en español. Al final: PR y merge (`"C:\Program Files\GitHub CLI\gh.exe"`).
- El algoritmo se porta **fiel al script** (`Herramientas-Tecnicas/scripts/armar_calendario_migracion.py`): margen mínimo 5 hábiles (de `config.capacidad.margen_minimo_habiles`), blackout de `config.tiers_v3.blackout_config` para Configuración **y** Pruebas, toda fase arranca lunes hábil, el cierre termina el hábil anterior al corte.

---

## Mapa de archivos

| Archivo | Qué hace | Tarea |
|---|---|---|
| `src/planificador.ts` (nuevo) | Calendario hacia atrás + simulación de destinos + descripción del cambio. Puro, sin store. | 1, 2 |
| `test/planificador.test.ts` (nuevo) + `package.json` | Tests del módulo puro contra el fixture v3 y una cuenta sintética con Cierre. | 1, 2 |
| `src/store.ts` | `moverCuentaAMes`, `replanificarDesdeElCorte`; `ORDEN_TIPO` con `Cierre`. | 3 |
| `src/uiStore.ts` | `previsualizacion` y `ultimoMovimiento` (transitorios, no persisten). | 4 |
| `src/components/DetailPanel.tsx` | Bloque "Sale en vivo": mes, corte, margen, tira de meses, qué cambió, `[FALTA]`. Se va "Mover cuenta entera". | 4 |
| `src/components/Timeline.tsx` | Barras fantasma de la previsualización; atenúa las reales de esa cuenta. | 5 |
| `src/components/ConfigPanel.tsx` | Ítem "Replanificar desde el corte" en el menú Más. | 6 |
| `CLAUDE.md` del repo | §2 modelo: el mes de salida se mueve desde el panel y arrastra las fases. | 7 |
| `…/Herramientas-Tecnicas/scripts/armar_calendario_migracion.py` y `DECISIONES.md` (otro repo, sin git) | Nota de "supersedido por la app" + entrada de decisión. | 7 |

---

### Task 1: Módulo puro `planificador.ts` — calendario hacia atrás

**Files:**
- Create: `src/planificador.ts`
- Create: `test/planificador.test.ts`
- Modify: `package.json` (scripts `test` y `test:planificador`)

**Interfaces:**
- Consumes: `fechaCorteDe(proyectoId, mesISO, config, feriados)` y `habilesHasta(desdeISO, hastaISO, feriados)` de `src/rules.ts`; `feriadosDeConfig`, `getMondayOfWeek`, `toISO` de `src/utils/dates.ts`; tipos de `src/types.ts`.
- Produces:
  ```ts
  export type MotivoNoPlanificable = 'sin_fases' | 'sin_corte' | 'sin_lugar' | 'fuera_de_horizonte'
  export const MOTIVO_TEXTO: Record<MotivoNoPlanificable, string>
  export type ResultadoPlan =
    | { ok: true; asignaciones: Asignacion[]; corte: string; margen: number; cierrePisaPruebas: boolean }
    | { ok: false; motivo: MotivoNoPlanificable }
  export function planificarCuenta(proyectoId: string, asignaciones: Asignacion[], mesSalida: string, config: Config): ResultadoPlan
  export function aplicarPlan(asignaciones: Asignacion[], nuevas: Asignacion[]): Asignacion[]
  export function configConSalida(config: Config, proyectoId: string, mes: string): Config
  // helpers de calendario, exportados para testear
  export function esHabilISO(iso: string, feriados: ReadonlySet<string>): boolean
  export function habilAnterior(iso: string, feriados: ReadonlySet<string>): string
  export function habilesDesde(inicioISO: string, n: number, feriados: ReadonlySet<string>): string[]
  export function ultimosHabiles(finISO: string, n: number, feriados: ReadonlySet<string>): string[]
  export function lunesHabilAnteriorOIgual(iso: string, feriados: ReadonlySet<string>): string
  export function pisaBlackout(iniISO: string, finISO: string, blackout?: [string, string]): boolean
  ```

- [ ] **Step 1: Escribir el test que falla**

`test/planificador.test.ts`:

```ts
/**
 * Tests del planificador hacia atrás (src/planificador.ts): dado el mes de salida de una
 * cuenta, rearma sus fases desde el corte de novedades con las reglas del script
 * armar_calendario_migracion.py. Corre sobre el fixture v3 (7 barras por cuenta, sin
 * Cierre) y sobre una cuenta sintética con la forma v5 (8 barras, con Cierre).
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import {
  aplicarPlan, configConSalida, esHabilISO, habilAnterior, habilesDesde, lunesHabilAnteriorOIgual,
  pisaBlackout, planificarCuenta, ultimosHabiles,
} from '../src/planificador'
import { computeViolaciones } from '../src/rules'
import { feriadosDeConfig } from '../src/utils/dates'
import planV3 from './fixtures/plan-v3.json'

let fallos = 0
let corridos = 0
function check(nombre: string, ok: boolean, detalle = '') {
  corridos++
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}
function eq(nombre: string, actual: unknown, esperado: unknown) {
  check(nombre, actual === esperado, `esperado ${String(esperado)}, obtenido ${String(actual)}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

const personas = planV3.personas as unknown as Persona[]
const proyectos = planV3.proyectos as unknown as Proyecto[]
const asignaciones = planV3.asignaciones as unknown as Asignacion[]
const config = planV3.config as unknown as Config
const feriados = feriadosDeConfig(config)
const porId = (xs: Asignacion[], id: string) => xs.find(a => a.id === id)!

titulo('Calendario — helpers')
eq('12/10/2026 es feriado, no hábil', esHabilISO('2026-10-12', feriados), false)
eq('13/10/2026 es hábil', esHabilISO('2026-10-13', feriados), true)
eq('hábil anterior al lunes 19/10 es el viernes 16/10', habilAnterior('2026-10-19', feriados), '2026-10-16')
eq('hábil anterior al martes 13/10 saltea el feriado del 12: viernes 09/10', habilAnterior('2026-10-13', feriados), '2026-10-09')
eq('8 hábiles desde el lunes 05/10 terminan el 15/10 (saltea el 12)', habilesDesde('2026-10-05', 8, feriados)[7], '2026-10-15')
eq('los 2 últimos hábiles que terminan el 19/10 son 16 y 19', ultimosHabiles('2026-10-19', 2, feriados).join(','), '2026-10-16,2026-10-19')
eq('lunes de la semana del jueves 15/10 es el 12/10, feriado → 05/10', lunesHabilAnteriorOIgual('2026-10-15', feriados), '2026-10-05')
eq('lunes de la semana del 19/10 es el mismo 19/10', lunesHabilAnteriorOIgual('2026-10-19', feriados), '2026-10-19')
eq('pisa el blackout si toca cualquier día del rango', pisaBlackout('2026-12-16', '2026-12-22', ['2026-12-21', '2027-01-08']), true)
eq('no pisa si termina el día anterior', pisaBlackout('2026-12-14', '2026-12-18', ['2026-12-21', '2027-01-08']), false)
eq('sin blackout configurado nunca pisa', pisaBlackout('2026-12-21', '2026-12-30', undefined), false)

titulo('planificarCuenta — TIM en su mes actual (octubre 2026, corte 19/10)')
const tim = planificarCuenta('tim', asignaciones, '2026-10', config)
check('planifica', tim.ok)
if (tim.ok) {
  eq('devuelve las 7 barras de TIM', tim.asignaciones.length, 7)
  eq('el corte es el 19/10', tim.corte, '2026-10-19')
  // Pruebas más larga: 8 días. Lunes 05/10 termina el 15/10 y deja 2 hábiles → no alcanza.
  // Lunes 28/09 termina el 07/10 y deja 8, 9, 13, 14, 15, 16, 19 = 7 hábiles.
  eq('las pruebas arrancan el lunes 28/09', porId(tim.asignaciones, 'tim-pruebas-g').inicio, '2026-09-28')
  eq('la de 8 días termina el 07/10', porId(tim.asignaciones, 'tim-pruebas-g').fin, '2026-10-07')
  eq('las tres pruebas arrancan el mismo lunes', new Set(tim.asignaciones.filter(a => a.tipo === 'Pruebas').map(a => a.inicio)).size, 1)
  eq('margen de 7 hábiles hasta el corte', tim.margen, 7)
  // Configuración: lunes ≤ 25/09 → 21/09; la de 4 días termina el 24/09 < 28/09.
  eq('la configuración arranca el lunes 21/09', porId(tim.asignaciones, 'tim-config-w').inicio, '2026-09-21')
  eq('la de Willy (4 días) termina el 24/09', porId(tim.asignaciones, 'tim-config-w').fin, '2026-09-24')
  eq('la de Moni (3 días) termina el 23/09', porId(tim.asignaciones, 'tim-config-m').fin, '2026-09-23')
  // Relevamiento: el repaso el lunes ≤ 18/09 → 14/09 (2 días); la corrida termina el hábil anterior, 11/09 (5 días).
  eq('el repaso arranca el 14/09', porId(tim.asignaciones, 'tim-repaso').inicio, '2026-09-14')
  eq('el repaso termina el 15/09', porId(tim.asignaciones, 'tim-repaso').fin, '2026-09-15')
  eq('la corrida termina el 11/09', porId(tim.asignaciones, 'tim-corrida').fin, '2026-09-11')
  eq('la corrida arranca el 07/09', porId(tim.asignaciones, 'tim-corrida').inicio, '2026-09-07')
  check('conserva id, persona, duración y dedicación de cada barra', tim.asignaciones.every(n => {
    const o = porId(asignaciones, n.id)
    return o.persona_id === n.persona_id && o.duracion_dias === n.duracion_dias && o.dedicacion_pct === n.dedicacion_pct && o.tipo === n.tipo
  }))
  eq('sin Cierre, no pisa pruebas', tim.cierrePisaPruebas, false)
}

titulo('planificarCuenta — TIM movida a noviembre 2026 (corte 19/11)')
const timNov = planificarCuenta('tim', asignaciones, '2026-11', config)
check('planifica', timNov.ok)
if (timNov.ok) {
  eq('corte 19/11', timNov.corte, '2026-11-19')
  // Lunes 09/11 termina el 18/11 y deja 1 hábil. Lunes 02/11 termina el 11/11 y deja 12,13,16,17,18,19 = 6.
  eq('las pruebas arrancan el 02/11', porId(timNov.asignaciones, 'tim-pruebas-g').inicio, '2026-11-02')
  eq('margen 6', timNov.margen, 6)
  const plan = aplicarPlan(asignaciones, timNov.asignaciones)
  const cfg = configConSalida(config, 'tim', '2026-11')
  eq('el config nuevo dice que TIM sale en noviembre', (cfg.salidas_en_vivo_propuestas as Record<string, string>).tim, '2026-11')
  check('el config nuevo conserva las demás salidas', (cfg.salidas_en_vivo_propuestas as Record<string, string>).dla === '2026-11')
  const v = computeViolaciones(plan, personas, cfg, proyectos)
  eq('TIM en noviembre no rompe margen, blackout ni dependencia',
    v.filter(x => x.proyecto_id === 'tim' && (x.tipo === 'margen' || x.tipo === 'blackout' || x.tipo === 'dependencia')).length, 0)
  check('pero noviembre con Piano, DLA y TIM supera el tope de 2 salidas',
    v.some(x => x.tipo === 'tope_salidas' && x.mes === '2026-11' && x.severidad === 'rojo'))
  eq('aplicarPlan no cambia la cantidad total de barras', plan.length, asignaciones.length)
}

titulo('planificarCuenta — Bonafide en diciembre respeta el blackout también en pruebas')
const bona = planificarCuenta('bonafide', asignaciones, '2026-12', config)
check('planifica', bona.ok)
if (bona.ok) {
  const pruebas = bona.asignaciones.filter(a => a.tipo === 'Pruebas')
  check('ninguna prueba toca el 21/12–08/01', pruebas.every(a => !pisaBlackout(a.inicio, a.fin, ['2026-12-21', '2027-01-08'])),
    pruebas.map(a => `${a.inicio}→${a.fin}`).join(' '))
  check('ninguna configuración toca el blackout', bona.asignaciones.filter(a => a.tipo === 'Configuracion').every(a => !pisaBlackout(a.inicio, a.fin, ['2026-12-21', '2027-01-08'])))
  check('margen ≥ 5', bona.margen >= 5, String(bona.margen))
}

titulo('planificarCuenta — casos que no se pueden planificar')
eq('sin corte de novedades → sin_corte', (() => {
  const c: Config = { ...config, cortes_novedades_dia: { ...config.cortes_novedades_dia, tim: undefined as unknown as number } }
  const r = planificarCuenta('tim', asignaciones, '2026-10', c)
  return r.ok ? 'ok' : r.motivo
})(), 'sin_corte')
eq('una cuenta sin fases → sin_fases', (() => { const r = planificarCuenta('nadie', asignaciones, '2026-10', config); return r.ok ? 'ok' : r.motivo })(), 'sin_fases')
eq('un mes después del horizonte → fuera_de_horizonte', (() => { const r = planificarCuenta('tim', asignaciones, '2027-12', config); return r.ok ? 'ok' : r.motivo })(), 'fuera_de_horizonte')

titulo('Todo el v3 replanificado a sus meses actuales no rompe ninguna regla de calendario')
let todas = asignaciones
for (const p of proyectos) {
  const mes = (config.salidas_en_vivo_propuestas as Record<string, string>)[p.id]
  const r = planificarCuenta(p.id, todas, mes, config)
  check(`${p.nombre} planifica`, r.ok, r.ok ? '' : r.motivo)
  if (r.ok) todas = aplicarPlan(todas, r.asignaciones)
}
const vTodas = computeViolaciones(todas, personas, config, proyectos)
eq('91 barras, las mismas', todas.length, 91)
eq('0 dependencia', vTodas.filter(v => v.tipo === 'dependencia').length, 0)
eq('0 margen', vTodas.filter(v => v.tipo === 'margen').length, 0)
eq('0 blackout', vTodas.filter(v => v.tipo === 'blackout').length, 0)
check('toda fase arranca un lunes hábil', todas.every(a => new Date(a.inicio + 'T00:00:00').getDay() === 1 || a.tipo === 'Relevamiento'),
  todas.filter(a => new Date(a.inicio + 'T00:00:00').getDay() !== 1 && a.tipo !== 'Relevamiento').map(a => a.id).join(' '))

titulo('Cierre (forma v5): pegado al corte, encadenado hacia atrás')
const v5: Asignacion[] = [
  { id: 'x-repaso', proyecto_id: 'x', tipo: 'Relevamiento', persona_id: 'gaby_f', inicio: '2026-01-05', fin: '2026-01-06', duracion_dias: 2, dedicacion_pct: 0.5, predecesoras: [], es_bloqueo: false },
  { id: 'x-cw', proyecto_id: 'x', tipo: 'Configuracion', persona_id: 'guille', inicio: '2026-01-05', fin: '2026-01-08', duracion_dias: 4, dedicacion_pct: 0.6, predecesoras: [], es_bloqueo: false },
  { id: 'x-cm', proyecto_id: 'x', tipo: 'Configuracion', persona_id: 'moni', inicio: '2026-01-05', fin: '2026-01-07', duracion_dias: 3, dedicacion_pct: 0.5, predecesoras: [], es_bloqueo: false },
  { id: 'x-pg', proyecto_id: 'x', tipo: 'Pruebas', persona_id: 'gaby_f', inicio: '2026-01-05', fin: '2026-01-14', duracion_dias: 8, dedicacion_pct: 0.3, predecesoras: [], es_bloqueo: false },
  { id: 'x-pm', proyecto_id: 'x', tipo: 'Pruebas', persona_id: 'moni', inicio: '2026-01-05', fin: '2026-01-07', duracion_dias: 3, dedicacion_pct: 0.3, predecesoras: [], es_bloqueo: false },
  { id: 'x-delta', proyecto_id: 'x', tipo: 'Cierre', persona_id: 'gaby_f', inicio: '2026-01-05', fin: '2026-01-05', duracion_dias: 1, dedicacion_pct: 0.5, predecesoras: [], es_bloqueo: false },
  { id: 'x-aplica', proyecto_id: 'x', tipo: 'Cierre', persona_id: 'moni', inicio: '2026-01-06', fin: '2026-01-07', duracion_dias: 2, dedicacion_pct: 0.5, predecesoras: [], es_bloqueo: false },
]
const cfgX: Config = { ...config, cortes_novedades_dia: { x: 20 } }
const rx = planificarCuenta('x', v5, '2026-10', cfgX)
check('planifica', rx.ok)
if (rx.ok) {
  // Corte 20/10 (martes). Aplica termina el hábil anterior, 19/10, y dura 2: 16 y 19. Delta termina el 15/10.
  eq('aplica termina el 19/10', porId(rx.asignaciones, 'x-aplica').fin, '2026-10-19')
  eq('aplica arranca el 16/10', porId(rx.asignaciones, 'x-aplica').inicio, '2026-10-16')
  eq('delta termina el 15/10', porId(rx.asignaciones, 'x-delta').fin, '2026-10-15')
  eq('delta arranca el 15/10', porId(rx.asignaciones, 'x-delta').inicio, '2026-10-15')
  // Pruebas 8 días con margen ≥ 5 antes del 20/10: lunes 28/09 → fin 07/10, margen 8,9,13,14,15,16,19,20 = 8.
  eq('pruebas arrancan el 28/09', porId(rx.asignaciones, 'x-pg').inicio, '2026-09-28')
  eq('margen 8', rx.margen, 8)
  eq('el cierre no pisa las pruebas (07/10 < 15/10)', rx.cierrePisaPruebas, false)
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
```

Agregar a `package.json`:
```json
"test": "npm run test:duraciones && npm run test:migracion && npm run test:reglas && npm run test:equipo && npm run test:confidencial && npm run test:importar && npm run test:resumen && npm run test:planificador",
"test:planificador": "esbuild test/planificador.test.ts --bundle --platform=node --format=esm --loader:.json=json --outfile=dist/.test-planificador.mjs --log-level=warning && node dist/.test-planificador.mjs"
```

- [ ] **Step 2: Correr el test y ver que falla**

```bash
node node_modules/esbuild/bin/esbuild test/planificador.test.ts --bundle --platform=node --format=esm --loader:.json=json --outfile=dist/.test-planificador.mjs --log-level=warning && node dist/.test-planificador.mjs
```
Esperado: falla el bundle con `Could not resolve "../src/planificador"`.

- [ ] **Step 3: Implementar `src/planificador.ts`**

```ts
import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { feriadosDeConfig, getMondayOfWeek, toISO } from './utils/dates'
import { computeViolaciones, fechaCorteDe, habilesHasta } from './rules'
import { cargaMensual, mesSalidaDe } from './capacidad'

/**
 * Planificador hacia atrás: el mismo algoritmo que armar_calendario_migracion.py, adentro
 * de la app. Recibe UNA decisión (el mes de salida en vivo de una cuenta) y deriva las
 * fechas de todas sus fases desde el corte de novedades de ese mes:
 *
 *   1. Pruebas: el lunes hábil más tarde que deje `margen_minimo_habiles` antes del corte y
 *      no toque el blackout de fin de año. Todas las pruebas arrancan ese lunes.
 *   2. Configuración: el lunes hábil más tarde que termine antes de las pruebas, fuera del
 *      blackout. Todas las configuraciones arrancan ese lunes.
 *   3. Relevamiento: la última (por orden actual) el lunes anterior a la configuración; las
 *      anteriores encadenan hacia atrás, cada una terminando el hábil previo a la siguiente.
 *   4. Cierre: pegado al corte, no a las pruebas. La última barra termina el hábil anterior
 *      al corte y las demás encadenan hacia atrás. Puede pisar las pruebas: se informa.
 *
 * Solo cambia `inicio` y `fin`. Conserva id, persona, duración, dedicación y predecesoras,
 * así funciona con cualquier forma de cuenta (v3 con corrida, v5 con Cierre) y sin depender
 * de la tabla de duraciones por tier. Lo que el algoritmo NO resuelve a propósito son los
 * choques de carga entre cuentas: esos quedan a la vista en las reglas para decidirlos.
 */

// ── calendario ────────────────────────────────────────────────────────────────────

export function esHabilISO(iso: string, feriados: ReadonlySet<string>): boolean {
  const dow = parseISO(iso).getDay()
  return dow !== 0 && dow !== 6 && !feriados.has(iso)
}

/** El día hábil anterior a `iso` (nunca el mismo día). */
export function habilAnterior(iso: string, feriados: ReadonlySet<string>): string {
  let d = addDays(parseISO(iso), -1)
  while (!esHabilISO(toISO(d), feriados)) d = addDays(d, -1)
  return toISO(d)
}

/** Los `n` días hábiles a partir de `inicioISO` inclusive (si cae no hábil, arranca en el siguiente). */
export function habilesDesde(inicioISO: string, n: number, feriados: ReadonlySet<string>): string[] {
  const out: string[] = []
  let d = parseISO(inicioISO)
  while (out.length < Math.max(1, n)) {
    const iso = toISO(d)
    if (esHabilISO(iso, feriados)) out.push(iso)
    d = addDays(d, 1)
  }
  return out
}

/** Los `n` días hábiles que TERMINAN en `finISO` inclusive, en orden cronológico. */
export function ultimosHabiles(finISO: string, n: number, feriados: ReadonlySet<string>): string[] {
  const out: string[] = []
  let d = parseISO(finISO)
  while (out.length < Math.max(1, n)) {
    const iso = toISO(d)
    if (esHabilISO(iso, feriados)) out.push(iso)
    d = addDays(d, -1)
  }
  return out.reverse()
}

/** El lunes de la semana de `iso`; si ese lunes es feriado, el de la semana anterior. */
export function lunesHabilAnteriorOIgual(iso: string, feriados: ReadonlySet<string>): string {
  let d = getMondayOfWeek(parseISO(iso))
  while (!esHabilISO(toISO(d), feriados)) d = addDays(d, -7)
  return toISO(d)
}

export function pisaBlackout(iniISO: string, finISO: string, blackout?: [string, string]): boolean {
  if (!blackout || blackout.length !== 2) return false
  const [b0, b1] = blackout
  return !(finISO < b0 || iniISO > b1)
}

// ── planificación de una cuenta ───────────────────────────────────────────────────

export type MotivoNoPlanificable = 'sin_fases' | 'sin_corte' | 'sin_lugar' | 'fuera_de_horizonte'

export const MOTIVO_TEXTO: Record<MotivoNoPlanificable, string> = {
  sin_fases: 'La cuenta no tiene fases planificadas.',
  sin_corte: '[FALTA: día de corte de novedades] Sin ese dato no se puede ubicar la cuenta. Va en config.cortes_novedades_dia.',
  sin_lugar: 'No hay lugar antes del corte que respete el margen mínimo y el blackout.',
  fuera_de_horizonte: 'Ese mes queda fuera del horizonte del plan.',
}

export type ResultadoPlan =
  | { ok: true; asignaciones: Asignacion[]; corte: string; margen: number; cierrePisaPruebas: boolean }
  | { ok: false; motivo: MotivoNoPlanificable }

const ORDEN_CRONO = (a: Asignacion, b: Asignacion) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : a.id < b.id ? -1 : 1)
const MAX_INTENTOS = 60

export function planificarCuenta(proyectoId: string, asignaciones: Asignacion[], mesSalida: string, config: Config): ResultadoPlan {
  const propias = asignaciones.filter(a => a.proyecto_id === proyectoId && !a.es_bloqueo)
  if (!propias.length) return { ok: false, motivo: 'sin_fases' }
  const desde = config.horizonte.desde.slice(0, 7)
  const hasta = config.horizonte.hasta.slice(0, 7)
  if (mesSalida < desde || mesSalida > hasta) return { ok: false, motivo: 'fuera_de_horizonte' }

  const feriados = feriadosDeConfig(config)
  const corte = fechaCorteDe(proyectoId, mesSalida, config, feriados)
  if (!corte) return { ok: false, motivo: 'sin_corte' }
  const minimo = config.capacidad?.margen_minimo_habiles ?? 5
  const blackout = config.tiers_v3?.blackout_config

  const porTipo = (tipo: Asignacion['tipo']) => propias.filter(a => a.tipo === tipo).sort(ORDEN_CRONO)
  const pruebas = porTipo('Pruebas')
  const configs = porTipo('Configuracion')
  const relevs = porTipo('Relevamiento')
  const cierres = porTipo('Cierre')

  const nuevas = new Map<string, Asignacion>()
  const fijarDesde = (a: Asignacion, inicio: string) => {
    const dias = habilesDesde(inicio, a.duracion_dias, feriados)
    nuevas.set(a.id, { ...a, inicio: dias[0], fin: dias[dias.length - 1] })
  }
  const fijarHasta = (a: Asignacion, fin: string) => {
    const dias = ultimosHabiles(fin, a.duracion_dias, feriados)
    nuevas.set(a.id, { ...a, inicio: dias[0], fin: dias[dias.length - 1] })
  }
  const durMax = (xs: Asignacion[]) => Math.max(...xs.map(a => a.duracion_dias))
  const lunesAnterior = (lunes: string) => lunesHabilAnteriorOIgual(toISO(addDays(parseISO(lunes), -7)), feriados)
  const finDesde = (lunes: string, dur: number) => habilesDesde(lunes, dur, feriados)[dur - 1] ?? lunes

  // 1. Pruebas
  let margen = 0
  let iniPruebas: string | null = null
  if (pruebas.length) {
    const dur = durMax(pruebas)
    let lunes = lunesHabilAnteriorOIgual(corte, feriados)
    let encontrado = false
    for (let i = 0; i < MAX_INTENTOS; i++) {
      const fin = finDesde(lunes, dur)
      const m = fin < corte ? habilesHasta(fin, corte, feriados) : -1
      if (m >= minimo && !pisaBlackout(lunes, fin, blackout)) { margen = m; encontrado = true; break }
      lunes = lunesAnterior(lunes)
    }
    if (!encontrado) return { ok: false, motivo: 'sin_lugar' }
    iniPruebas = lunes
    for (const a of pruebas) fijarDesde(a, lunes)
  }

  // 2. Configuración: termina antes de las pruebas (o del corte, si la cuenta no tiene pruebas)
  let iniConfig: string | null = null
  if (configs.length) {
    const dur = durMax(configs)
    const tope = iniPruebas ?? corte
    let lunes = lunesHabilAnteriorOIgual(toISO(addDays(parseISO(tope), -3)), feriados)
    let encontrado = false
    for (let i = 0; i < MAX_INTENTOS; i++) {
      const fin = finDesde(lunes, dur)
      if (fin < tope && !pisaBlackout(lunes, fin, blackout)) { encontrado = true; break }
      lunes = lunesAnterior(lunes)
    }
    if (!encontrado) return { ok: false, motivo: 'sin_lugar' }
    iniConfig = lunes
    for (const a of configs) fijarDesde(a, lunes)
  }

  // 3. Relevamiento: la última el lunes anterior a la configuración; las demás hacia atrás
  if (relevs.length) {
    const ancla = iniConfig ?? iniPruebas ?? corte
    const lunes = lunesHabilAnteriorOIgual(toISO(addDays(parseISO(ancla), -3)), feriados)
    const ultima = relevs[relevs.length - 1]
    fijarDesde(ultima, lunes)
    let siguienteInicio = nuevas.get(ultima.id)!.inicio
    for (let i = relevs.length - 2; i >= 0; i--) {
      fijarHasta(relevs[i], habilAnterior(siguienteInicio, feriados))
      siguienteInicio = nuevas.get(relevs[i].id)!.inicio
    }
  }

  // 4. Cierre: pegado al corte, encadenado hacia atrás en su orden actual
  let cierrePisaPruebas = false
  if (cierres.length) {
    let fin = habilAnterior(corte, feriados)
    for (let i = cierres.length - 1; i >= 0; i--) {
      fijarHasta(cierres[i], fin)
      fin = habilAnterior(nuevas.get(cierres[i].id)!.inicio, feriados)
    }
    if (pruebas.length) {
      const finPruebas = pruebas.map(a => nuevas.get(a.id)!.fin).sort()[pruebas.length - 1]
      cierrePisaPruebas = nuevas.get(cierres[0].id)!.inicio <= finPruebas
    }
  }

  const resultado = propias.map(a => nuevas.get(a.id) ?? a)
  if (resultado.some(a => a.inicio < config.horizonte.desde)) return { ok: false, motivo: 'fuera_de_horizonte' }
  return { ok: true, asignaciones: resultado, corte, margen, cierrePisaPruebas }
}

/** Reemplaza en la lista completa las barras que vienen en `nuevas` (por id). El resto queda igual. */
export function aplicarPlan(asignaciones: Asignacion[], nuevas: Asignacion[]): Asignacion[] {
  const porId = new Map(nuevas.map(a => [a.id, a]))
  return asignaciones.map(a => porId.get(a.id) ?? a)
}

/** El mismo config con el mes de salida de una cuenta cambiado. Conserva `_fuera_del_plan` y el resto. */
export function configConSalida(config: Config, proyectoId: string, mes: string): Config {
  return {
    ...config,
    salidas_en_vivo_propuestas: { ...(config.salidas_en_vivo_propuestas ?? {}), [proyectoId]: mes },
  }
}
```

(Las funciones de la Tarea 2 se agregan al final de este mismo archivo; los imports de `Persona`, `Proyecto`, `Violacion`, `computeViolaciones`, `cargaMensual` y `mesSalidaDe` ya quedan declarados acá para eso. Si `tsc` marca imports sin usar antes de la Tarea 2, es esperable: la Tarea 2 los usa.)

- [ ] **Step 4: Correr el test y ver que pasa**

```bash
node node_modules/esbuild/bin/esbuild test/planificador.test.ts --bundle --platform=node --format=esm --loader:.json=json --outfile=dist/.test-planificador.mjs --log-level=warning && node dist/.test-planificador.mjs
```
Esperado: `TODO OK`. Si un valor exacto de fecha falla, verificar la cuenta a mano contra los feriados del fixture antes de tocar el algoritmo: el número esperado del test es la cuenta hecha con los feriados de 2026 (12/10 feriado, 08/12 feriado, 25/12 viernes).

- [ ] **Step 5: Commit**

```bash
git add src/planificador.ts test/planificador.test.ts package.json
git commit -m "Planificador hacia atrás desde el corte de novedades (módulo puro + tests)"
```

---

### Task 2: Simulación de destinos y descripción del cambio

**Files:**
- Modify: `src/planificador.ts` (agregar al final)
- Modify: `test/planificador.test.ts` (agregar antes del `console.log` final)

**Interfaces:**
- Consumes: `planificarCuenta`, `aplicarPlan`, `configConSalida` (Tarea 1); `computeViolaciones` de `rules.ts`; `cargaMensual(personas, asignaciones, config)` de `capacidad.ts` (devuelve `{ personaId, mes, horas, capacidad, porCuenta }[]`); `mesSalidaDe`.
- Produces:
  ```ts
  export type EstadoDestino = 'verde' | 'ambar' | 'rojo' | 'gris'
  export interface Destino { mes: string; estado: EstadoDestino; actual: boolean; motivo: string | null; rojos: number; ambares: number; deltaRojos: number; deltaAmbares: number; margen: number | null; corte: string | null }
  export function mesesCandidatos(config: Config, hoyISO: string): string[]
  export function simularDestinos(proyectoId: string, meses: string[], asignaciones: Asignacion[], personas: Persona[], config: Config, proyectos: Proyecto[]): Destino[]
  export interface ReporteMovimiento { proyectoId: string; nombre: string; mesAntes: string | null; mesDespues: string; corte: string; margen: number; cierrePisaPruebas: boolean; rojosAntes: number; rojosDespues: number; ambaresAntes: number; ambaresDespues: number; nuevas: string[]; resueltas: string[]; cargas: Array<{ alias: string; mes: string; antes: number; despues: number; capacidad: number }> }
  export function describirMovimiento(args: { proyectoId: string; proyectos: Proyecto[]; personas: Persona[]; antes: { asignaciones: Asignacion[]; config: Config; violaciones: Violacion[] }; despues: { asignaciones: Asignacion[]; config: Config; violaciones: Violacion[] }; plan: Extract<ResultadoPlan, { ok: true }> }): ReporteMovimiento
  ```

- [ ] **Step 1: Agregar los tests**

Insertar antes de la línea `console.log(\`\n${fallos === 0 …` de `test/planificador.test.ts`:

```ts
titulo('mesesCandidatos — desde el mes de hoy hasta el fin del horizonte')
const meses = mesesCandidatos(config, '2026-09-10')
eq('arranca en septiembre 2026', meses[0], '2026-09')
eq('termina en octubre 2027 (horizonte.hasta del fixture)', meses[meses.length - 1], '2027-10')
eq('son 14 meses', meses.length, 14)
eq('si hoy es anterior al horizonte, arranca en el horizonte', mesesCandidatos(config, '2025-01-01')[0], '2026-06')

titulo('simularDestinos — TIM')
const destinos = simularDestinos('tim', meses, asignaciones, personas, config, proyectos)
eq('un destino por mes', destinos.length, meses.length)
check('octubre está marcado como el mes actual', destinos.find(d => d.mes === '2026-10')!.actual)
eq('noviembre es rojo: Piano, DLA y TIM superan el tope', destinos.find(d => d.mes === '2026-11')!.estado, 'rojo')
check('y el motivo lo dice en castellano', /tope|salidas/i.test(destinos.find(d => d.mes === '2026-11')!.motivo ?? ''), destinos.find(d => d.mes === '2026-11')!.motivo ?? '')
check('ningún destino es gris (todas las cuentas tienen corte y entran en el horizonte)', destinos.every(d => d.estado !== 'gris'))
check('cada destino trae corte y margen', destinos.every(d => d.corte && d.margen !== null && d.margen >= 5))
eq('un mes fuera del horizonte es gris', simularDestinos('tim', ['2027-12'], asignaciones, personas, config, proyectos)[0].estado, 'gris')

titulo('describirMovimiento — TIM de octubre a noviembre')
if (timNov.ok) {
  const asigDespues = aplicarPlan(asignaciones, timNov.asignaciones)
  const cfgDespues = configConSalida(config, 'tim', '2026-11')
  const rep = describirMovimiento({
    proyectoId: 'tim', proyectos, personas,
    antes: { asignaciones, config, violaciones: computeViolaciones(asignaciones, personas, config, proyectos) },
    despues: { asignaciones: asigDespues, config: cfgDespues, violaciones: computeViolaciones(asigDespues, personas, cfgDespues, proyectos) },
    plan: timNov,
  })
  eq('nombra la cuenta', rep.nombre, 'TIM')
  eq('mes antes', rep.mesAntes, '2026-10')
  eq('mes después', rep.mesDespues, '2026-11')
  check('aparece al menos un conflicto nuevo (el tope de noviembre)', rep.nuevas.some(m => /tope|salidas/i.test(m)), rep.nuevas.join(' | '))
  check('los rojos después son más que antes', rep.rojosDespues > rep.rojosAntes, `${rep.rojosAntes} → ${rep.rojosDespues}`)
  check('las cargas listan solo personas de TIM en meses donde cambió algo', rep.cargas.length > 0 && rep.cargas.every(c => ['Guille', 'Moni', 'Gaby F.'].includes(c.alias)), rep.cargas.map(c => `${c.alias} ${c.mes} ${c.antes}→${c.despues}`).join(' | '))
  check('ningún texto muestra un id', [...rep.nuevas, ...rep.resueltas].every(m => !/tim-/.test(m)))
}
```

Y en el `import { … } from '../src/planificador'` de arriba agregar `describirMovimiento, mesesCandidatos, simularDestinos`.

- [ ] **Step 2: Correr y ver que falla**

Mismo comando que en la Tarea 1. Esperado: falla el bundle por `No matching export … "mesesCandidatos"`.

- [ ] **Step 3: Implementar al final de `src/planificador.ts`**

```ts
// ── qué pasa si la cuenta sale en otro mes ────────────────────────────────────────

export type EstadoDestino = 'verde' | 'ambar' | 'rojo' | 'gris'

export interface Destino {
  mes: string
  /** verde: no aparecen conflictos nuevos · ámbar: solo avisos nuevos · rojo: al menos un conflicto nuevo · gris: no se puede planificar ahí */
  estado: EstadoDestino
  actual: boolean
  /** El primer conflicto nuevo (o el motivo por el que no se puede), en castellano. */
  motivo: string | null
  rojos: number
  ambares: number
  deltaRojos: number
  deltaAmbares: number
  margen: number | null
  corte: string | null
}

/** Meses 'YYYY-MM' desde el más tarde entre hoy y el inicio del horizonte, hasta el fin del horizonte. */
export function mesesCandidatos(config: Config, hoyISO: string): string[] {
  const desde = hoyISO.slice(0, 7) > config.horizonte.desde.slice(0, 7) ? hoyISO.slice(0, 7) : config.horizonte.desde.slice(0, 7)
  const hasta = config.horizonte.hasta.slice(0, 7)
  const out: string[] = []
  let [y, m] = desde.split('-').map(Number)
  while (true) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (key > hasta) break
    out.push(key)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

const cuenta = (vs: Violacion[], sev: Violacion['severidad']) => vs.filter(v => v.severidad === sev).length

export function simularDestinos(
  proyectoId: string, meses: string[], asignaciones: Asignacion[], personas: Persona[], config: Config, proyectos: Proyecto[],
): Destino[] {
  const base = computeViolaciones(asignaciones, personas, config, proyectos)
  const rojosBase = cuenta(base, 'rojo')
  const ambaresBase = cuenta(base, 'ambar')
  const mensajesBase = new Set(base.map(v => v.mensaje))
  const actual = mesSalidaDe(proyectoId, config)

  return meses.map(mes => {
    const plan = planificarCuenta(proyectoId, asignaciones, mes, config)
    if (!plan.ok) {
      return { mes, estado: 'gris', actual: mes === actual, motivo: MOTIVO_TEXTO[plan.motivo], rojos: rojosBase, ambares: ambaresBase, deltaRojos: 0, deltaAmbares: 0, margen: null, corte: null }
    }
    const v = computeViolaciones(aplicarPlan(asignaciones, plan.asignaciones), personas, configConSalida(config, proyectoId, mes), proyectos)
    const rojos = cuenta(v, 'rojo')
    const ambares = cuenta(v, 'ambar')
    const deltaRojos = rojos - rojosBase
    const deltaAmbares = ambares - ambaresBase
    const nuevas = v.filter(x => x.severidad !== 'info' && !mensajesBase.has(x.mensaje))
    const motivo = (nuevas.find(x => x.severidad === 'rojo') ?? nuevas[0])?.mensaje ?? null
    const estado: EstadoDestino = deltaRojos > 0 ? 'rojo' : deltaAmbares > 0 ? 'ambar' : 'verde'
    return { mes, estado, actual: mes === actual, motivo, rojos, ambares, deltaRojos, deltaAmbares, margen: plan.margen, corte: plan.corte }
  })
}

// ── qué cambió después de mover ───────────────────────────────────────────────────

export interface ReporteMovimiento {
  proyectoId: string
  nombre: string
  mesAntes: string | null
  mesDespues: string
  corte: string
  margen: number
  cierrePisaPruebas: boolean
  rojosAntes: number
  rojosDespues: number
  ambaresAntes: number
  ambaresDespues: number
  /** Mensajes de conflictos y avisos que aparecieron con el movimiento. */
  nuevas: string[]
  /** Mensajes que había antes y ya no están. */
  resueltas: string[]
  /** Carga mensual de las personas de la cuenta, solo en los meses donde cambió. */
  cargas: Array<{ alias: string; mes: string; antes: number; despues: number; capacidad: number }>
}

export function describirMovimiento(args: {
  proyectoId: string
  proyectos: Proyecto[]
  personas: Persona[]
  antes: { asignaciones: Asignacion[]; config: Config; violaciones: Violacion[] }
  despues: { asignaciones: Asignacion[]; config: Config; violaciones: Violacion[] }
  plan: Extract<ResultadoPlan, { ok: true }>
}): ReporteMovimiento {
  const { proyectoId, proyectos, personas, antes, despues, plan } = args
  const nombre = proyectos.find(p => p.id === proyectoId)?.nombre ?? proyectoId
  const msgsAntes = new Set(antes.violaciones.filter(v => v.severidad !== 'info').map(v => v.mensaje))
  const msgsDespues = new Set(despues.violaciones.filter(v => v.severidad !== 'info').map(v => v.mensaje))

  const personasCuenta = new Set([...antes.asignaciones, ...despues.asignaciones]
    .filter(a => a.proyecto_id === proyectoId && !a.es_bloqueo).map(a => a.persona_id))
  const cargaAntes = cargaMensual(personas, antes.asignaciones, antes.config)
  const cargaDespues = cargaMensual(personas, despues.asignaciones, despues.config)
  const clave = (c: { personaId: string; mes: string }) => `${c.personaId}|${c.mes}`
  const mapaAntes = new Map(cargaAntes.map(c => [clave(c), c]))
  const mapaDespues = new Map(cargaDespues.map(c => [clave(c), c]))
  const cargas: ReporteMovimiento['cargas'] = []
  for (const k of new Set([...mapaAntes.keys(), ...mapaDespues.keys()])) {
    const [personaId, mes] = k.split('|')
    if (!personasCuenta.has(personaId)) continue
    const a = mapaAntes.get(k)?.horas ?? 0
    const d = mapaDespues.get(k)?.horas ?? 0
    if (Math.abs(a - d) < 0.5) continue
    cargas.push({
      alias: personas.find(p => p.id === personaId)?.alias ?? personaId, mes,
      antes: Math.round(a), despues: Math.round(d),
      capacidad: Math.round((mapaDespues.get(k) ?? mapaAntes.get(k))!.capacidad),
    })
  }
  cargas.sort((x, y) => (x.mes < y.mes ? -1 : x.mes > y.mes ? 1 : x.alias.localeCompare(y.alias, 'es')))

  return {
    proyectoId, nombre,
    mesAntes: mesSalidaDe(proyectoId, antes.config),
    mesDespues: mesSalidaDe(proyectoId, despues.config) ?? plan.corte.slice(0, 7),
    corte: plan.corte, margen: plan.margen, cierrePisaPruebas: plan.cierrePisaPruebas,
    rojosAntes: cuenta(antes.violaciones, 'rojo'), rojosDespues: cuenta(despues.violaciones, 'rojo'),
    ambaresAntes: cuenta(antes.violaciones, 'ambar'), ambaresDespues: cuenta(despues.violaciones, 'ambar'),
    nuevas: [...msgsDespues].filter(m => !msgsAntes.has(m)),
    resueltas: [...msgsAntes].filter(m => !msgsDespues.has(m)),
    cargas,
  }
}
```

- [ ] **Step 4: Correr y ver que pasa**

Mismo comando. Esperado `TODO OK`. También:
```bash
node node_modules/typescript/bin/tsc --noEmit
```
Esperado: sin salida (exit 0).

- [ ] **Step 5: Commit**

```bash
git add src/planificador.ts test/planificador.test.ts
git commit -m "Simular en qué meses entra una cuenta y describir qué cambió al moverla"
```

---

### Task 3: Acciones del store

**Files:**
- Modify: `src/store.ts` — import, `ORDEN_TIPO` (línea ~118), interfaz `SimuladorState` (~línea 300), dos acciones nuevas después de `shiftAccount` (~línea 452).

**Interfaces:**
- Consumes: `planificarCuenta`, `aplicarPlan`, `configConSalida`, `describirMovimiento`, `MOTIVO_TEXTO`, `ReporteMovimiento` de `./planificador`; `mesSalidaDe` de `./capacidad`.
- Produces (en `SimuladorState`):
  ```ts
  moverCuentaAMes: (proyectoId: string, mes: string) => { ok: boolean; motivo?: string; reporte?: ReporteMovimiento }
  replanificarDesdeElCorte: () => { replanificadas: number; sinCorte: string[]; sinLugar: string[] }
  ```

- [ ] **Step 1: Imports y `ORDEN_TIPO`**

Después de `import { ORDEN_FASES } from './theme/fases'`:
```ts
import { aplicarPlan, configConSalida, describirMovimiento, MOTIVO_TEXTO, planificarCuenta, type ReporteMovimiento } from './planificador'
import { mesSalidaDe } from './capacidad'
```
Reemplazar:
```ts
const ORDEN_TIPO: Record<string, number> = {
  Relevamiento: 0, Configuracion: 1, Pruebas: 2, Vacaciones: 3,
}
```
por:
```ts
const ORDEN_TIPO: Record<string, number> = {
  Relevamiento: 0, Configuracion: 1, Pruebas: 2, Cierre: 3, Vacaciones: 4,
}
```
(Sin `Cierre` acá, arrastrar una Configuración en modo estricto no arrastraba el Cierre de la cuenta.)

- [ ] **Step 2: Declarar en `SimuladorState`**

Después de `shiftAccount: (proyectoId: string, semanas: number) => void`:
```ts
  /**
   * Cambia el mes de salida en vivo de una cuenta y rearma sus fases hacia atrás desde el
   * corte de novedades de ese mes (ver `src/planificador.ts`). Actualiza
   * `config.salidas_en_vivo_propuestas`, así el tope de salidas, el margen, la
   * disponibilidad de Moni, Insights, Equipo y el video ven el mes nuevo.
   */
  moverCuentaAMes: (proyectoId: string, mes: string) => { ok: boolean; motivo?: string; reporte?: ReporteMovimiento }
  /** Rearma TODAS las cuentas con mes de salida y corte desde su corte. Equivale a correr el script Python. */
  replanificarDesdeElCorte: () => { replanificadas: number; sinCorte: string[]; sinLugar: string[] }
```

- [ ] **Step 3: Implementar, después del cierre de `shiftAccount(...)` `},`**

```ts
      moverCuentaAMes(proyectoId, mes) {
        let salida: { ok: boolean; motivo?: string; reporte?: ReporteMovimiento } = { ok: false }
        set(state => {
          const plan = planificarCuenta(proyectoId, state.asignaciones, mes, state.config)
          if (!plan.ok) { salida = { ok: false, motivo: MOTIVO_TEXTO[plan.motivo] }; return {} }
          const asignaciones = aplicarPlan(state.asignaciones, plan.asignaciones)
          const config = configConSalida(state.config, proyectoId, mes)
          const violaciones = recompute(asignaciones, state.personas, config, state.proyectos)
          salida = {
            ok: true,
            reporte: describirMovimiento({
              proyectoId, proyectos: state.proyectos, personas: state.personas,
              antes: { asignaciones: state.asignaciones, config: state.config, violaciones: state.violaciones },
              despues: { asignaciones, config, violaciones },
              plan,
            }),
          }
          return { ...conHistorial(state), asignaciones, config, violaciones }
        })
        return salida
      },

      replanificarDesdeElCorte() {
        const reporte = { replanificadas: 0, sinCorte: [] as string[], sinLugar: [] as string[] }
        set(state => {
          let asignaciones = state.asignaciones
          for (const p of state.proyectos) {
            const mes = mesSalidaDe(p.id, state.config)
            if (!mes) continue
            if (!asignaciones.some(a => a.proyecto_id === p.id && !a.es_bloqueo)) continue
            const plan = planificarCuenta(p.id, asignaciones, mes, state.config)
            if (!plan.ok) {
              if (plan.motivo === 'sin_corte') reporte.sinCorte.push(p.nombre)
              else reporte.sinLugar.push(p.nombre)
              continue
            }
            asignaciones = aplicarPlan(asignaciones, plan.asignaciones)
            reporte.replanificadas++
          }
          if (reporte.replanificadas === 0) return {}
          return {
            ...conHistorial(state),
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, state.config, state.proyectos),
          }
        })
        return reporte
      },
```

- [ ] **Step 4: Typecheck y tests**

```bash
node node_modules/typescript/bin/tsc --noEmit
```
Esperado: exit 0. Después correr `test:planificador` y `test:reglas` como en la Tarea 1 (ambos `TODO OK`).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts
git commit -m "Store: mover una cuenta a un mes replanifica desde el corte; replanificar todo el plan"
```

---

### Task 4: Panel de la cuenta — bloque "Sale en vivo"

**Files:**
- Modify: `src/uiStore.ts` (estado transitorio de previsualización y último movimiento)
- Modify: `src/components/DetailPanel.tsx` (reemplaza el bloque "Mover cuenta entera"; texto de ayuda del panel vacío)

**Interfaces:**
- Consumes: `moverCuentaAMes` (Tarea 3); `simularDestinos`, `mesesCandidatos`, `planificarCuenta`, `ReporteMovimiento`, `MOTIVO_TEXTO` (Tareas 1-2); `mesSalidaDe` de `capacidad.ts`; `fechaCorteDe`, `margenesPorCuenta`, `nombreMes`, `ddmm` de `rules.ts`.
- Produces (en `UIState`):
  ```ts
  previsualizacion: { proyectoId: string; asignaciones: Asignacion[] } | null
  ultimoMovimiento: ReporteMovimiento | null
  setPrevisualizacion: (p: UIState['previsualizacion']) => void
  setUltimoMovimiento: (r: ReporteMovimiento | null) => void
  ```

- [ ] **Step 1: `uiStore.ts`**

Imports (arriba, junto a los existentes):
```ts
import type { Asignacion } from './types'
import type { ReporteMovimiento } from './planificador'
```
En `interface UIState`, después de `nombrePlan: string | null`:
```ts
  /** Fases fantasma que el timeline dibuja mientras el mouse está sobre un mes candidato del panel. Transitorio. */
  previsualizacion: { proyectoId: string; asignaciones: Asignacion[] } | null
  /** Qué cambió con el último movimiento de cuenta, para mostrarlo en el panel. Transitorio. */
  ultimoMovimiento: ReporteMovimiento | null
```
y entre los métodos:
```ts
  setPrevisualizacion: (p: { proyectoId: string; asignaciones: Asignacion[] } | null) => void
  setUltimoMovimiento: (r: ReporteMovimiento | null) => void
```
En el `create`, después de `nombrePlan: null,`:
```ts
  previsualizacion: null,
  ultimoMovimiento: null,
```
y después de `setNombrePlan: …`:
```ts
  setPrevisualizacion: (previsualizacion) => set({ previsualizacion }),
  setUltimoMovimiento: (ultimoMovimiento) => set({ ultimoMovimiento }),
```

- [ ] **Step 2: `DetailPanel.tsx` — imports y destructuring**

Reemplazar el bloque de imports por:
```tsx
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { useSimuladorStore } from '../store'
import { useUIStore } from '../uiStore'
import type { Asignacion, Persona, Proyecto, TipoFase, Violacion } from '../types'
import { tierDe, TIER_LABEL, type Tier } from '../insightsEquipo'
import { TIPO_COLOR, TIPO_LABEL, ORDEN_FASES } from '../theme/fases'
import { feriadosDeConfig, formatFechaCorta, toISO } from '../utils/dates'
import { ddmm, fechaCorteDe, margenesPorCuenta, nombreMes } from '../rules'
import { mesSalidaDe } from '../capacidad'
import { mesesCandidatos, planificarCuenta, simularDestinos, type Destino } from '../planificador'

const COLOR_TIER: Record<Tier, string> = {
  chica: 'var(--ok)', std: 'var(--celeste-dark)', grande: 'var(--fase-relev)', xl: 'var(--fase-cierre)',
}
```
En el destructuring del store quitar `shiftAccount` (deja de usarse acá).

- [ ] **Step 3: Reemplazar el bloque "Mover cuenta entera"**

Sustituir todo el `<div>` que empieza con el comentario `{/* Mover cuenta entera */}` por:
```tsx
          <BloqueSalida proyecto={proyecto} />
```

Y reemplazar el texto de ayuda del panel vacío (el segundo `<div>` dentro de `!proyecto`) por:
```tsx
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--t3)' }}>
            Para mover una cuenta de mes, elegí el mes en "Sale en vivo": las fases se rearman hacia atrás desde el corte de novedades. En el timeline: arrastrá una barra para ajustarla a mano · vertical reasigna persona · borde derecho estira. Arrastrá el fondo para desplazarte.
          </div>
```

- [ ] **Step 4: El componente `BloqueSalida`, después de `DetailPanel` y antes de `interface FaseCardProps`**

```tsx
/** Etiqueta corta de un mes 'YYYY-MM': 'oct 26'. */
function mesCortoDe(mes: string): string {
  return format(parseISO(`${mes}-01`), 'MMM yy', { locale: es })
}

const ESTILO_DESTINO: Record<Destino['estado'], { bg: string; bd: string; tx: string }> = {
  verde: { bg: 'var(--ok-bg)', bd: 'var(--ok-bd)', tx: 'var(--ok-tx)' },
  ambar: { bg: 'var(--warn-bg)', bd: 'var(--warn-bd)', tx: 'var(--warn-tx)' },
  rojo: { bg: 'var(--error-bg)', bd: 'var(--error-bd)', tx: 'var(--error-tx)' },
  gris: { bg: 'var(--line-soft)', bd: 'var(--line)', tx: 'var(--t3)' },
}

/**
 * La causa arriba, las consecuencias abajo: acá se elige el MES DE SALIDA de la cuenta y
 * las fechas de las fases se derivan del corte de novedades de ese mes. Cada mes candidato
 * se pinta según qué pasaría si la cuenta saliera ahí; al pasar el mouse, el timeline
 * muestra las fases fantasma en su lugar nuevo.
 */
function BloqueSalida({ proyecto }: { proyecto: Proyecto }) {
  const { asignaciones, personas, config, proyectos, moverCuentaAMes } = useSimuladorStore()
  const { setPrevisualizacion, ultimoMovimiento, setUltimoMovimiento } = useUIStore()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setError(null) }, [proyecto.id])

  const feriados = useMemo(() => feriadosDeConfig(config), [config])
  const mesActual = mesSalidaDe(proyecto.id, config)
  const tieneCorte = typeof config.cortes_novedades_dia?.[proyecto.id] === 'number'
  const corte = mesActual && tieneCorte ? fechaCorteDe(proyecto.id, mesActual, config, feriados) : null
  const margen = useMemo(
    () => margenesPorCuenta(asignaciones, config, proyectos).find(m => m.proyectoId === proyecto.id)?.habiles ?? null,
    [asignaciones, config, proyectos, proyecto.id],
  )
  const minimo = config.capacidad?.margen_minimo_habiles ?? 5
  const meses = useMemo(() => mesesCandidatos(config, toISO(new Date())), [config])
  const destinos = useMemo(
    () => (tieneCorte ? simularDestinos(proyecto.id, meses, asignaciones, personas, config, proyectos) : []),
    [tieneCorte, proyecto.id, meses, asignaciones, personas, config, proyectos],
  )

  function previsualizar(mes: string) {
    const plan = planificarCuenta(proyecto.id, asignaciones, mes, config)
    setPrevisualizacion(plan.ok ? { proyectoId: proyecto.id, asignaciones: plan.asignaciones } : null)
  }
  function elegir(mes: string) {
    setPrevisualizacion(null)
    const r = moverCuentaAMes(proyecto.id, mes)
    if (!r.ok) { setError(r.motivo ?? 'No se pudo mover la cuenta.'); return }
    setError(null)
    setUltimoMovimiento(r.reporte ?? null)
  }

  const reporte = ultimoMovimiento?.proyectoId === proyecto.id ? ultimoMovimiento : null

  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--sh-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--celeste-dark)' }}>Sale en vivo</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{mesActual ? nombreMes(mesActual) : 'sin definir'}</span>
      </div>
      <div className="num" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--t2)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {corte && <span>Corte de novedades <b style={{ color: 'var(--ink)' }}>{ddmm(corte)}</b></span>}
        {margen !== null && (
          <span>Margen <b style={{ color: margen < minimo ? 'var(--error-tx)' : 'var(--ink)' }}>{margen} hábil{margen !== 1 ? 'es' : ''}</b> hasta el corte</span>
        )}
      </div>

      {!tieneCorte ? (
        <div style={{ marginTop: 10, fontSize: 11.5, padding: '7px 10px', background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', borderRadius: 8, color: 'var(--warn-tx)', lineHeight: 1.4 }}>
          [FALTA: corte de novedades de {proyecto.nombre}] Sin ese dato no se puede ubicar la cuenta en un mes. Va en <code>config.cortes_novedades_dia</code>.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 10, fontSize: 10, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Moverla a</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {destinos.map(d => {
              const e = ESTILO_DESTINO[d.estado]
              const title = d.actual
                ? `Mes actual · corte ${d.corte ? ddmm(d.corte) : '—'} · margen ${d.margen ?? '—'}`
                : d.estado === 'gris'
                  ? d.motivo ?? ''
                  : `${d.motivo ?? 'Sin conflictos nuevos'} · corte ${d.corte ? ddmm(d.corte) : '—'} · margen ${d.margen ?? '—'} hábiles${d.deltaRojos < 0 ? ` · resuelve ${-d.deltaRojos} conflicto${-d.deltaRojos !== 1 ? 's' : ''}` : ''}`
              return (
                <button
                  key={d.mes}
                  disabled={d.estado === 'gris'}
                  title={title}
                  onMouseEnter={() => d.estado !== 'gris' && previsualizar(d.mes)}
                  onMouseLeave={() => setPrevisualizacion(null)}
                  onClick={() => elegir(d.mes)}
                  style={{
                    padding: '4px 9px', borderRadius: 9999, fontSize: 11, fontWeight: d.actual ? 800 : 600, cursor: d.estado === 'gris' ? 'not-allowed' : 'pointer',
                    background: e.bg, color: e.tx, border: `1.5px solid ${d.actual ? 'var(--celeste)' : e.bd}`,
                    boxShadow: d.actual ? '0 0 0 2px var(--celeste-dim)' : 'none', textTransform: 'capitalize',
                  }}
                >{mesCortoDe(d.mes)}</button>
              )
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--t3)', lineHeight: 1.4 }}>
            Verde entra sin conflictos nuevos · ámbar suma avisos · rojo rompe una regla. Pasá el mouse para ver las fases en el timeline; hacé clic para moverla. Las fechas se arman hacia atrás desde el corte; si después editás una fase a mano, volvé a elegir el mes para rearmarlas.
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 11.5, padding: '6px 9px', background: 'var(--error-bg)', border: '1px solid var(--error-bd)', borderRadius: 8, color: 'var(--error-tx)' }}>{error}</div>
      )}

      {reporte && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--t2)' }}>Qué cambió</div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t1)', lineHeight: 1.5 }}>
            {reporte.nombre}: <b>{reporte.mesAntes ? nombreMes(reporte.mesAntes) : 'sin mes'} → {nombreMes(reporte.mesDespues)}</b>. Corte {ddmm(reporte.corte)}, {reporte.margen} hábil{reporte.margen !== 1 ? 'es' : ''} de margen.
            {reporte.cierrePisaPruebas && ' La actualización final se pisa con las pruebas.'}
          </div>
          <div className="num" style={{ marginTop: 4, fontSize: 11.5, color: 'var(--t2)' }}>
            Conflictos {reporte.rojosAntes} → <b style={{ color: reporte.rojosDespues > reporte.rojosAntes ? 'var(--error-tx)' : 'var(--ink)' }}>{reporte.rojosDespues}</b> · Avisos {reporte.ambaresAntes} → <b style={{ color: 'var(--ink)' }}>{reporte.ambaresDespues}</b>
          </div>
          {reporte.nuevas.map((m, i) => (
            <div key={`n${i}`} style={{ marginTop: 4, fontSize: 11, padding: '5px 8px', background: 'var(--error-bg)', borderRadius: 6, color: 'var(--error-tx)' }}>{m}</div>
          ))}
          {reporte.resueltas.map((m, i) => (
            <div key={`r${i}`} style={{ marginTop: 4, fontSize: 11, padding: '5px 8px', background: 'var(--ok-bg)', borderRadius: 6, color: 'var(--ok-tx)' }}>Resuelto: {m}</div>
          ))}
          {reporte.cargas.length > 0 && (
            <div className="num" style={{ marginTop: 6, fontSize: 11, color: 'var(--t2)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {reporte.cargas.map(c => (
                <span key={`${c.alias}${c.mes}`}>{c.alias} en {nombreMes(c.mes).toLowerCase()}: {c.antes} → <b style={{ color: c.despues > c.capacidad ? 'var(--error-tx)' : 'var(--ink)' }}>{c.despues} h</b> de {c.capacidad}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

Borrar la constante `moverBtn` (ya no se usa).

- [ ] **Step 5: Typecheck, abrir en el navegador**

```bash
node node_modules/typescript/bin/tsc --noEmit
```
Levantar con las preview tools (`.claude/launch.json` del repo o `node node_modules/vite/bin/vite.js --port 5173`), importar `Downloads/planmigracionv5ordenwilly.json`, seleccionar Piano. Verificar: el bloque dice "Sale en vivo · Octubre 2026", corte 20/10, margen; la tira tiene un chip por mes con el actual resaltado; noviembre se ve rojo (tope); al hacer clic en un mes las fases se mueven y aparece "Qué cambió"; Ctrl+Z deshace (fases y mes). Probar además con el fixture `test/fixtures/plan-v3.json`.

- [ ] **Step 6: Commit**

```bash
git add src/uiStore.ts src/components/DetailPanel.tsx
git commit -m "Panel de la cuenta: elegir el mes de salida rearma las fases desde el corte y muestra qué cambió"
```

---

### Task 5: Fases fantasma en el timeline

**Files:**
- Modify: `src/components/Timeline.tsx` — destructuring de `useUIStore` (~línea 160), opacidad de las barras (~línea 695), bloque nuevo de barras fantasma después del `map` de barras (~línea 715).

**Interfaces:**
- Consumes: `previsualizacion` de `useUIStore` (Tarea 4); `TIPO_COLOR`; `dateToX`, `filaDe`, `filaIdDe`, `ROW_H`, `BAR_H`, `MIN_BAR_W`, `pxPerDay` ya definidos en el componente.

- [ ] **Step 1: Leer `previsualizacion` del uiStore**

En el destructuring:
```ts
  const {
    mostrarCarga, mostrarDep, mostrarConflictos, zoom, irHoyToken, modoMovimiento, densidad,
    ordenPersonas, personasOcultas, previsualizacion,
  } = useUIStore()
```

- [ ] **Step 2: Atenuar las barras reales de la cuenta previsualizada**

En el `style` de la barra, reemplazar la línea de `opacity`:
```ts
                  opacity: a.es_bloqueo ? (atenuada ? 0.25 : 0.55)
                    : previsualizacion?.proyectoId === a.proyecto_id ? 0.22
                    : (atenuada ? 0.38 : 1),
```

- [ ] **Step 3: Dibujar las fantasma**

Justo después del cierre del `{asignaciones.map(a => { … })}` de las barras (antes del `</div>` que cierra `rowsRef`):
```tsx
          {/* Fases fantasma: dónde quedaría la cuenta si saliera en el mes que el mouse está tocando en el panel. */}
          {previsualizacion?.asignaciones.map(a => {
            const row = filaDe.get(filaIdDe(a))
            if (row == null) return null
            const left = dateToX(a.inicio)
            const width = Math.max(MIN_BAR_W, dateToX(a.fin) + pxPerDay - left)
            const top = row * ROW_H + (ROW_H - BAR_H) / 2
            return (
              <div key={`prev-${a.id}`} title={`${a.inicio} → ${a.fin}`} style={{
                position: 'absolute', left, top, width, height: BAR_H, zIndex: 12, pointerEvents: 'none',
                borderRadius: BAR_H > 34 ? 8 : 6, border: `2px dashed ${TIPO_COLOR[a.tipo]}`,
                background: 'var(--white)', opacity: 0.92, boxSizing: 'border-box',
              }} />
            )
          })}
```

- [ ] **Step 4: Verificar en el navegador**

Typecheck y abrir: seleccionar Piano, pasar el mouse por "nov 26" en el panel → las 8 barras de Piano se atenúan y aparecen 8 contornos punteados con el color de cada fase en las filas de Gaby, Guille y Moni, en noviembre. Sacar el mouse → desaparecen. Probar también en zoom Meses y Semanas.

- [ ] **Step 5: Commit**

```bash
git add src/components/Timeline.tsx
git commit -m "Timeline: fases fantasma al pasar el mouse por un mes candidato"
```

---

### Task 6: "Replanificar desde el corte" en el menú Más

**Files:**
- Modify: `src/components/ConfigPanel.tsx` — destructuring (~línea 27), handler (~línea 50), ítem del menú (~línea 160).

- [ ] **Step 1: Destructuring y handler**

Agregar `replanificarDesdeElCorte` al destructuring de `useSimuladorStore`. Después de `handleAutoPlanificar`:
```ts
  function handleReplanificar() {
    setMasAbierto(false)
    const r = replanificarDesdeElCorte()
    const partes = [`${r.replanificadas} cuenta${r.replanificadas !== 1 ? 's' : ''} rearmada${r.replanificadas !== 1 ? 's' : ''} desde su corte.`]
    if (r.sinCorte.length) partes.push(`Sin corte de novedades (no se tocaron): ${r.sinCorte.join(', ')}.`)
    if (r.sinLugar.length) partes.push(`Sin lugar antes del corte (no se tocaron): ${r.sinLugar.join(', ')}.`)
    alert(partes.join('\n'))
  }
```

- [ ] **Step 2: Ítem del menú**

Después del `<MenuItem … >🪄 Planificar pendientes</MenuItem>`:
```tsx
              <MenuItem onClick={handleReplanificar} title="Rearma las fechas de cada cuenta hacia atrás desde el corte de novedades de su mes de salida: margen mínimo, blackout, lunes y feriados. No cambia quién hace qué ni cuánto dura cada fase.">🧭 Replanificar desde el corte</MenuItem>
```

- [ ] **Step 3: Verificar**

Typecheck. En el navegador con el v5 importado: Más → Replanificar desde el corte → alerta "13 cuentas rearmadas…"; el chip de estado no debe sumar conflictos de margen/blackout/dependencia. Ctrl+Z vuelve.

- [ ] **Step 4: Commit**

```bash
git add src/components/ConfigPanel.tsx
git commit -m "Más → Replanificar desde el corte: rearma todas las cuentas con las reglas del calendario"
```

---

### Task 7: Documentación y decisión

**Files:**
- Modify: `CLAUDE.md` del repo (§1 tabla de archivos implícita en §2/§3, §6).
- Modify (fuera del repo, sin git): `…/project plan migraciones/Herramientas-Tecnicas/scripts/armar_calendario_migracion.py` (nota al inicio del docstring) y `…/Herramientas-Tecnicas/DECISIONES.md` (entrada nueva).
- Modify: memoria `simulador-plan-migracion-reparto-y-vista.md`.

- [ ] **Step 1: `CLAUDE.md` §2** — después del párrafo "**Mes de salida en vivo es dato** …" agregar:

```markdown
**Mover una cuenta es cambiar su mes de salida**, no arrastrar sus barras. `src/planificador.ts`
porta el algoritmo del script `armar_calendario_migracion.py`: desde el corte de novedades del
mes elegido arma hacia atrás Pruebas (margen mínimo, fuera del blackout), Configuración,
Relevamiento y el Cierre pegado al corte; conserva id, persona, duración y dedicación de cada
barra. El panel de la cuenta muestra cada mes candidato pintado según qué pasaría (simula y corre
las reglas), previsualiza en el timeline y, al aplicar, actualiza `salidas_en_vivo_propuestas` y
resume qué cambió. "Más → Replanificar desde el corte" hace lo mismo para todas las cuentas. Lo
que el planificador NO resuelve a propósito son los choques de carga: quedan en las reglas para
decidirlos a mano.
```

- [ ] **Step 2: Nota en el script Python** — reemplazar la primera línea del docstring `Arma el calendario de migraciones …` por:

```
SUPERSEDIDO (10/09/2026): este algoritmo vive ahora en la app, en src/planificador.ts
(panel de la cuenta → "Sale en vivo", y "Más → Replanificar desde el corte"). El JSON se
exporta desde la app. Este script queda como referencia del algoritmo y para regenerar
un plan desde cero si hiciera falta.

Arma el calendario de migraciones (asignaciones del simulador) desde las reglas,
```

- [ ] **Step 3: `DECISIONES.md`** — entrada al final:

```markdown
## D-XX · 10/09/2026 · El planificador hacia atrás pasa del script Python a la app

**Antes:** cambiar el orden de las cuentas era editar `SALIDAS` en `armar_calendario_migracion.py`,
correrlo, importar el JSON. En la app, "Mover cuenta entera ±1 sem" corría las barras pero no el
mes de salida: la regla de margen comparaba contra el corte del mes viejo, el tope contaba la
cuenta en el mes viejo y la disponibilidad de Moni no se enteraba.

**Después:** `src/planificador.ts` en la app arma las fases hacia atrás desde el corte del mes
elegido, actualiza `salidas_en_vivo_propuestas`, muestra antes de elegir en qué meses entra la
cuenta y qué cambia al moverla. Una sola fuente de verdad; el script queda como referencia.

**Por qué:** Willy revisa el orden con su jefe en la pantalla, no en el JSON. Con el motor
afuera, cada "qué pasa si" pasaba por el chat.

**Queda abierto:** el alta de una cuenta nueva sigue planificando hacia adelante (`addProyecto`);
para planificarla hacia atrás necesita mes de salida y corte al crearla.
```

- [ ] **Step 4: Memoria** — en `simulador-plan-migracion-reparto-y-vista.md` reemplazar el párrafo "**El bloqueo real no es la carga: son las predecesoras.**" por uno que diga que desde el 10/09/2026 mover una cuenta de mes replanifica desde el corte (`src/planificador.ts`), que el script Python quedó supersedido, y que la corrección de capacidad (Guille 88 h/mes con el 0,6) invalida la conclusión de "entra en 6 de 8 meses".

- [ ] **Step 5: Commit (solo lo del repo)**

```bash
git add CLAUDE.md specs/2026-09-10-replanificar-desde-el-corte-PLAN.md
git commit -m "Docs: el mes de salida se mueve desde el panel y arrastra las fases"
```

---

### Task 8: Verificación final, PR y merge

- [ ] **Step 1: Toda la batería**

```bash
for t in duraciones migracion reglas equipo confidencial importar resumen planificador; do node node_modules/esbuild/bin/esbuild test/$t.test.ts --bundle --platform=node --format=esm --loader:.json=json --outfile=dist/.test-$t.mjs --log-level=warning && node dist/.test-$t.mjs | tail -1; done
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```
Esperado: cada test termina en `TODO OK` / `OK`; tsc y build sin errores.

- [ ] **Step 2: Recorrido en el navegador con el v5 de Willy**

1. Importar `planmigracionv5ordenwilly.json`. Chip de estado: anotar conflictos/avisos.
2. Seleccionar Piano → "Sale en vivo · Octubre 2026 · corte 20/10". Tira de meses con octubre resaltado.
3. Pasar el mouse por "nov 26": fantasmas en el timeline. Clic: las 8 barras se mueven, "Qué cambió" aparece con el tope de noviembre en rojo. Insights → la ola muestra Piano en noviembre. Equipo → la fila de Piano dice noviembre. Resumen → el video cuenta las salidas nuevas.
4. Ctrl+Z → vuelve a octubre en las tres pestañas.
5. Más → Replanificar desde el corte → 13 cuentas; ninguna regla de calendario en rojo.
6. Exportar → el JSON trae `salidas_en_vivo_propuestas` con el mes nuevo → volver a importar → igual.
7. Importar `test/fixtures/plan-v3.json` (7 barras con corrida) → el bloque funciona igual.

- [ ] **Step 3: PR y merge**

```bash
git push -u origin feat/replanificar-desde-el-corte
"C:\Program Files\GitHub CLI\gh.exe" pr create --base main --title "Mover una cuenta de mes replanifica sus fases desde el corte de novedades" --body-file specs/2026-09-10-replanificar-desde-el-corte-PLAN.md
"C:\Program Files\GitHub CLI\gh.exe" pr merge --merge --delete-branch
```
El deploy a GitHub Pages corre `npm test` y `npm run build` en CI antes de publicar.

---

## Fuera de alcance (anotado, no se construye)

- Alta de cuenta nueva con mes de salida y corte (hoy planifica hacia adelante).
- Cambiar el tier de una cuenta desde el panel (las duraciones se conservan; para cambiarlas se edita cada fase).
- Timeline con filas por cuenta (opción A del canvas de mockups): es otra sesión.
- Pintar los meses candidatos en el encabezado del timeline además de en el panel.
