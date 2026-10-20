/**
 * Tests de la liquidación en vivo (plan v18, 20/10/2026): el tipo nuevo, la forma vieja que
 * trae el v18 (`tipo: 'Cierre'` + `_fase`), la cuenta fuera del plan (POF) y lo que NO tiene
 * que cambiar: margen al corte, fin del programa, mes de salida.
 *
 * El v18 no se versiona (es el JSON de Willy): se arma un plan chico sobre el v3 con la misma
 * forma.
 */

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(), key: () => null, length: 0,
}

import { normalizarAsignacion, validarPlan } from '../src/validacionPlan'
import { cargaSemanal, esCarga, horasPorDiaHabil, mesSalidaDe } from '../src/capacidad'
import { computeViolaciones, fechaCorteDe } from '../src/rules'
import { resumenPlan } from '../src/insights'
import { cuentasMigracion } from '../src/insightsMigracion'
import { planificarCuenta, quintoHabilDelMesSiguiente } from '../src/planificador'
import {
  hitoDeCierre, horasDiaLegible, horasPorTipo, liquidacionesEnVivo, tramosDeColumna,
  BANDA_AREA, BANDA_Y100, FILA_CUENTA_MAX, BANDA_ROW,
} from '../src/vistaTimeline'
import { feriadosDeConfig } from '../src/utils/dates'
import type { Asignacion, Config, TipoFase } from '../src/types'
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

const base = JSON.parse(JSON.stringify(planV3)) as { personas: unknown[]; proyectos: unknown[]; asignaciones: Asignacion[]; config: Config }
const config = base.config
const feriados = feriadosDeConfig(config)

// TIM sale en octubre de 2026 en el v3: la liquidación en vivo va del corte al 5° hábil de noviembre.
const corteTim = fechaCorteDe('tim', '2026-10', config, feriados)!
const finVivo = quintoHabilDelMesSiguiente('2026-10', feriados)
const vivo = (persona: string, horas: number): Asignacion & { _fase: string } => ({
  id: `tim-liq_vivo_${persona}`, proyecto_id: 'tim', tipo: 'Cierre', _fase: 'Liquidacion en vivo',
  persona_id: persona, inicio: corteTim, fin: finVivo, duracion_dias: 10, dedicacion_pct: 0.25,
  predecesoras: [], es_bloqueo: false, _horas: horas,
})
const pof = (persona: string): Asignacion => ({
  id: `pof-liq_vivo_${persona}`, proyecto_id: null, tipo: 'Cierre', _fase: 'Liquidacion en vivo', cuenta_fuera_plan: 'POF',
  persona_id: persona, inicio: '2026-10-14', fin: '2026-11-06', duracion_dias: 18, dedicacion_pct: 0.25,
  predecesoras: [], es_bloqueo: true, _horas: 36,
})
const conVivo = {
  ...base,
  asignaciones: [...base.asignaciones, vivo('guille', 20), vivo('moni', 20), vivo('gaby_f', 10), pof('guille')],
}

titulo('Esquema — la forma del v18 entra y se normaliza')
const r = validarPlan(JSON.stringify(conVivo))
eq('importa sin errores', r.errores.join(' | '), '')
const importadas = r.plan!.asignaciones
eq('Cierre + _fase pasa al tipo propio', importadas.find(a => a.id === 'tim-liq_vivo_guille')?.tipo, 'Liquidacion en vivo')
eq('cuenta_fuera_plan se conserva', importadas.find(a => a.id === 'pof-liq_vivo_guille')?.cuenta_fuera_plan, 'POF')
eq('un Cierre de verdad sigue siendo Cierre', normalizarAsignacion({ tipo: 'Cierre' }).tipo, 'Cierre')
const directo = JSON.parse(JSON.stringify(conVivo))
directo.asignaciones.at(-2).tipo = 'Liquidacion en vivo'
delete directo.asignaciones.at(-2)._fase
check('el tipo nuevo también entra escrito directo', validarPlan(JSON.stringify(directo)).ok)

titulo('Lo que no se rompe')
const v = (as: Asignacion[]) => computeViolaciones(as, r.plan!.personas, r.plan!.config, r.plan!.proyectos)
const sinVivo = v(base.asignaciones as Asignacion[])
const conV = v(importadas)
const cuenta = (vs: ReturnType<typeof v>, tipo: string) => vs.filter(x => x.tipo === tipo && x.severidad === 'rojo').length
for (const t of ['margen', 'blackout', 'dependencia', 'tope_salidas']) {
  eq(`mismas violaciones de ${t}`, cuenta(conV, t), cuenta(sinVivo, t))
}
eq('el fin del programa no se estira', resumenPlan(r.plan!.proyectos, importadas, r.plan!.personas as never, conV).finPlan,
  resumenPlan(r.plan!.proyectos, base.asignaciones as Asignacion[], r.plan!.personas as never, sinVivo).finPlan)
eq('el mes de salida sigue siendo dato', mesSalidaDe('tim', r.plan!.config), '2026-10')
const timSinConfig = cuentasMigracion(r.plan!.proyectos, importadas).find(c => c.id === 'tim')!
check('sin mes de salida, el fin de la cuenta no cuenta la liquidación en vivo', !!timSinConfig.enVivo && timSinConfig.enVivo < corteTim,
  `fin ${timSinConfig.enVivo}, corte ${corteTim}`)

titulo('Carga — POF es bloqueo pero son horas reales')
const pofImp = importadas.find(a => a.id === 'pof-liq_vivo_guille')!
check('esCarga: la liquidación en vivo de POF suma', esCarga(pofImp))
check('esCarga: unas vacaciones no', !esCarga({ ...pofImp, tipo: 'Vacaciones' }))
const guille = (r.plan!.personas as { id: string }[]).find(p => p.id === 'guille') as never
const semanas = cargaSemanal([guille], importadas, r.plan!.config)
const conPof = semanas.find(s => s.porBarra['pof-liq_vivo_guille'] > 0)
check('la semana de POF trae sus horas en porBarra', !!conPof)
eq('POF: 36 h en 18 hábiles = 2 h/día', horasDiaLegible(horasPorDiaHabil(pofImp, guille, r.plan!.config, feriados)), '2')

titulo('Timeline por cuenta — una barra, un rombo')
const grupos = liquidacionesEnVivo(importadas)
eq('TIM: una sola liquidación con las tres personas', grupos.get('tim')?.asigs.length, 3)
eq('arranca en el corte', grupos.get('tim')?.inicio, corteTim)
eq('POF agrupa en su propia fila', grupos.get('fuera:POF')?.inicio, '2026-10-14')
const delta: Asignacion = { ...vivo('gaby_f', 1), id: 'x-delta', tipo: 'Cierre', inicio: '2026-10-15', fin: '2026-10-15' }
const aplica: Asignacion = { ...vivo('moni', 1), id: 'x-aplica', tipo: 'Cierre', inicio: '2026-10-16', fin: '2026-10-16' }
eq('delta + aplica: un rombo en la fecha del aplica', hitoDeCierre([delta, aplica])?.fecha, '2026-10-16')
eq('sin Cierre, sin rombo', hitoDeCierre([]), null)
check('la fila de cuenta entra en 52 px', FILA_CUENTA_MAX === 52)
check('la fila de carga no pasa de 76 px', BANDA_ROW <= 76)

titulo('Columna de carga apilada')
const tipoDe = new Map<string, TipoFase>([['a', 'Configuracion'], ['b', 'Liquidacion en vivo'], ['c', 'Relevamiento']])
eq('por tipo, en orden de abajo hacia arriba', horasPorTipo({ b: 4, a: 10, c: 2 }, tipoDe).map(([t, h]) => `${t}:${h}`).join(','),
  'Relevamiento:2,Configuracion:10,Liquidacion en vivo:4')
const tramos = tramosDeColumna([['Configuracion', 20]], 40, 40)
eq('al 50 % la columna mide la mitad de la línea del 100 %', tramos[0].alto, BANDA_Y100 / 2)
const pasada = tramosDeColumna([['Configuracion', 400]], 40, 40)
eq('una columna pasadísima se recorta al área', pasada[0].alto, BANDA_AREA)
eq('sin capacidad (vacaciones) se mide contra la capacidad típica', tramosDeColumna([['Pruebas', 40]], 0, 40)[0].alto, BANDA_Y100)

titulo('Planificador — mover la cuenta mueve la liquidación en vivo')
const plan = planificarCuenta('tim', importadas, '2026-11', r.plan!.config)
if (plan.ok) {
  const g = plan.asignaciones.find(a => a.id === 'tim-liq_vivo_guille')!
  eq('arranca en el corte del mes nuevo', g.inicio, plan.corte)
  eq('termina el 5° hábil del mes siguiente', g.fin, quintoHabilDelMesSiguiente('2026-11', feriados))
  check('las horas no cambian', g._horas === 20)
} else {
  check(`el planificador encontró lugar (${plan.motivo})`, false)
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
