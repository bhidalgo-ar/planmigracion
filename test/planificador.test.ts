/**
 * Tests del planificador hacia atrás (src/planificador.ts): dado el mes de salida de una
 * cuenta, rearma sus fases desde el corte de novedades con las reglas del script
 * armar_calendario_migracion.py. Corre sobre el fixture v3 (7 barras por cuenta, sin
 * Cierre) y sobre una cuenta sintética con la forma v5 (8 barras, con Cierre).
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import {
  aplicarPlan, configConSalida, describirMovimiento, esHabilISO, habilAnterior, habilesDesde,
  lunesHabilAnteriorOIgual, mesesCandidatos, pisaBlackout, planificarCuenta, simularDestinos, ultimosHabiles,
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
check('ningún destino es gris (todas las cuentas tienen corte y entran en el horizonte)', destinos.every(d => d.estado !== 'gris'),
  destinos.filter(d => d.estado === 'gris').map(d => `${d.mes}: ${d.motivo}`).join(' | '))
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
  check('las cargas listan solo personas de TIM en meses donde cambió algo', rep.cargas.length > 0 && rep.cargas.every(c => ['Guille', 'Moni', 'Gaby F.'].includes(c.alias)),
    rep.cargas.map(c => `${c.alias} ${c.mes} ${c.antes}→${c.despues}`).join(' | '))
  check('ningún texto muestra un id', [...rep.nuevas, ...rep.resueltas].every(m => !/tim-/.test(m)))
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
