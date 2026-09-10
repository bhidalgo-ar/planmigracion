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
import { checkDependenciaConfigPruebas, computeViolaciones } from '../src/rules'
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
  ['susi',   INICIO_2026, 10, 13, 16],
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

// (La Regla 2 por día y `limiteDeCarga` se retiraron el 10/09/2026: la carga se controla
//  por horas mensuales contra capacidad. Ver test/reglas.test.ts.)

// ── migrate: localStorage de una versión vieja de la app ────────────────────────
titulo('migrate — un plan ya persistido antes de horas_por_fase/disponibilidad/cartera_legacy_axton')
// Simula lo que había en localStorage antes de esta tanda de cambios: version 3,
// config sin las claves nuevas. Tiene que pasar por `migrate` al importar el store
// (rehydration corre en el import porque el localStorage falso es sincrónico).
mem.set('simulador-ha-v2', JSON.stringify({
  state: {
    personas: (planFixture.personas as Persona[]),
    proyectos: (planFixture.proyectos as Proyecto[]),
    asignaciones: (planFixture.asignaciones as Asignacion[]),
    config: (() => {
      const c = { ...(planFixture.config as Record<string, unknown>) }
      delete c.horas_por_fase; delete c.disponibilidad; delete c.cartera_legacy_axton
      return c
    })(),
  },
  version: 3,
}))

const { useSimuladorStore } = await import('../src/store')
const store = useSimuladorStore.getState()

check('migrate completó las tablas nuevas en un plan ya persistido',
  !!store.config.horas_por_fase && !!store.config.disponibilidad && !!store.config.cartera_legacy_axton?.cuentas.length,
  `horas_por_fase=${!!store.config.horas_por_fase} disponibilidad=${!!store.config.disponibilidad} cartera=${!!store.config.cartera_legacy_axton?.cuentas.length}`)
eq('y no tocó el resto del config ya persistido (unidades sigue igual)',
  store.config.unidades.horas_por_dia, (planFixture.config as Config).unidades.horas_por_dia)
eq('el plan persistido (52 asignaciones) sigue ahí después del migrate',
  store.asignaciones.length, 52)

// ── Eval 4 + 5: importar el plan de 52 asignaciones y recalcular ─────────────────
titulo('Eval 4 — importar un plan exportado')

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
  delete viejo.config.cartera_legacy_axton
  useSimuladorStore.getState().importarJSON(JSON.stringify(viejo))
  const c = useSimuladorStore.getState().config
  return !!c.horas_por_fase && !!c.disponibilidad && !!c.cartera_legacy_axton?.cuentas.length
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
const iniciosPre = useSimuladorStore.getState().asignaciones.map(a => `${a.id}=${a.inicio}`).join('|')
const reporte = useSimuladorStore.getState().recalcularDuraciones()
const post = useSimuladorStore.getState()

eq('no se pierde ni se crea ninguna asignación', post.asignaciones.length, 52)
eq('los ids se preservan', post.asignaciones.map(a => a.id).join('|'), idsPre)
check('ningún persona_id cambia al recalcular',
  post.asignaciones.every(a => personasPre.get(a.id) === a.persona_id))
check('el bloqueo queda intacto',
  post.asignaciones.find(a => a.id === 'tasa-config')?.duracion_dias === 88)

eq('las fechas de inicio no se mueven',
  post.asignaciones.map(a => `${a.id}=${a.inicio}`).join('|'), iniciosPre)
check('los bloqueos no arrastran predecesoras (no rompen la Regla 3)',
  post.asignaciones.filter(a => a.es_bloqueo).every(a => a.predecesoras.length === 0))
eq('el bloqueo de supervisión de TASA no dispara la dependencia Config → Pruebas',
  checkDependenciaConfigPruebas(post.asignaciones, post.proyectos).filter(v => v.asignacion_id === 'tasa-config').length, 0)

check('deshacer devuelve el plan anterior al recálculo', (() => {
  const antes = post.asignaciones.map(a => a.fin).join('|')
  useSimuladorStore.getState().undo()
  const vuelto = useSimuladorStore.getState().asignaciones.map(a => a.fin).join('|')
  return vuelto !== antes && useSimuladorStore.getState().asignaciones.length === 52
})())

// El recálculo no reacomoda nada: al estirarse las duraciones quedan choques de carga.
// Se listan para resolverlos a mano en el timeline (condición de salida de la spec §6).
console.log(`\n  Recálculo: ${reporte.recalculadas} fases, ${reporte.intactas} intactas, ${reporte.cambiadas.length} cambiaron de duración.`)
for (const c of [...reporte.cambiadas].sort((a, b) => (b.diasDespues - b.diasAntes) - (a.diasDespues - a.diasAntes)).slice(0, 10)) {
  console.log(`    ${c.id}: ${c.diasAntes} → ${c.diasDespues} días`)
}
const rojosPost = computeViolaciones(post.asignaciones, post.personas, post.config, post.proyectos)
  .filter(v => v.severidad === 'rojo')
console.log(`\n  A resolver a mano en el timeline: ${rojosPost.length} conflictos en rojo`)
for (const v of rojosPost.slice(0, 6)) console.log(`      ${v.mensaje}`)
eq('el reporte del recálculo cuenta los conflictos que quedan', reporte.conflictos, rojosPost.length)
aviso('el plan cierra sin conflictos', rojosPost.length === 0,
  `${rojosPost.length} conflictos — hay que acomodar barras (esperado: el recálculo no mueve fechas)`)

// ── Seed limpio: Reset → planificar pendientes ───────────────────────────────────
titulo('Seed limpio — Reset y planificación automática')
useSimuladorStore.getState().resetToSeed()
const seed = useSimuladorStore.getState()
check('el seed trae las tablas de horas y disponibilidad (sobreviven al Reset)',
  !!seed.config.horas_por_fase && !!seed.config.disponibilidad && !!seed.config.template_estandar)
const { creadas } = useSimuladorStore.getState().autoPlanificarPendientes()
const planificado = useSimuladorStore.getState()
check('planificar pendientes crea fases', creadas > 0, `${creadas} fases`)
const rojosSeed = computeViolaciones(planificado.asignaciones, planificado.personas, planificado.config, planificado.proyectos)
  .filter(v => v.severidad === 'rojo')
aviso('el plan automático no deja a nadie por encima de su capacidad mensual',
  rojosSeed.filter(v => v.tipo === 'carga_mes').length === 0,
  `${rojosSeed.filter(v => v.tipo === 'carga_mes').length} meses en rojo (el planificador todavía busca hueco por día, no por horas mensuales)`)
eq('el plan automático no arranca pruebas antes de cerrar la configuración',
  checkDependenciaConfigPruebas(planificado.asignaciones, planificado.proyectos).length, 0)

const repartoConfig = new Map<string, number>()
for (const a of planificado.asignaciones.filter(a => a.tipo === 'Configuracion')) {
  repartoConfig.set(a.persona_id, (repartoConfig.get(a.persona_id) ?? 0) + 1)
}
console.log(`    reparto de Configuración: ${[...repartoConfig].map(([p, n]) => `${p}=${n}`).join(', ')}`)
// Sin Leo en el seed (decisión 10/09/2026) el único relevador es Lau al 100%: releva tan
// rápido que Axton (también al 100%) siempre llega a tomar la configuración siguiente.
// Es una propiedad del planificador automático, no del motor de reglas: queda como aviso.
aviso('las configuraciones se reparten entre varios',
  repartoConfig.size > 1, `${repartoConfig.size} persona(s): el planificador elige al que termina antes`)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
