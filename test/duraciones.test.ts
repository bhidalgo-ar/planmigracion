/**
 * Tests del cálculo de duraciones por horas y disponibilidad, y de las reglas.
 * Son la única red del proyecto: no hay framework de tests, se corren con `npm test`
 * (esbuild empaqueta y node ejecuta). Cada `check` imprime una línea; al final el
 * proceso sale con código 1 si algo falló.
 *
 * Los números esperados salen de la sección 4 de specs/disponibilidad-por-persona-y-ano.md.
 */

// localStorage falso: zustand/persist lo pide al importar el store.
const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
}

import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { calcularFin, calcularFinPorHoras, diasHabiles, feriadosDeConfig, siguienteDiaHabil } from '../src/utils/dates'
import { checkRule2, checkRule3, limiteDeCarga } from '../src/rules'
import configRaw from '../data/config.json'
import planFixture from './fixtures/plan-con-disponibilidad.json'

const config = configRaw as unknown as Config
const feriados = feriadosDeConfig(config)

let fallos = 0
let corridos = 0

function check(nombre: string, ok: boolean, detalle = '') {
  corridos++
  if (ok) {
    console.log(`  ok   ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  } else {
    fallos++
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  }
}

function eq(nombre: string, actual: unknown, esperado: unknown) {
  check(nombre, actual === esperado, `esperado ${String(esperado)}, obtenido ${String(actual)}`)
}

/** Aviso: no es una regresión, es algo que hay que mirar a ojo (no cuenta como falla). */
function aviso(nombre: string, ok: boolean, detalle = '') {
  corridos++
  console.log(`  ${ok ? 'ok  ' : 'AVISO'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
}

function titulo(t: string) {
  console.log(`\n${t}`)
}

// ── calcularFin (arrastre manual de barras: sigue funcionando por días) ──────────
titulo('calcularFin — duración en días hábiles')
eq('5 días desde lunes 2026-06-01 terminan el viernes', calcularFin('2026-06-01', 5, feriados), '2026-06-05')
eq('1 día es el mismo día', calcularFin('2026-06-01', 1, feriados), '2026-06-01')
eq('arrancar sábado corre al lunes hábil', calcularFin('2026-06-06', 1, feriados), '2026-06-08')
eq('saltea el feriado del 15/6/2026', calcularFin('2026-06-15', 1, feriados), '2026-06-16')
eq('5 días cruzando el feriado del 20/6 (sábado) no cambian', calcularFin('2026-06-22', 5, feriados), '2026-06-26')
eq('10 días desde 2026-06-08 (con feriado 15/6)', calcularFin('2026-06-08', 10, feriados), '2026-06-22')
eq('diasHabiles es el inverso de calcularFin', diasHabiles('2026-06-08', '2026-06-22', feriados), 10)

titulo('siguienteDiaHabil — handoff entre fases')
eq('del viernes al lunes', siguienteDiaHabil('2026-06-05', feriados), '2026-06-08')
eq('nunca devuelve el mismo día', siguienteDiaHabil('2026-06-08', feriados), '2026-06-09')
eq('saltea el feriado del 15/6', siguienteDiaHabil('2026-06-12', feriados), '2026-06-16')

// ── Eval 1: tabla de duraciones de cuenta estándar ───────────────────────────────
const HORAS = config.horas_por_fase!
const dur = (inicio: string, horas: number, persona: string) =>
  calcularFinPorHoras(inicio, horas, persona, config, feriados).duracion_dias

// Arranques elegidos para no cruzar el 31/12 con ninguna de las duraciones de la tabla.
const INICIO_2026 = '2026-09-01'
const INICIO_2027 = '2027-09-01'

titulo('Eval 1 — cuenta estándar: días por persona y año')
const TABLA_ESTANDAR: Array<[string, string, number, number, number]> = [
  // persona, inicio, Relevamiento, Configuracion, Pruebas
  ['leo',    INICIO_2026, 10, 13, 16],
  ['susi',   INICIO_2026, 10, 13, 16],
  ['leo',    INICIO_2027,  8, 10, 13],
  ['susi',   INICIO_2027,  8, 10, 13],
  ['moni',   INICIO_2026,  9, 12, 14],
  ['moni',   INICIO_2027, 12, 15, 19],
  ['gaby_f', INICIO_2026, 14, 18, 22],
  ['gaby_f', INICIO_2027, 14, 18, 22],
  ['lau',    INICIO_2026,  7,  9, 11],
  ['axton',  INICIO_2026,  7,  9, 11],
  ['lau',    INICIO_2027,  7,  9, 11],
  ['axton',  INICIO_2027,  7,  9, 11],
]
for (const [persona, inicio, relev, conf, prue] of TABLA_ESTANDAR) {
  const anio = inicio.slice(0, 4)
  eq(`${persona} ${anio} Relevamiento`, dur(inicio, HORAS.estandar.Relevamiento, persona), relev)
  eq(`${persona} ${anio} Configuracion`, dur(inicio, HORAS.estandar.Configuracion, persona), conf)
  eq(`${persona} ${anio} Pruebas`, dur(inicio, HORAS.estandar.Pruebas, persona), prue)
}

// ── Eval 2: cuenta chica ─────────────────────────────────────────────────────────
titulo('Eval 2 — cuenta chica (complejidad baja)')
const TABLA_CHICA: Array<[string, string, number, number, number]> = [
  ['leo',   INICIO_2026, 7, 12, 9],
  ['susi',  INICIO_2026, 7, 12, 9],
  ['lau',   INICIO_2026, 5,  9, 6],
  ['axton', INICIO_2026, 5,  9, 6],
]
for (const [persona, inicio, relev, conf, prue] of TABLA_CHICA) {
  eq(`${persona} chica Relevamiento`, dur(inicio, HORAS.chica.Relevamiento, persona), relev)
  eq(`${persona} chica Configuracion`, dur(inicio, HORAS.chica.Configuracion, persona), conf)
  eq(`${persona} chica Pruebas`, dur(inicio, HORAS.chica.Pruebas, persona), prue)
}

// ── Eval 3: cruce de año ─────────────────────────────────────────────────────────
titulo('Eval 3 — cruce del 31/12: consumo día por día')
const cruce = calcularFinPorHoras('2026-12-21', HORAS.estandar.Configuracion, 'moni', config, feriados)
check('config de moni del 21/12/2026 dura más de 12 días', cruce.duracion_dias > 12, `dio ${cruce.duracion_dias}`)
check('config de moni del 21/12/2026 dura menos de 15 días', cruce.duracion_dias < 15, `dio ${cruce.duracion_dias}`)
check('la dedicación promedio queda entre el 60% y el 80%',
  cruce.dedicacion_promedio > 0.6 && cruce.dedicacion_promedio < 0.8, `dio ${cruce.dedicacion_promedio}`)
// Dentro de cada año la duración es estable: el cruce no es un escalón del 31/12.
eq('la misma fase entera en 2026 dura 12', dur('2026-11-02', HORAS.estandar.Configuracion, 'moni'), 12)
eq('la misma fase entera en 2027 dura 15', dur('2027-02-15', HORAS.estandar.Configuracion, 'moni'), 15)
check('un día antes o después del cruce no salta de 12 a 15 de golpe',
  dur('2026-12-18', HORAS.estandar.Configuracion, 'moni') >= 12 &&
  dur('2026-12-22', HORAS.estandar.Configuracion, 'moni') <= 15,
  `18/12 → ${dur('2026-12-18', HORAS.estandar.Configuracion, 'moni')}, 22/12 → ${dur('2026-12-22', HORAS.estandar.Configuracion, 'moni')}`)

titulo('calcularFinPorHoras — casos borde')
eq('siempre consume al menos un día hábil', dur('2026-09-01', 0, 'lau'), 1)
eq('un inicio en fin de semana arranca el lunes',
  calcularFinPorHoras('2026-09-05', 8, 'lau', config, feriados).fin, '2026-09-07')
eq('una persona que no está en la tabla usa el default (100%)',
  dur(INICIO_2026, HORAS.estandar.Relevamiento, 'nadie'), 7)

// ── Eval 6: Regla 2 con la capacidad real de la persona ──────────────────────────
titulo('Eval 6 — Regla 2 respeta la capacidad de cada persona')
const personasFix = planFixture.personas as unknown as Persona[]
const gaby = personasFix.find(p => p.id === 'gaby_f')!
const moni = personasFix.find(p => p.id === 'moni')!
eq('límite de gaby (20 hs/sem) es 0.5', limiteDeCarga(gaby), 0.5)
eq('límite de moni (40 hs/sem) es 1', limiteDeCarga(moni), 1)
eq('límite con buffer del 20% sobre jornada completa', limiteDeCarga({ ...moni, buffer_pct: 0.2 }), 0.8)

function fase(over: Partial<Asignacion>): Asignacion {
  return {
    id: 'x', proyecto_id: 'p1', tipo: 'Configuracion', persona_id: 'gaby_f',
    inicio: '2026-09-01', fin: '2026-09-04', duracion_dias: 4, dedicacion_pct: 0.5,
    predecesoras: [], es_bloqueo: false, ...over,
  }
}
const dosDeGaby = [
  fase({ id: 'a', proyecto_id: 'cliente_a' }),
  fase({ id: 'b', proyecto_id: 'cliente_b' }),
]
const r2Gaby = checkRule2(dosDeGaby, [gaby], config)
check('gaby con dos fases de 0,5 el mismo día dispara rojo',
  r2Gaby.some(v => v.severidad === 'rojo'), `violaciones: ${r2Gaby.length}`)
const r2Moni = checkRule2(
  dosDeGaby.map(a => ({ ...a, persona_id: 'moni' })), [moni], config)
check('moni con las mismas dos fases de 0,5 no dispara rojo',
  !r2Moni.some(v => v.severidad === 'rojo'), `violaciones: ${r2Moni.length}`)

// ── Eval 4 + 5: importar el plan de 52 asignaciones y recalcular ─────────────────
titulo('Eval 4 — importar un plan exportado')
const { useSimuladorStore } = await import('../src/store')
const store = useSimuladorStore.getState()

const personasAntes = (planFixture.asignaciones as Asignacion[]).map(a => `${a.id}=${a.persona_id}`).join('|')
store.importarJSON(JSON.stringify(planFixture))
const tras = useSimuladorStore.getState()
eq('entran las 52 asignaciones', tras.asignaciones.length, 52)
eq('ningún persona_id cambia',
  tras.asignaciones.map(a => `${a.id}=${a.persona_id}`).join('|'), personasAntes)
check('las claves del esquema de Asignacion se preservan',
  tras.asignaciones.every(a => ['id', 'proyecto_id', 'tipo', 'persona_id', 'inicio', 'fin',
    'duracion_dias', 'dedicacion_pct', 'predecesoras', 'es_bloqueo'].every(k => k in a)))
check('un plan sin las tablas nuevas las hereda del seed', (() => {
  const viejo = JSON.parse(JSON.stringify(planFixture)) as { config: Record<string, unknown> }
  delete viejo.config.horas_por_fase
  delete viejo.config.disponibilidad
  useSimuladorStore.getState().importarJSON(JSON.stringify(viejo))
  const c = useSimuladorStore.getState().config
  return !!c.horas_por_fase && !!c.disponibilidad
})())
eq('el export sigue siendo importable',
  (() => {
    const json = useSimuladorStore.getState().exportarJSON()
    useSimuladorStore.getState().importarJSON(json)
    return useSimuladorStore.getState().asignaciones.length
  })(), 52)

titulo('Eval 5 — Recalcular duraciones')
useSimuladorStore.getState().importarJSON(JSON.stringify(planFixture))
const personasPre = new Map(useSimuladorStore.getState().asignaciones.map(a => [a.id, a.persona_id]))
const idsPre = useSimuladorStore.getState().asignaciones.map(a => a.id).join('|')
// Violaciones que YA trae el plan importado: el recálculo no debe agregar ninguna.
const r3Pre = checkRule3(useSimuladorStore.getState().asignaciones)
const reporte = useSimuladorStore.getState().recalcularDuraciones()
const post = useSimuladorStore.getState()

eq('no se pierde ni se crea ninguna asignación', post.asignaciones.length, 52)
eq('los ids se preservan', post.asignaciones.map(a => a.id).join('|'), idsPre)
check('ningún persona_id cambia al recalcular',
  post.asignaciones.every(a => personasPre.get(a.id) === a.persona_id))
check('el bloqueo queda intacto',
  post.asignaciones.find(a => a.id === 'tasa-config')?.duracion_dias === 88)

// La única R3 que sobrevive es del bloqueo de supervisión de TASA, que ya venía en el plan:
// TASA es `especial: true` (fuera del recálculo) y la Regla 3 no se toca en este cambio.
const r3 = checkRule3(post.asignaciones)
eq('el recálculo no agrega violaciones de Regla 3', r3.length, r3Pre.length)
eq('cero violaciones de Regla 3 fuera de TASA', r3.filter(v => !v.asignacion_id.startsWith('tasa-')).length, 0)
for (const v of r3.slice(0, 8)) console.log(`       R3 preexistente: ${v.mensaje}`)

const r2rojo = checkRule2(post.asignaciones, post.personas, post.config).filter(v => v.severidad === 'rojo')
eq('cero violaciones de Regla 2 en rojo', r2rojo.length, 0)
if (r2rojo.length) for (const v of r2rojo.slice(0, 8)) console.log(`       R2: ${v.mensaje}`)

check('deshacer devuelve el plan anterior al recálculo', (() => {
  const antes = post.asignaciones.map(a => a.fin).join('|')
  useSimuladorStore.getState().undo()
  const vuelto = useSimuladorStore.getState().asignaciones.map(a => a.fin).join('|')
  return vuelto !== antes && useSimuladorStore.getState().asignaciones.length === 52
})())

check('el recálculo nunca corre una fase hacia atrás',
  reporte.movidas.every(m => m.diasHabiles > 0),
  `hacia atrás: ${reporte.movidas.filter(m => m.diasHabiles < 0).length}`)

// Guardrail de la spec (§5): si una fase se corre más de 30 días hábiles hay que consultar
// antes de dar el recálculo por bueno. No es una regresión del código: es la señal de que
// el plan no cierra con las horas reales. Se lista para revisarlo a ojo.
const peor = reporte.movidas.reduce((m, x) => (Math.abs(x.diasHabiles) > Math.abs(m.diasHabiles) ? x : m),
  { id: '—', antes: '', despues: '', diasHabiles: 0 })
console.log(`\n  Recálculo: ${reporte.recalculadas} fases, ${reporte.intactas} intactas, ${reporte.movidas.length} movidas.`)
console.log(`  Corrimiento máximo: ${peor.diasHabiles} días hábiles (${peor.id} ${peor.antes} → ${peor.despues})`)
for (const m of [...reporte.movidas].sort((a, b) => Math.abs(b.diasHabiles) - Math.abs(a.diasHabiles)).slice(0, 12)) {
  console.log(`    ${m.diasHabiles > 0 ? '+' : ''}${m.diasHabiles} d.h.  ${m.id}  ${m.antes} → ${m.despues}`)
}
const pasadas = reporte.movidas.filter(m => Math.abs(m.diasHabiles) > 30)
aviso('ninguna fase se corre más de 30 días hábiles', pasadas.length === 0,
  pasadas.length ? `${pasadas.length} pasan el umbral: ${pasadas.map(m => `${m.id} ${m.diasHabiles > 0 ? '+' : ''}${m.diasHabiles}`).join(', ')} — REVISAR` : '')

// ── Seed limpio: Reset → planificar pendientes ───────────────────────────────────
titulo('Seed limpio — Reset y planificación automática')
useSimuladorStore.getState().resetToSeed()
const seed = useSimuladorStore.getState()
check('el seed trae las tablas de horas y disponibilidad (sobreviven al Reset)',
  !!seed.config.horas_por_fase && !!seed.config.disponibilidad && !!seed.config.template_estandar)
const { creadas } = useSimuladorStore.getState().autoPlanificarPendientes()
const planificado = useSimuladorStore.getState()
check('planificar pendientes crea fases', creadas > 0, `${creadas} fases`)
const r2SeedRojo = checkRule2(planificado.asignaciones, planificado.personas, planificado.config)
  .filter(v => v.severidad === 'rojo')
eq('el plan automático no genera sobreasignación en rojo', r2SeedRojo.length, 0)
eq('el plan automático no genera dependencias fuera de orden', checkRule3(planificado.asignaciones).length, 0)

const repartoConfig = new Map<string, number>()
for (const a of planificado.asignaciones.filter(a => a.tipo === 'Configuracion')) {
  repartoConfig.set(a.persona_id, (repartoConfig.get(a.persona_id) ?? 0) + 1)
}
console.log(`    reparto de Configuración: ${[...repartoConfig].map(([p, n]) => `${p}=${n}`).join(', ')}`)
check('las configuraciones se reparten entre varios (antes caían todas en axton)',
  repartoConfig.size > 1, `${repartoConfig.size} personas`)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
