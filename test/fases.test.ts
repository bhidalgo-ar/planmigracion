/**
 * Tests de "una barra por fase y por persona" (23/10/2026): juntar las tareas de cada fase,
 * editar y mover una fase entera, repartir sus horas y que el planificador nivelado respete
 * una fase fijada a mano (📌). Sobre un plan sintético estilo v12 y el fixture v3.
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import {
  barrasDeFase, editarFase, faseDeCuenta, horasPorPersona, juntarPorFase, moverFase,
  repartoAMano, repartoParejo, repartoPlantilla,
} from '../src/fases'
import { cargaMensual, duracionPorHoras, horasDiaDe } from '../src/capacidad'
import { computeViolaciones } from '../src/rules'
import { planificarCuentaNivelada } from '../src/planificadorNivelado'
import { diasHabiles, feriadosDeConfig } from '../src/utils/dates'
import planV3 from './fixtures/plan-v3.json'

let fallos = 0
let corridos = 0
function check(nombre: string, ok: boolean, detalle = '') {
  corridos++
  console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}
function eq(nombre: string, actual: unknown, esperado: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(esperado)
  check(nombre, a === e, `esperado ${e}, obtenido ${a}`)
}
function cerca(nombre: string, actual: number, esperado: number, tol = 0.02) {
  check(nombre, Math.abs(actual - esperado) <= tol, `esperado ${esperado}, obtenido ${actual}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

// ── Plan sintético estilo v12 (el mismo de test/horas.test.ts) ───────────────────
const base = planV3 as unknown as { personas: Persona[]; proyectos: Proyecto[]; asignaciones: Asignacion[]; config: Config }
const config: Config = {
  ...base.config,
  horizonte: { desde: '2027-01-01', hasta: '2027-06-30' },
  capacidad: { ...base.config.capacidad!, horas_dia_default: 8, aviso_semanal_tolerancia: 1.10 },
  salidas_en_vivo_propuestas: { demo: '2027-03' },
  cortes_novedades_dia: { demo: 20 },
}
const personas: Persona[] = base.personas.filter(p => ['guille', 'moni', 'gaby_f'].includes(p.id))
const proyectos: Proyecto[] = [{ id: 'demo', nombre: 'Demo', complejidad: null, depende_retro: null, entidades: 1, quick_win: false, especial: false }]
const feriados = feriadosDeConfig(config)
const barra = (
  id: string, tipo: Asignacion['tipo'], persona: string, inicio: string, fin: string, dias: number, ded: number, horas: number, preds: string[] = [],
): Asignacion => ({
  id, proyecto_id: 'demo', tipo, persona_id: persona, inicio, fin, duracion_dias: dias, dedicacion_pct: ded,
  predecesoras: preds, es_bloqueo: false, _horas: horas,
})
const tareas: Asignacion[] = [
  barra('demo-repaso',   'Relevamiento',  'gaby_f', '2027-02-10', '2027-02-18', 7, 0.5, 14.4),
  barra('demo-alta',     'Configuracion', 'moni',   '2027-02-19', '2027-02-22', 2, 0.5, 6.0, ['demo-repaso']),
  barra('demo-conceptos','Configuracion', 'guille', '2027-02-23', '2027-02-24', 2, 0.6, 8.0, ['demo-alta']),
  barra('demo-salidas',  'Configuracion', 'moni',   '2027-02-23', '2027-02-24', 2, 0.5, 8.0, ['demo-alta']),
  barra('demo-imput',    'Configuracion', 'guille', '2027-02-25', '2027-02-26', 2, 0.6, 11.5, ['demo-conceptos']),
  barra('demo-pr-ejec',  'Pruebas',       'gaby_f', '2027-03-01', '2027-03-09', 7, 0.3, 8.5, ['demo-imput', 'demo-salidas']),
  barra('demo-pr-cruces','Pruebas',       'guille', '2027-03-03', '2027-03-12', 8, 0.3, 19.0, ['demo-pr-ejec']),
  barra('demo-af-delta', 'Cierre',        'gaby_f', '2027-03-15', '2027-03-15', 1, 0.5, 1.5, ['demo-pr-cruces']),
  barra('demo-af-aplic', 'Cierre',        'moni',   '2027-03-16', '2027-03-16', 1, 0.5, 1.5, ['demo-af-delta']),
]
const porId = (xs: Asignacion[], id: string) => xs.find(a => a.id === id)!
const horasDe = (xs: Asignacion[], pid: string) => Math.round(cargaMensual(personas, xs, config)
  .filter(c => c.personaId === pid).reduce((s, c) => s + c.horas, 0) * 100) / 100

titulo('juntarPorFase — una barra por fase y por persona, con la suma de sus horas')
const juntas = juntarPorFase(tareas, personas, config)
eq('de 9 barras quedan 7 (configuración de 4 a 2)', juntas.length, 7)
const cfgMoni = porId(juntas, 'demo-configuracion-moni')
const cfgGuille = porId(juntas, 'demo-configuracion-guille')
check('Moni tiene una sola barra de configuración', !!cfgMoni && barrasDeFase(juntas, 'demo', 'Configuracion').filter(a => a.persona_id === 'moni').length === 1)
eq('con 6 + 8 = 14 h', cfgMoni._horas, 14)
eq('y Guille 8 + 11,5 = 19,5 h', cfgGuille._horas, 19.5)
eq('las dos con las fechas de toda la fase', [cfgMoni.inicio, cfgMoni.fin, cfgGuille.inicio, cfgGuille.fin], ['2027-02-19', '2027-02-26', '2027-02-19', '2027-02-26'])
eq('duración = hábiles de la fase', cfgMoni.duracion_dias, diasHabiles('2027-02-19', '2027-02-26', feriados))
eq('la fase se ve como una sola cosa: del 19/02 al 26/02', [faseDeCuenta(juntas, 'demo', 'Configuracion')!.inicio, faseDeCuenta(juntas, 'demo', 'Configuracion')!.fin], ['2027-02-19', '2027-02-26'])
eq('la plantilla guarda las mismas horas', [cfgMoni._horas_plantilla, cfgGuille._horas_plantilla], [14, 19.5])
eq('Recalcular duraciones devuelve los mismos días',
  duracionPorHoras(cfgGuille._horas!, horasDiaDe(personas.find(p => p.id === 'guille'), config), cfgGuille.dedicacion_pct), cfgGuille.duracion_dias)
check('el nombre de tarea de una barra juntada se va', cfgMoni._tarea === undefined)
const ejec = porId(juntas, 'demo-pr-ejec'), cruces = porId(juntas, 'demo-pr-cruces')
check('quien tenía una sola barra en la fase conserva su id', !!ejec && !!cruces && !!porId(juntas, 'demo-repaso'))
eq('las pruebas pasan a ir juntas: 01/03 → 12/03 (los cruces ya no esperan a la ejecución)', [ejec.inicio, ejec.fin, cruces.inicio, cruces.fin], ['2027-03-01', '2027-03-12', '2027-03-01', '2027-03-12'])
eq('cada barra de pruebas espera a toda la configuración', [ejec.predecesoras, cruces.predecesoras],
  [['demo-configuracion-guille', 'demo-configuracion-moni'], ['demo-configuracion-guille', 'demo-configuracion-moni']])
eq('la configuración espera al relevamiento', cfgMoni.predecesoras, ['demo-repaso'])
eq('el cierre queda como estaba', porId(juntas, 'demo-af-delta').predecesoras, ['demo-pr-cruces'])
for (const pid of ['gaby_f', 'moni', 'guille']) eq(`${pid}: las horas del programa no cambian`, horasDe(juntas, pid), horasDe(tareas, pid))
eq('aplicado dos veces da lo mismo', JSON.stringify(juntarPorFase(juntas, personas, config)), JSON.stringify(juntas))
{
  // El planificador puede dejar que una persona termine antes que la otra: una fase ya juntada no se vuelve a emparejar.
  const desparejas = juntas.map(a => a.id === 'demo-configuracion-moni' ? { ...a, fin: '2027-02-23', duracion_dias: 3 } : a)
  eq('una fase ya juntada no se toca aunque las fechas de cada uno difieran', JSON.stringify(juntarPorFase(desparejas, personas, config)), JSON.stringify(desparejas))
}
eq('juntar no agrega rojos: quedan los mismos tipos que con las tareas',
  computeViolaciones(juntas, personas, config, proyectos).filter(v => v.severidad === 'rojo').map(v => v.tipo),
  computeViolaciones(tareas, personas, config, proyectos).filter(v => v.severidad === 'rojo').map(v => v.tipo))

titulo('juntarPorFase sobre el v3 — se conservan las horas de cada persona')
{
  const p3 = base.personas, c3 = base.config
  const j3 = juntarPorFase(base.asignaciones, p3, c3)
  check('quedan menos barras', j3.length < base.asignaciones.length, `${base.asignaciones.length} → ${j3.length}`)
  const tot = (xs: Asignacion[], pid: string) => Math.round(cargaMensual(p3, xs, c3).filter(c => c.personaId === pid).reduce((s, c) => s + c.horas, 0) * 10) / 10
  for (const pid of ['gaby_f', 'moni', 'guille']) cerca(`${pid}: mismas horas en todo el programa`, tot(j3, pid), tot(base.asignaciones, pid), 0.3)
  const ids = new Set(j3.map(a => a.id))
  check('ninguna predecesora apunta a una barra que ya no existe', j3.every(a => a.predecesoras.every(p => ids.has(p))))
  const rel = barrasDeFase(j3, 'tim', 'Relevamiento')
  eq('TIM: la corrida y el repaso de Gaby, pegados, quedan en un relevamiento', rel.map(a => [a.id, a.inicio, a.fin]), [['tim-relevamiento-gaby_f', '2026-09-14', '2026-09-22']])
  const aysa = barrasDeFase(j3, 'aysa', 'Relevamiento')
  eq('Aysa: la corrida de septiembre y el repaso de enero son dos tramos y no se juntan', aysa.length, 2)
  const cuenta = (xs: Asignacion[]) => JSON.stringify(computeViolaciones(xs, p3, c3, base.proyectos).map(v => `${v.tipo}/${v.severidad}`).sort())
  eq('las reglas del v3 dan lo mismo juntado que en tareas', cuenta(j3), cuenta(base.asignaciones.map(a => a.es_bloqueo && a.predecesoras.length ? { ...a, predecesoras: [] } : a)))
  eq('y juntarlo de nuevo no cambia nada', JSON.stringify(juntarPorFase(j3, p3, c3)), JSON.stringify(j3))
}

titulo('editarFase — achicar las pruebas a una semana')
const corta = editarFase(juntas, 'demo', 'Pruebas', { inicio: '2027-03-01', fin: '2027-03-05', fijada: true }, personas, config)
const fp = faseDeCuenta(corta, 'demo', 'Pruebas')!
eq('las dos barras quedan del 01/03 al 05/03', fp.barras.map(b => [b.inicio, b.fin, b.duracion_dias]), [['2027-03-01', '2027-03-05', 5], ['2027-03-01', '2027-03-05', 5]])
eq('las horas no cambian', fp.barras.map(b => b._horas), [8.5, 19])
check('queda fijada (📌)', fp.fijada && fp.barras.every(b => b.fijada === true))
eq('Recalcular duraciones no la deshace', duracionPorHoras(19, horasDiaDe(personas.find(p => p.id === 'guille'), config), fp.barras[1].dedicacion_pct), 5)
eq('las demás fases no se tocan', JSON.stringify(corta.filter(a => a.tipo !== 'Pruebas')), JSON.stringify(juntas.filter(a => a.tipo !== 'Pruebas')))
const desfijada = editarFase(corta, 'demo', 'Pruebas', { fijada: false }, personas, config)
check('se puede sacar el 📌', faseDeCuenta(desfijada, 'demo', 'Pruebas')!.barras.every(b => b.fijada === undefined))
const caeSabado = editarFase(juntas, 'demo', 'Pruebas', { inicio: '2027-03-06', fin: '2027-03-10' }, personas, config)
eq('si arranca un sábado, pasa al lunes', faseDeCuenta(caeSabado, 'demo', 'Pruebas')!.inicio, '2027-03-08')

titulo('moverFase — mueve solo esa fase, con su duración')
const movida = moverFase(juntas, 'demo', 'Configuracion', 7, config)
const fm = faseDeCuenta(movida, 'demo', 'Configuracion')!
eq('una semana más tarde', [fm.inicio, fm.fin], ['2027-02-26', '2027-03-05'])
eq('las dos personas corren lo mismo', fm.barras.map(b => [b.persona_id, b.inicio, b.fin]), [['moni', '2027-02-26', '2027-03-05'], ['guille', '2027-02-26', '2027-03-05']])
eq('misma duración', fm.barras.map(b => b.duracion_dias), [6, 6])
eq('relevamiento y pruebas quedan donde estaban', JSON.stringify(movida.filter(a => a.tipo !== 'Configuracion')), JSON.stringify(juntas.filter(a => a.tipo !== 'Configuracion')))
check('y como las pruebas ahora arrancan antes de que termine, es rojo de dependencia',
  computeViolaciones(movida, personas, config, proyectos).some(v => v.tipo === 'dependencia'))

titulo('Reparto de horas — el total de la fase nunca cambia')
{
  const f = faseDeCuenta(juntas, 'demo', 'Configuracion')!
  const actual = horasPorPersona(f, personas, config)
  eq('hoy: Moni 14 · Guille 19,5', actual, { moni: 14, guille: 19.5 })
  eq('mitad y mitad: 16,75 cada uno', repartoParejo(actual), { moni: 16.75, guille: 16.75 })
  eq('a mano: Moni 20 → Guille 13,5', repartoAMano(actual, 'moni', 20), { moni: 20, guille: 13.5 })
  eq('a mano no pasa del total', repartoAMano(actual, 'moni', 50), { moni: 33.5, guille: 0 })
  const editada = editarFase(juntas, 'demo', 'Configuracion', { horas: repartoParejo(actual) }, personas, config)
  const f2 = faseDeCuenta(editada, 'demo', 'Configuracion')!
  eq('después de mitad y mitad, "Como la plantilla" vuelve a 14 / 19,5', repartoPlantilla(f2, horasPorPersona(f2, personas, config)), { moni: 14, guille: 19.5 })
  eq('la plantilla no se pisa al repartir', f2.barras.map(b => b._horas_plantilla), [14, 19.5])
}

titulo('Planificador nivelado — una fase fijada conserva su duración')
{
  const hoyISO = '2027-01-04'
  const libre = planificarCuentaNivelada('demo', juntas, '2027-03', personas, config, proyectos, { hoyISO })
  check('sin 📌, la cuenta entra en marzo', libre.ok, libre.ok ? '' : libre.motivo)
  const fija = editarFase(juntas, 'demo', 'Pruebas', { inicio: '2027-03-01', fin: '2027-03-05', fijada: true }, personas, config)
  const r = planificarCuentaNivelada('demo', fija, '2027-03', personas, config, proyectos, { hoyISO })
  check('con las pruebas fijadas en 5 días, también entra', r.ok, r.ok ? '' : r.motivo)
  if (r.ok) {
    const pr = barrasDeFase(r.asignaciones, 'demo', 'Pruebas')
    eq('y las pruebas siguen durando 5 hábiles', pr.map(b => b.duracion_dias), [5, 5])
    eq('con las mismas horas', pr.map(b => b._horas), [8.5, 19])
  }
  // 19 h de Guille en 3 días son 6,3 h por día: más de lo que tiene (8 h × su disponibilidad).
  const apretada = editarFase(juntas, 'demo', 'Pruebas', { inicio: '2027-03-01', fin: '2027-03-03', fijada: true }, personas, config)
  const r3 = planificarCuentaNivelada('demo', apretada, '2027-03', personas, config, proyectos, { hoyISO })
  check('fijadas en 3 días no entran, y el motivo lo dice', !r3.ok && /Guille no tiene lugar para pruebas/.test(r3.motivo), r3.ok ? 'entró' : r3.motivo)
}

titulo('Planificador nivelado — las vacaciones adentro de una fase son hueco')
{
  const hoyISO = '2027-01-04'
  const vac: Asignacion = { id: 'vac-guille', proyecto_id: null, tipo: 'Vacaciones', persona_id: 'guille', inicio: '2027-02-15', fin: '2027-02-19',
    duracion_dias: 5, dedicacion_pct: 1, predecesoras: [], es_bloqueo: true, _nombre: 'Vacaciones' }
  const conVac = [...juntas, vac]
  const r = planificarCuentaNivelada('demo', conVac, '2027-03', personas, config, proyectos, { hoyISO })
  check('la cuenta entra en marzo con Guille de vacaciones en febrero', r.ok, r.ok ? '' : r.motivo)
  if (r.ok) {
    const todo = conVac.map(a => r.asignaciones.find(x => x.id === a.id) ?? a)
    eq('sin rojos de vacaciones', computeViolaciones(todo, personas, config, proyectos).filter(v => v.tipo === 'vacaciones').length, 0)
    cerca('Guille conserva sus horas', horasDe(todo, 'guille'), horasDe(juntas, 'guille'), 0.3)
  }
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
