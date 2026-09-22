/**
 * Modelo de horas (22/09/2026): jornada de 8 h, `horas_dia` propio de cada persona, horas de
 * la barra desde `_horas`, carga semanal en horas contra capacidad semanal con feriados, y
 * "Recalcular duraciones" con días = horas / (horas_dia × dedicación).
 *
 * El plan de prueba es SINTÉTICO: una cuenta estándar con las nueve barras de la tabla de
 * referencia del pedido (horas de la plantilla EMPRESA_MMAAAA v2), sobre las personas y el
 * config del plan v3. No es el v12 real, que no está en el repo: lo que se prueba acá es la
 * mecánica, no los números del plan vigente.
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
import {
  cargaDiaria, cargaMensual, cargaSemanal, curvaRestante, duracionPorHoras, horasDeBarra, horasDiaDe, horasPorDiaHabil,
} from '../src/capacidad'
import { feriadosDeConfig } from '../src/utils/dates'
import { validarPlan } from '../src/validacionPlan'
import { checkPredecesoras, computeViolaciones, margenesPorCuenta } from '../src/rules'
import { nombreTarea } from '../src/tareas'
import { useSimuladorStore } from '../src/store'
import planV3 from './fixtures/plan-v3.json'

let fallos = 0
let corridos = 0
function check(nombre: string, ok: boolean, detalle = '') {
  corridos++
  console.log(`  ${ok ? 'ok   ' : 'FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}
function eq(nombre: string, actual: unknown, esperado: unknown) {
  check(nombre, actual === esperado, `esperado ${String(esperado)}, obtenido ${String(actual)}`)
}
function cerca(nombre: string, actual: number, esperado: number, tol = 0.01) {
  check(nombre, Math.abs(actual - esperado) <= tol, `esperado ${esperado}, obtenido ${actual}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

// ── 1.6: la tabla de referencia del pedido ──────────────────────────────────────
titulo('duracionPorHoras — tabla de referencia (cuenta estándar)')
// barra, horas, dedicación, días con 7 h, días con 8 h, días con 8 h y Gaby en 4 h
const TABLA: Array<[string, number, number, number, number, number, boolean]> = [
  ['Repaso (Gaby)',                 14.4, 0.5, 4, 4, 7, true],
  ['Alta y carga base (Moni)',       6.0, 0.5, 2, 2, 2, false],
  ['Conceptos y fórmulas (Willy)',   8.0, 0.6, 2, 2, 2, false],
  ['Salidas (Moni)',                 8.0, 0.5, 2, 2, 2, false],
  ['Imputación contable (Willy)',   11.5, 0.6, 3, 2, 2, false],
  ['Pruebas ejecución (Gaby)',       8.5, 0.3, 4, 4, 7, true],
  ['Pruebas cruces (Willy)',        19.0, 0.3, 9, 8, 8, false],
  ['Act. final delta (Gaby)',        1.5, 0.5, 1, 1, 1, true],
  ['Act. final aplicación (Moni)',   1.5, 0.5, 1, 1, 1, false],
]
for (const [barra, h, ded, d7, d8, d8g, esGaby] of TABLA) {
  eq(`${barra} con 7 h`, duracionPorHoras(h, 7, ded), d7)
  eq(`${barra} con 8 h`, duracionPorHoras(h, 8, ded), d8)
  eq(`${barra} con 8 h y Gaby en 4 h`, duracionPorHoras(h, esGaby ? 4 : 8, ded), d8g)
}
eq('mínimo 1 día aunque las horas sean 0', duracionPorHoras(0, 8, 0.5), 1)
eq('dedicación 0 no divide por cero: 1 día', duracionPorHoras(10, 8, 0), 1)
eq('redondea al más cercano: 2,5 días → 3', duracionPorHoras(10, 8, 0.5), 3)
eq('redondea al más cercano: 2,4 días → 2', duracionPorHoras(9.6, 8, 0.5), 2)

// ── Plan sintético estilo v12 ───────────────────────────────────────────────────
const base = planV3 as unknown as { personas: Persona[]; proyectos: Proyecto[]; asignaciones: Asignacion[]; config: Config }
const configV12: Config = {
  ...base.config,
  horizonte: { desde: '2027-01-01', hasta: '2027-06-30' },
  capacidad: { ...base.config.capacidad!, horas_dia_default: 8, aviso_semanal_tolerancia: 1.10 },
  salidas_en_vivo_propuestas: { demo: '2027-03' },
  cortes_novedades_dia: { demo: 20 },
}
const personas: Persona[] = base.personas.filter(p => ['guille', 'moni', 'gaby_f'].includes(p.id))
const proyectos: Proyecto[] = [{ id: 'demo', nombre: 'Demo', complejidad: null, depende_retro: null, entidades: 1, quick_win: false, especial: false }]
const barra = (
  id: string, tipo: Asignacion['tipo'], persona: string, inicio: string, fin: string, dias: number, ded: number, horas: number, preds: string[] = [],
): Asignacion => ({
  id, proyecto_id: 'demo', tipo, persona_id: persona, inicio, fin, duracion_dias: dias, dedicacion_pct: ded,
  predecesoras: preds, es_bloqueo: false, _horas: horas,
})
// Duraciones armadas con la fórmula de 8 h (Gaby 4 h): es lo que "Recalcular" tiene que devolver.
const asignaciones: Asignacion[] = [
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
const plan = { personas, proyectos, asignaciones, config: configV12 }
const feriados = feriadosDeConfig(configV12)
const de = (id: string) => personas.find(p => p.id === id)

// ── 1.1 / 1.2 ──────────────────────────────────────────────────────────────────
titulo('horasDiaDe — jornada de 8 h y horas_dia propio')
eq('Willy: 8 h (default)', horasDiaDe(de('guille'), configV12), 8)
eq('Moni: 8 h', horasDiaDe(de('moni'), configV12), 8)
eq('Gaby: 4 h (horas_dia propio gana sobre el default)', horasDiaDe(de('gaby_f'), configV12), 4)

// ── 1.4: horas de la barra ──────────────────────────────────────────────────────
titulo('horasPorDiaHabil — _horas manda; sin _horas, jornada × dedicación')
eq('_horas se lee como número', horasDeBarra(asignaciones[6]), 19)
eq('sin _horas devuelve null', horasDeBarra({ ...asignaciones[6], _horas: undefined }), null)
cerca('cruces: 19 h en 8 días = 2,375 h por día', horasPorDiaHabil(asignaciones[6], de('guille'), configV12, feriados), 2.375, 0.001)
cerca('sin _horas, cruces = 8 h × 0,3 = 2,4 h por día', horasPorDiaHabil({ ...asignaciones[6], _horas: undefined }, de('guille'), configV12, feriados), 2.4, 0.001)
cerca('repaso de Gaby: 14,4 h en 7 días', horasPorDiaHabil(asignaciones[0], de('gaby_f'), configV12, feriados), 14.4 / 7, 0.001)
eq('un bloqueo no es carga', horasPorDiaHabil({ ...asignaciones[0], es_bloqueo: true }, de('gaby_f'), configV12, feriados), 0)

// ── 1.3: carga semanal en horas ─────────────────────────────────────────────────
titulo('cargaSemanal — horas de la semana contra horas_dia × disponibilidad × hábiles de la semana')
const semanal = cargaSemanal(personas, asignaciones, configV12)
const sem = (p: string, lunes: string) => semanal.find(c => c.personaId === p && c.semana === lunes)!
// Semana del 8/2/2027: lunes y martes son Carnaval → 3 hábiles.
cerca('Willy, semana del 8/2 (Carnaval): capacidad 3 × 8 × 0,6 = 14,4', sem('guille', '2027-02-08').capacidad, 14.4)
cerca('Willy, semana del 15/2: capacidad 5 × 8 × 0,6 = 24', sem('guille', '2027-02-15').capacidad, 24)
// Gaby (Willy, 22/09/2026): 4 h por día, todas para migración → 20 h por semana. La tabla
// `disponibilidad` (0,5) no le aplica porque tiene `horas_dia` propio.
cerca('Gaby, semana del 8/2 (Carnaval): 3 × 4 × 1,0 = 12', sem('gaby_f', '2027-02-08').capacidad, 12)
cerca('Gaby, semana del 15/2: 5 × 4 × 1,0 = 20', sem('gaby_f', '2027-02-15').capacidad, 20)
cerca('Gaby, semana del 8/2: 3 días de repaso = 3 × 14,4/7', sem('gaby_f', '2027-02-08').horas, 3 * 14.4 / 7)
cerca('Gaby, semana del 15/2: 4 días de repaso = 4 × 14,4/7', sem('gaby_f', '2027-02-15').horas, 4 * 14.4 / 7)
cerca('Willy, semana del 22/2: conceptos 8 h + imputación 11,5 h = 19,5', sem('guille', '2027-02-22').horas, 19.5)
cerca('Willy, semana del 8/3: 5 de los 8 días de cruces = 11,875', sem('guille', '2027-03-08').horas, 11.875)
check('porBarra dice qué barras causan la carga de la semana',
  Object.keys(sem('guille', '2027-02-22').porBarra).sort().join(',') === 'demo-conceptos,demo-imput',
  Object.keys(sem('guille', '2027-02-22').porBarra).join(','))
cerca('porBarra suma lo mismo que horas', Object.values(sem('guille', '2027-02-22').porBarra).reduce((s, h) => s + h, 0), sem('guille', '2027-02-22').horas)
check('la suma de todas las semanas de una barra da sus _horas', (() => {
  let suma = 0
  for (const c of semanal.filter(c => c.personaId === 'guille')) suma += c.porBarra['demo-pr-cruces'] ?? 0
  return Math.abs(suma - 19) < 0.02
})())

titulo('cargaDiaria — el mismo cálculo día por día que cargaSemanal, sin agrupar')
const diaria = cargaDiaria(personas, asignaciones, configV12)
const diasDe = (p: string, desde: string, hasta: string) => diaria.filter(c => c.personaId === p && c.dia >= desde && c.dia <= hasta)
const semana1502 = diasDe('guille', '2027-02-15', '2027-02-19')
eq('semana del 15/2, sin feriado: 5 días hábiles', semana1502.length, 5)
cerca('la suma de horas de esos 5 días es la misma que cargaSemanal', semana1502.reduce((s, c) => s + c.horas, 0), sem('guille', '2027-02-15').horas, 0.01)
cerca('la suma de capacidad de esos 5 días es la misma que cargaSemanal', semana1502.reduce((s, c) => s + c.capacidad, 0), sem('guille', '2027-02-15').capacidad, 0.01)
eq('Carnaval (8 y 9/2 feriados): 3 días hábiles, no 5', diasDe('guille', '2027-02-08', '2027-02-12').length, 3)
check('porBarra de un día suma lo mismo que sus horas', (() => {
  const d = semana1502.find(c => Object.keys(c.porBarra).length > 0)
  if (!d) return true
  return Math.abs(Object.values(d.porBarra).reduce((s, h) => s + h, 0) - d.horas) < 0.01
})())

titulo('cargaMensual — misma fuente de horas')
const mensual = cargaMensual(personas, asignaciones, configV12)
const mes = (p: string, m: string) => mensual.find(c => c.personaId === p && c.mes === m)!
cerca('Gaby, febrero: repaso 14,4 h', mes('gaby_f', '2027-02').horas, 14.4)
cerca('Gaby, marzo: ejecución 8,5 + delta 1,5 = 10 h', mes('gaby_f', '2027-03').horas, 10)
cerca('Willy, marzo: cruces 19 h', mes('guille', '2027-03').horas, 19)
cerca('Willy, febrero: 19,5 h', mes('guille', '2027-02').horas, 19.5)

// ── Criterio de aceptación: el JSON entra, sale y vuelve igual ─────────────────
titulo('Importar y exportar — _horas y predecesoras intactos')
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x)
const validado = validarPlan(JSON.stringify(plan))
check('el plan sintético valida', validado.ok, validado.errores.join(' | '))
check('la validación conserva _horas', validado.plan!.asignaciones.every(a => typeof a._horas === 'number'))
const store = useSimuladorStore.getState()
const r = store.importarJSON(JSON.stringify(plan))
check('el store lo importa', r.ok, r.errores.join(' | '))
const exportado = JSON.parse(useSimuladorStore.getState().exportarJSON())
eq('las asignaciones vuelven idénticas (claves, _horas, predecesoras)', canon(exportado.asignaciones), canon(plan.asignaciones))
eq('las personas vuelven idénticas', canon(exportado.personas), canon(plan.personas))
eq('los proyectos vuelven idénticos', canon(exportado.proyectos), canon(plan.proyectos))
eq('el config vuelve idéntico', canon(exportado.config), canon(plan.config))
check('un _horas que no es número frena el import con mensaje legible', (() => {
  const roto = JSON.parse(JSON.stringify(plan))
  roto.asignaciones[0]._horas = 'catorce'
  const v = validarPlan(JSON.stringify(roto))
  return !v.ok && v.errores.some(e => e.includes('asignaciones[0]._horas'))
})())

// ── 1.6: Recalcular duraciones sobre el plan sintético ──────────────────────────
titulo('Recalcular duraciones — devuelve las mismas duraciones y no pisa la dedicación')
useSimuladorStore.getState().importarJSON(JSON.stringify(plan))
const reporte = useSimuladorStore.getState().recalcularDuraciones()
const post = useSimuladorStore.getState().asignaciones
eq('recalculó las 9 barras', reporte.recalculadas, 9)
eq('ninguna cambió de duración', reporte.cambiadas.length, 0)
check('fin y duración idénticos a los del plan', post.every(a => {
  const o = asignaciones.find(x => x.id === a.id)!
  return a.fin === o.fin && a.duracion_dias === o.duracion_dias
}), post.map(a => `${a.id}:${a.duracion_dias}`).join(' '))
check('la dedicación queda tal cual', post.every(a => a.dedicacion_pct === asignaciones.find(x => x.id === a.id)!.dedicacion_pct))
check('_horas y predecesoras sobreviven al recálculo', post.every(a => {
  const o = asignaciones.find(x => x.id === a.id)!
  return a._horas === o._horas && a.predecesoras.join() === o.predecesoras.join()
}))

check('con jornada de 7 h las duraciones se estiran como dice la tabla (imputación 2 → 3, cruces 8 → 9)', (() => {
  const con7 = { ...plan, config: { ...configV12, capacidad: { ...configV12.capacidad!, horas_dia_default: 7 } } }
  useSimuladorStore.getState().importarJSON(JSON.stringify(con7))
  const rep = useSimuladorStore.getState().recalcularDuraciones()
  const d = (id: string) => useSimuladorStore.getState().asignaciones.find(a => a.id === id)!.duracion_dias
  return rep.cambiadas.length === 2 && d('demo-imput') === 3 && d('demo-pr-cruces') === 9
})())

check('una barra sin _horas de un tipo sin fila en horas_por_fase (Cierre) queda intacta', (() => {
  const sinHoras = JSON.parse(JSON.stringify(plan))
  delete sinHoras.asignaciones[7]._horas
  useSimuladorStore.getState().importarJSON(JSON.stringify(sinHoras))
  const rep = useSimuladorStore.getState().recalcularDuraciones()
  return rep.recalculadas === 8 && rep.intactas === 1 && useSimuladorStore.getState().asignaciones[7].duracion_dias === 1
})())

check('una barra sin _horas de un tipo con fila cae a horas_por_fase', (() => {
  const sinHoras = JSON.parse(JSON.stringify(plan))
  delete sinHoras.asignaciones[6]._horas   // cruces: Pruebas estándar = 88 h / (8 × 0,3) = 36,7 → 37 días
  useSimuladorStore.getState().importarJSON(JSON.stringify(sinHoras))
  useSimuladorStore.getState().recalcularDuraciones()
  return useSimuladorStore.getState().asignaciones[6].duracion_dias === 37
})())

// ── Predecesoras declaradas (v12) y margen desde el fin del cierre ─────────────
titulo('nombreTarea — la etiqueta dice qué, no quién')
eq('sufijo config_base → nombre de la tarea', nombreTarea({ ...asignaciones[1], id: 'demo-config_base' }), 'Alta y carga base')
eq('id sin sufijo conocido → tipo de fase', nombreTarea(asignaciones[6]), 'Pruebas')
eq('_tarea manda', nombreTarea({ ...asignaciones[6], _tarea: 'Pruebas · cruces' }), 'Pruebas · cruces')
eq('sufijo prueba_willy del v12', nombreTarea({ ...asignaciones[6], id: 'demo-prueba_willy' }), 'Pruebas · cruces')

titulo('checkPredecesoras — termina una, empieza la otra; Pruebas → Pruebas con 2 hábiles de desfasaje')
eq('el plan sintético respeta todas sus predecesoras', checkPredecesoras(asignaciones, proyectos, configV12).length, 0)
const mueve = (id: string, inicio: string) => asignaciones.map(a => a.id === id ? { ...a, inicio } : a)
check('cruces arrancando 1 hábil después de la ejecución es violación', (() => {
  const v = checkPredecesoras(mueve('demo-pr-cruces', '2027-03-02'), proyectos, configV12)
  return v.length === 1 && v[0].asignacion_id === 'demo-pr-cruces' && v[0].mensaje.includes('a 1 hábil del arranque') && v[0].mensaje.includes('2 después')
})(), JSON.stringify(checkPredecesoras(mueve('demo-pr-cruces', '2027-03-02'), proyectos, configV12).map(v => v.mensaje)))
eq('cruces arrancando el mismo día que la ejecución también', checkPredecesoras(mueve('demo-pr-cruces', '2027-03-01'), proyectos, configV12).length, 1)
check('conceptos arrancando el día en que termina alta y carga base es violación, con nombres de tarea', (() => {
  const v = checkPredecesoras(mueve('demo-conceptos', '2027-02-22').map(a => ({ ...a, id: a.id === 'demo-conceptos' ? 'demo-config_conceptos' : a.id === 'demo-alta' ? 'demo-config_base' : a.id, predecesoras: a.predecesoras.map(p => p === 'demo-alta' ? 'demo-config_base' : p) })), proyectos, configV12)
  return v.length === 1 && v[0].mensaje === 'Conceptos y fórmulas de Demo arranca el 22/02, antes de que termine alta y carga base (22/02)'
})())
eq('el desfasaje es una perilla: con 1 hábil, cruces al día siguiente pasa',
  checkPredecesoras(mueve('demo-pr-cruces', '2027-03-02'), proyectos, { ...configV12, reglas_calendario: { ...configV12.reglas_calendario, desfasaje_pruebas_habiles: 1 } }).length, 0)
eq('Configuración → Pruebas no se marca dos veces',
  computeViolaciones(mueve('demo-pr-ejec', '2027-02-26'), personas, configV12, proyectos).filter(v => v.tipo === 'dependencia' && v.asignacion_id === 'demo-pr-ejec').length, 1)

titulo('margen — desde el fin del cierre (Willy, 22/09/2026)')
const mg = margenesPorCuenta(asignaciones, configV12, proyectos)[0]
eq('se mide desde el Cierre', mg.fase, 'Cierre')
eq('fin de la última barra de cierre', mg.finBarra, '2027-03-16')
eq('corte de Demo en marzo: día 20 → sábado, corre al viernes 19', mg.corte, '2027-03-19')
eq('hábiles después del 16/03 hasta el 19/03: 17, 18, 19', mg.habiles, 3)
check('con mínimo 5 es rojo y el mensaje habla del cierre', (() => {
  const v = computeViolaciones(asignaciones, personas, configV12, proyectos).filter(v => v.tipo === 'margen')
  return v.length === 1 && v[0].mensaje.startsWith('El cierre de Demo termina el 16/03, a 3 días hábiles del corte')
})(), JSON.stringify(computeViolaciones(asignaciones, personas, configV12, proyectos).filter(v => v.tipo === 'margen').map(v => v.mensaje)))
check('sin barras de Cierre cae a Pruebas', (() => {
  const m = margenesPorCuenta(asignaciones.filter(a => a.tipo !== 'Cierre'), configV12, proyectos)[0]
  return m.fase === 'Pruebas' && m.finBarra === '2027-03-12' && m.habiles === 5
})())

titulo('curvaRestante — lo que falta contra la capacidad que queda (Insights, PDF)')
const curva = curvaRestante(personas, asignaciones, configV12, new Date('2027-01-01'))
const willyC = curva.find(c => c.personaId === 'guille')!
eq('el primer punto es el lunes de la semana en que arranca la primera fase (no hay datos antes)', willyC.puntos[0].semana, '2027-02-08')
check('las semanas están ordenadas ascendente', willyC.puntos.every((p, i) => i === 0 || p.semana > willyC.puntos[i - 1].semana))
cerca('la última semana con datos: horasQueFaltan = sus horas de esa semana', willyC.puntos[willyC.puntos.length - 1].horasQueFaltan, sem('guille', willyC.puntos[willyC.puntos.length - 1].semana)!.horas)
check('horasQueFaltan de la primera semana es la suma de todas las semanas desde ahí', (() => {
  const suma = semanal.filter(c => c.personaId === 'guille' && c.semana >= '2027-01-04').reduce((s, c) => s + c.horas, 0)
  return Math.abs(willyC.puntos[0].horasQueFaltan - suma) < 0.02
})())
check('capacidadQueQueda baja semana a semana (es una cuenta regresiva)', willyC.puntos.every((p, i) => i === 0 || p.capacidadQueQueda <= willyC.puntos[i - 1].capacidadQueQueda + 0.01))
eq('una persona sin fases desde esa fecha no aparece', curvaRestante(personas, asignaciones, configV12, new Date('2028-01-01')).length, 0)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
