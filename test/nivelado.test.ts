/**
 * Tests del planificador que respeta capacidad (src/planificadorNivelado.ts), de la
 * extrapolación del corte de novedades y del margen sin la primera liquidación (src/rules.ts).
 * Willy, 23/10/2026: "que tenga la inteligencia de la Mesa de salidas".
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import {
  cuentaArrancada, esLiquidacionEnVivo, maxMesesDe, planificarCuentaNivelada, replanificarTodoNivelado,
} from '../src/planificadorNivelado'
import { fechaCorteDe, margenesPorCuenta, medianaDiaCorte, origenCorteDe } from '../src/rules'
import { cargaDiaria } from '../src/capacidad'
import { cuentasPorDia, topeParalelo } from '../src/paralelo'
import { planificarCuenta } from '../src/planificador'
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
  check(nombre, JSON.stringify(actual) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(actual)}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

const personas = planV3.personas as unknown as Persona[]
const proyectos = planV3.proyectos as unknown as Proyecto[]
const asignaciones = planV3.asignaciones as unknown as Asignacion[]
const config = planV3.config as unknown as Config
const feriados = feriadosDeConfig(config)
const HOY = '2026-06-01'

/** Ninguna persona con capacidad pasa su disponibilidad en ningún día (tolerancia de redondeo). */
function sinSobrecargaDiaria(asig: Asignacion[], cfg: Config, quienes: string[]): string | null {
  const ps = personas.filter(p => quienes.includes(p.id))
  for (const c of cargaDiaria(ps, asig, cfg)) if (c.horas > c.capacidad + 0.05) return `${c.personaId} el ${c.dia}: ${c.horas.toFixed(2)} h de ${c.capacidad.toFixed(2)}`
  return null
}

// ── corte de novedades extrapolado ────────────────────────────────────────────
titulo('fechaCorteDe — sin fecha ni día fijo, extrapola con la mediana')
const cfgCortes: Config = {
  ...config, cortes_novedades_dia: {},
  cortes_novedades_fechas: { tim: { '2027-01': '2027-01-18', '2027-02': '2027-02-18', '2027-03': '2027-03-18' } },
}
eq('mediana del día de los cortes de TIM', medianaDiaCorte('tim', cfgCortes), 18)
eq('julio 2027 sin dato: 16/07 (el 18 es domingo, se corre al viernes)', fechaCorteDe('tim', '2027-07', cfgCortes, feriados), '2027-07-16')
eq('y se informa como estimado', origenCorteDe('tim', '2027-07', cfgCortes, feriados)?.origen, 'estimado')
eq('una cuenta sin ningún corte sigue sin corte', fechaCorteDe('piano', '2027-07', cfgCortes, feriados), null)

// ── planificar una cuenta ─────────────────────────────────────────────────────
titulo('planificarCuentaNivelada — Carrier en abril 2027 (plan v3)')
const r = planificarCuentaNivelada('carrier', asignaciones, '2027-04', personas, config, proyectos, { hoyISO: HOY })
check('entra', r.ok, r.ok ? '' : r.motivo)
if (r.ok) {
  const nueva = asignaciones.map(a => r.asignaciones.find(x => x.id === a.id) ?? a)
  // El v3 ya trae sobrecargas de otras cuentas: se controla solo en los días en que Carrier trabaja.
  const diasCarrier = new Set(r.asignaciones.flatMap(a => cargaDiaria(personas.filter(p => p.id === a.persona_id), [a], config).filter(c => c.horas > 0).map(c => `${a.persona_id}|${c.dia}`)))
  const sobre = cargaDiaria(personas.filter(p => ['guille', 'moni', 'gaby_f'].includes(p.id)), nueva, config)
    .find(c => diasCarrier.has(`${c.personaId}|${c.dia}`) && c.horas > c.capacidad + 0.05)
  check('en los días de Carrier nadie pasa su capacidad', !sobre, sobre ? `${sobre.personaId} el ${sobre.dia}: ${sobre.horas.toFixed(2)} h de ${sobre.capacidad.toFixed(2)}` : '')
  const corte = fechaCorteDe('carrier', '2027-04', config, feriados)!
  check('todo termina antes del corte', r.asignaciones.every(a => a.fin < corte), `corte ${corte}`)
  const porId = new Map(r.asignaciones.map(a => [a.id, a]))
  const rotas = r.asignaciones.flatMap(a => a.predecesoras.filter(p => porId.has(p)).map(p => [a, porId.get(p)!] as const))
    .filter(([a, p]) => a.tipo === 'Pruebas' && p.tipo === 'Pruebas' ? a.inicio <= p.inicio : a.inicio <= p.fin)
  eq('respeta las predecesoras', rotas.map(([a]) => a.id), [])
  const horasAntes = asignaciones.filter(a => a.proyecto_id === 'carrier').reduce((s, a) => s + (a._horas ?? 0), 0)
  const horasDespues = r.asignaciones.reduce((s, a) => s + (a._horas ?? 0), 0)
  check('no suma ni resta horas', Math.abs(horasAntes - horasDespues) < 1, `${horasAntes} → ${horasDespues}`)
  eq('maxMesesDe: default 4', maxMesesDe(config), 4)
}

titulo('planificarCuentaNivelada — dice por qué no entra')
const vacTodo: Asignacion = { id: 'vac-guille-larga', proyecto_id: null, tipo: 'Vacaciones', persona_id: 'guille', inicio: '2026-06-01', fin: '2027-12-31', duracion_dias: 400, dedicacion_pct: 1, predecesoras: [], es_bloqueo: true }
const sinWilly = planificarCuentaNivelada('carrier', [...asignaciones, vacTodo], '2027-04', personas, config, proyectos, { hoyISO: HOY })
check('Willy de vacaciones todo el año: no entra', !sinWilly.ok)
check('y el motivo nombra a la persona', !sinWilly.ok && /Guille/.test(sinWilly.motivo), sinWilly.ok ? '' : sinWilly.motivo)
eq('una cuenta que ya arrancó no se mueve sola', cuentaArrancada('tim', asignaciones, '2026-10-01'), true)
const arrancada = planificarCuentaNivelada('tim', asignaciones, '2027-03', personas, config, proyectos, { hoyISO: '2026-10-01' })
check('…y lo dice', !arrancada.ok && /ya arrancó/.test(arrancada.motivo), arrancada.ok ? '' : arrancada.motivo)

// ── primera liquidación y analistas de payroll ───────────────────────────────
titulo('primera liquidación en vivo y analista de payroll')
const analista: Persona = { id: 'an_x', alias: 'Analista X', skills: [], rol: 'payroll', capacidad_horas_semana: 40, buffer_pct: 0 }
const liq: Asignacion[] = [
  { id: 'carrier-liq_vivo_guille', proyecto_id: 'carrier', tipo: 'Cierre', persona_id: 'guille', inicio: '2027-01-21', fin: '2027-02-05', duracion_dias: 12, dedicacion_pct: 0.286, predecesoras: [], es_bloqueo: false, _horas: 24, _fase: 'Liquidacion en vivo' },
  { id: 'carrier-payroll_liq', proyecto_id: 'carrier', tipo: 'Cierre', persona_id: 'an_x', inicio: '2027-01-21', fin: '2027-01-27', duracion_dias: 5, dedicacion_pct: 1, predecesoras: [], es_bloqueo: false, _horas: 35, _fase: 'Liquidacion en vivo' },
]
eq('esLiquidacionEnVivo', liq.map(esLiquidacionEnVivo), [true, true])
const conLiq = planificarCuentaNivelada('carrier', [...asignaciones, ...liq], '2027-04', [...personas, analista], config, proyectos, { hoyISO: HOY })
check('entra con la liquidación', conLiq.ok, conLiq.ok ? '' : conLiq.motivo)
if (conLiq.ok) {
  const corte = fechaCorteDe('carrier', '2027-04', config, feriados)!
  const lw = conLiq.asignaciones.find(a => a.id === 'carrier-liq_vivo_guille')!
  const lp = conLiq.asignaciones.find(a => a.id === 'carrier-payroll_liq')!
  eq('la de implementación arranca en el corte', lw.inicio, corte)
  eq('y termina el 5° hábil del mes siguiente', lw.fin, '2027-05-07')
  eq('la de payroll arranca en el corte y conserva sus 5 días', [lp.inicio, lp.duracion_dias], [corte, 5])
  const m = margenesPorCuenta(conLiq.asignaciones, { ...config, salidas_en_vivo_propuestas: { carrier: '2027-04' } }, proyectos).find(x => x.proyectoId === 'carrier')!
  check('el margen se mide sin la primera liquidación', (m.habiles ?? -1) >= 0, `margen ${m.habiles}`)
  const clasico = planificarCuenta('carrier', [...asignaciones, ...liq], '2027-04', config)
  check('el planificador clásico también la deja en el corte', clasico.ok && clasico.asignaciones.find(a => a.id === 'carrier-liq_vivo_guille')!.inicio === corte)
}

// ── la ventana de meses abierta ───────────────────────────────────────────────
titulo('planificarCuentaNivelada — una cuenta que ocupa toda la ventana entra (error de un día, 23/10/2026)')
{
  // Una persona sola, sin otra carga: Relevamiento → Configuración → Pruebas → Cierre de 5 + 5 + 5
  // + 1 días con un mes de ventana (21 hábiles). La duración nominal ocupa toda la ventana, así
  // que el planificador probaba un único arranque, que dejaba la cuenta abierta 22 días.
  const ana = { id: 'ana', alias: 'Ana', skills: [], capacidad_horas_semana: 40, buffer_pct: 0, horas_dia: 8 } as unknown as Persona
  const x = { id: 'x', nombre: 'Equis', complejidad: null, depende_retro: null, entidades: 1, quick_win: false, especial: false } as unknown as Proyecto
  const barra = (id: string, tipo: string, ini: string, fin: string, dur: number, preds: string[]) => ({
    id, proyecto_id: 'x', tipo, persona_id: 'ana', inicio: ini, fin, duracion_dias: dur, dedicacion_pct: 0.5,
    predecesoras: preds, es_bloqueo: false, _horas: dur * 4,
  }) as unknown as Asignacion
  const asigX = [
    barra('x-rel', 'Relevamiento', '2027-01-04', '2027-01-08', 5, []),
    barra('x-conf', 'Configuracion', '2027-01-11', '2027-01-15', 5, ['x-rel']),
    barra('x-prue', 'Pruebas', '2027-01-18', '2027-01-22', 5, ['x-conf']),
    barra('x-cierre', 'Cierre', '2027-01-25', '2027-01-25', 1, ['x-prue']),
  ]
  const cfgX = { ...config, salidas_en_vivo_propuestas: { x: '2027-03' }, cortes_novedades_fechas: { x: { '2027-03': '2027-03-18' } } } as Config
  const rx = planificarCuentaNivelada('x', asigX, '2027-03', [ana], cfgX, [x], { hoyISO: '2026-10-23', maxMeses: 1 })
  check('entra con un mes de ventana', rx.ok, rx.ok ? '' : rx.motivo)
  if (rx.ok) {
    const armadas = rx.asignaciones.map(a => a.inicio).concat(rx.asignaciones.map(a => a.fin)).sort()
    const habiles = (d: string, h: string) => { let n = 0; for (const c = new Date(`${d}T12:00:00`); c <= new Date(`${h}T12:00:00`); c.setDate(c.getDate() + 1)) { const iso = c.toISOString().slice(0, 10); if (c.getDay() % 6 && !feriados.has(iso)) n++ } return n }
    check('y queda abierta como mucho 21 días hábiles', habiles(armadas[0], armadas[armadas.length - 1]) <= 21, `${armadas[0]} → ${armadas[armadas.length - 1]}`)
  }
}

// ── replanificar todo ─────────────────────────────────────────────────────────
titulo('replanificarTodoNivelado — plan v3 con hoy = 01/06/2026')
const todo = replanificarTodoNivelado(asignaciones, personas, config, proyectos, { hoyISO: HOY })
console.log(`  (entran ${todo.reporte.replanificadas.length}, no entran ${todo.reporte.noEntran.length}: ${todo.reporte.noEntran.map(n => `${n.nombre} — ${n.motivo}`).join(' | ')})`)
check('rearma al menos la mitad de las cuentas', todo.reporte.replanificadas.length >= 6)
const sobre = sinSobrecargaDiaria(todo.asignaciones.filter(a => !a.proyecto_id || todo.reporte.replanificadas.includes(proyectos.find(p => p.id === a.proyecto_id)?.nombre ?? '')), config, ['guille', 'moni', 'gaby_f'])
check('las rearmadas no pasan a nadie del 100 % en ningún día', sobre === null, sobre ?? '')
const idsOk = new Set(proyectos.filter(p => todo.reporte.replanificadas.includes(p.nombre)).map(p => p.id))
const max = Math.max(...[...cuentasPorDia(todo.asignaciones.filter(a => a.proyecto_id && idsOk.has(a.proyecto_id)), feriados).values()].map(s => s.size))
check(`y no hay más de ${topeParalelo(config)} cuentas abiertas a la vez`, max <= topeParalelo(config), `máximo ${max}`)

console.log(`\n${fallos ? `${fallos} FALLAS` : 'TODO OK'} — ${corridos} chequeos`)
if (fallos) process.exit(1)
