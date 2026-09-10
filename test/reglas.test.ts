/**
 * Tests del modelo de capacidad (src/capacidad.ts), del motor de reglas (src/rules.ts) y
 * del mes de salida como dato (src/insightsMigracion.ts). Corren sobre el plan v3
 * corregido (test/fixtures/plan-v3.json), que es el calendario aprobado el 10/09/2026.
 *
 * Los números de referencia salen del brief 10/09/2026 §2: con 8 h el mockup daba
 * Willy 425 h, Moni 276, Gaby 371; con 7 h bajan × 0,875 y Gaby cambia más por sus 4 h.
 */

import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import {
  cargaMensual, cargaSemanal, cuentasEnAxton, diasHabilesDelMes, disponibilidadMes, horasDiaDe,
  horasFaseEnMes, mesSalidaDe, mesesEntre,
} from '../src/capacidad'
import {
  checkCargaMensual, checkCargaSemanal, checkDependenciaConfigPruebas, checkMargenYBlackout,
  checkTopeSalidas, computeViolaciones, fechaCorteDe, habilesHasta, margenesPorCuenta, nombreMes,
} from '../src/rules'
import { cuentasFueraDelPlan, cuentasMigracion, migracionPorTrimestre, resumenMigracion } from '../src/insightsMigracion'
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
function cerca(nombre: string, actual: number, esperado: number, tolerancia: number) {
  check(nombre, Math.abs(actual - esperado) <= tolerancia, `esperado ${esperado} ± ${tolerancia}, obtenido ${actual.toFixed(1)}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

const personas = planV3.personas as unknown as Persona[]
const proyectos = planV3.proyectos as unknown as Proyecto[]
const asignaciones = planV3.asignaciones as unknown as Asignacion[]
const config = planV3.config as unknown as Config
const feriados = feriadosDeConfig(config)
const de = (id: string) => personas.find(p => p.id === id)!

// ── horas por día ─────────────────────────────────────────────────────────────
titulo('horasDiaDe — jornada disponible real')
eq('Willy: 7 h (default del config)', horasDiaDe(de('guille'), config), 7)
eq('Moni: 7 h', horasDiaDe(de('moni'), config), 7)
eq('Gaby: 4 h (jornada fija)', horasDiaDe(de('gaby_f'), config), 4)
eq('sin config.capacidad cae al default 7', horasDiaDe(de('moni'), { ...config, capacidad: undefined }), 7)

// ── cuentas en Axton y disponibilidad de Moni ─────────────────────────────────
titulo('cuentasEnAxton — 9 legacy + Coty + salidas hasta el mes inclusive')
eq('agosto 2026: solo legacy + Coty', cuentasEnAxton('2026-08', config), 10)
eq('septiembre 2026: entra POF (fuera del plan)', cuentasEnAxton('2026-09', config), 11)
eq('octubre 2026: TIM + Finadiet', cuentasEnAxton('2026-10', config), 13)
eq('abril 2027: las 13 del plan + POF + Finadiet + 10', cuentasEnAxton('2027-04', config), 25)

titulo('disponibilidadMes — Moni baja 0,02 por cuenta en Axton, piso 0,50')
eq('Moni sep-26 (11 cuentas)', disponibilidadMes('moni', '2026-09', config).toFixed(2), '0.78')
eq('Moni ene-27 (19 cuentas)', disponibilidadMes('moni', '2027-01', config).toFixed(2), '0.62')
eq('Moni abr-27 toca el piso', disponibilidadMes('moni', '2027-04', config), 0.5)
eq('Moni nunca supera la base aunque haya menos cuentas', disponibilidadMes('moni', '2020-01', config), 0.8)
eq('Willy: 0,6 constante (perilla por año)', disponibilidadMes('guille', '2027-01', config), 0.6)
eq('Gaby: 1,0 sobre sus 4 h (la reducción ya está en horas_dia)', disponibilidadMes('gaby_f', '2026-10', config, undefined, de('gaby_f')), 1)
eq('una persona sin tabla usa el default', disponibilidadMes('nadie', '2026-10', config), 1)
check('el bloque confidencial manda si trae un número', (() => {
  const c: Config = { ...config, equipo_confidencial: { dedicacion_por_mes: { guille: { '2026-10': { migracion: 0.4 } } } } }
  return disponibilidadMes('guille', '2026-10', c) === 0.4 && disponibilidadMes('guille', '2026-11', c) === 0.6
})())
check('un "[FALTA]" en el bloque confidencial no rompe: cae a la fuente siguiente', (() => {
  const c: Config = { ...config, equipo_confidencial: { dedicacion_por_mes: { guille: { '2026-10': { migracion: '[FALTA]' } } } } }
  return disponibilidadMes('guille', '2026-10', c) === 0.6
})())

// ── horas de fase y capacidad ─────────────────────────────────────────────────
titulo('horasFaseEnMes — días hábiles de la fase en el mes × horas_dia × dedicación')
const configW = asignaciones.find(a => a.id === 'tim-config-w')!
eq('tim-config-w (23/09 → 28/09, 4 hábiles, 0,6) en septiembre = 16,8 h', horasFaseEnMes(configW, '2026-09', de('guille'), feriados, config), 16.8)
eq('la misma fase en octubre = 0', horasFaseEnMes(configW, '2026-10', de('guille'), feriados, config), 0)
const pruebasG = asignaciones.find(a => a.id === 'tim-pruebas-g')!
eq('tim-pruebas-g cruza de mes: 2 hábiles en sep × 4 h × 0,3', horasFaseEnMes(pruebasG, '2026-09', de('gaby_f'), feriados, config), 2.4)
eq('y 6 hábiles en octubre', horasFaseEnMes(pruebasG, '2026-10', de('gaby_f'), feriados, config), 7.2)
eq('un bloqueo no es carga', horasFaseEnMes({ ...configW, es_bloqueo: true }, '2026-09', de('guille'), feriados, config), 0)
eq('octubre 2026 tiene 21 hábiles (el 12/10 es feriado)', diasHabilesDelMes('2026-10', feriados), 21)
eq('mesesEntre cubre ambos extremos', mesesEntre('2026-09-14', '2027-04-12').length, 8)

titulo('cargaMensual — chequeo de referencia del brief §2 (× 0,875 sobre el mockup a 8 h)')
const carga = cargaMensual(personas, asignaciones, config)
const totalDe = (id: string) => carga.filter(c => c.personaId === id).reduce((s, c) => s + c.horas, 0)
const picoDe = (id: string) => carga.filter(c => c.personaId === id).reduce((m, c) => (c.horas > m.horas ? c : m))
cerca('Willy ≈ 425 × 0,875 = 372 h', totalDe('guille'), 371.9, 4)
cerca('Moni ≈ 276 × 0,875 = 241 h', totalDe('moni'), 241.5, 4)
cerca('Gaby ≈ 371 × 0,5 = 186 h (4 h de 8)', totalDe('gaby_f'), 185.5, 4)
eq('el mes más cargado de Willy sigue siendo enero 2027', picoDe('guille').mes, '2027-01')
check('enero 2027 de Willy supera su capacidad (86 h vs 84)', picoDe('guille').horas > picoDe('guille').capacidad,
  `${picoDe('guille').horas} vs ${picoDe('guille').capacidad}`)
eq('capacidad de Willy en enero 2027 = 20 hábiles × 7 × 0,6 = 84', picoDe('guille').capacidad, 84)
check('la carga se desglosa por cuenta', Object.keys(picoDe('guille').porCuenta).length >= 3, Object.keys(picoDe('guille').porCuenta).join(','))
check('la suma del desglose es el total del mes',
  Math.abs(Object.values(picoDe('guille').porCuenta).reduce((s, h) => s + h, 0) - picoDe('guille').horas) < 0.05)
eq('quien no tiene fases aparece con 0 h', carga.filter(c => c.personaId === 'susi').every(c => c.horas === 0), true)
check('cargaSemanal devuelve una fila por persona y semana', cargaSemanal(personas, asignaciones, config).length > 0)

// ── reglas ────────────────────────────────────────────────────────────────────
titulo('Reglas sobre el v3 corregido — el calendario aprobado no rompe ninguna regla de calendario')
const v = computeViolaciones(asignaciones, personas, config, proyectos)
const cuenta = (tipo: string, sev?: string) => v.filter(x => x.tipo === tipo && (!sev || x.severidad === sev)).length
eq('0 violaciones de dependencia', cuenta('dependencia'), 0)
eq('0 violaciones de margen', cuenta('margen'), 0)
eq('0 violaciones de blackout', cuenta('blackout'), 0)
eq('0 violaciones de tope (rojo)', cuenta('tope_salidas', 'rojo'), 0)
eq('1 informativo de tope: marzo 2027 con 3 salidas, 2 chicas', cuenta('tope_salidas', 'info'), 1)
check('el informativo nombra el mes y las cuentas',
  v.find(x => x.tipo === 'tope_salidas')!.mensaje.startsWith('Marzo 2027 tiene 3 salidas en vivo (Sportline, Aysa, Ford)'),
  v.find(x => x.tipo === 'tope_salidas')!.mensaje)
eq('1 rojo de carga mensual: enero 2027 de Willy', cuenta('carga_mes', 'rojo'), 1)
check('el rojo es de Willy en 2027-01', v.some(x => x.tipo === 'carga_mes' && x.persona_id === 'guille' && x.mes === '2027-01'))
check('los avisos semanales son ámbar', v.filter(x => x.tipo === 'carga_semana').every(x => x.severidad === 'ambar'))
check('ningún mensaje muestra un id de fase',
  v.every(x => !/\b(tim|dla|pof|gsma|aysa|ford)-(repaso|corrida|config|pruebas)/.test(x.mensaje)),
  v.map(x => x.mensaje).join(' | '))

titulo('Margen — hábiles después de Pruebas hasta el corte inclusive')
eq('habilesHasta: del 08/10 al 19/10 (12/10 feriado) = 6', habilesHasta('2026-10-08', '2026-10-19', feriados), 6)
eq('habilesHasta: mismo día = 0', habilesHasta('2026-10-08', '2026-10-08', feriados), 0)
eq('corte de TIM en octubre: día 19 es lunes, queda 19/10', fechaCorteDe('tim', '2026-10', config, feriados), '2026-10-19')
eq('corte de Bonafide en diciembre: 24/12 es jueves, queda', fechaCorteDe('bonafide', '2026-12', config, feriados), '2026-12-24')
check('un corte en fin de semana corre al viernes anterior', (() => {
  const c: Config = { ...config, cortes_novedades_dia: { x: 18 } }   // 18/10/2026 es domingo
  return fechaCorteDe('x', '2026-10', c, feriados) === '2026-10-16'
})())
const margenes = margenesPorCuenta(asignaciones, config, proyectos)
eq('hay un margen por cuenta con mes de salida', margenes.length, 13)
check('todas las cuentas del v3 tienen al menos 5 hábiles', margenes.every(m => (m.habiles ?? 0) >= 5),
  margenes.map(m => `${m.proyectoId}:${m.habiles}`).join(' '))
eq('TIM: pruebas 08/10, corte 19/10 → 6', margenes.find(m => m.proyectoId === 'tim')!.habiles, 6)
eq('GSMA: pruebas 03/12, corte 11/12 (08/12 feriado) → 5', margenes.find(m => m.proyectoId === 'gsma')!.habiles, 5)

check('correr las pruebas de GSMA un día dispara margen', (() => {
  const mov = asignaciones.map(a => a.id === 'gsma-pruebas-g' || a.proyecto_id === 'gsma' && a.tipo === 'Pruebas'
    ? { ...a, fin: a.fin < '2026-12-04' ? '2026-12-04' : a.fin } : a)
  const r = checkMargenYBlackout(mov, config, proyectos).filter(x => x.tipo === 'margen')
  return r.length === 1 && r[0].mensaje.includes('GSMA') && r[0].mensaje.includes('4 días hábiles')
})())
check('pruebas después del corte también es margen (negativo)', (() => {
  const mov = asignaciones.map(a => a.proyecto_id === 'tim' && a.tipo === 'Pruebas' ? { ...a, fin: '2026-10-21' } : a)
  const r = checkMargenYBlackout(mov, config, proyectos).filter(x => x.tipo === 'margen')
  return r.length === 1 && r[0].mensaje.includes('después del corte')
})())

titulo('Blackout — ninguna Configuración toca el 21/12 → 08/01')
check('una configuración que cruza el 21/12 dispara blackout', (() => {
  const mov = asignaciones.map(a => a.id === 'copetro-config-w' || (a.proyecto_id === 'copetro' && a.tipo === 'Configuracion' && a.persona_id === 'guille')
    ? { ...a, inicio: '2026-12-16', fin: '2026-12-22' } : a)
  const r = checkMargenYBlackout(mov, config, proyectos).filter(x => x.tipo === 'blackout')
  return r.length >= 1 && r[0].mensaje.includes('Copetro') && r[0].mensaje.includes('blackout')
})())
check('unas pruebas dentro del blackout no disparan (solo aplica a Configuración)', (() => {
  const fake: Asignacion = { id: 'z', proyecto_id: 'tim', tipo: 'Pruebas', persona_id: 'moni', inicio: '2026-12-28', fin: '2026-12-30', duracion_dias: 3, dedicacion_pct: 0.3, predecesoras: [], es_bloqueo: false }
  return checkMargenYBlackout([fake], config, proyectos).filter(x => x.tipo === 'blackout').length === 0
})())

titulo('Tope de salidas')
check('4 salidas en un mes es rojo aunque sean chicas', (() => {
  const c: Config = { ...config, salidas_en_vivo_propuestas: { ...config.salidas_en_vivo_propuestas, carrier: '2027-03' } }
  const r = checkTopeSalidas(asignaciones, c, proyectos)
  return r.some(x => x.mes === '2027-03' && x.severidad === 'rojo' && x.mensaje.includes('el tope es 2'))
})())
check('3 salidas con una sola chica es rojo', (() => {
  // marzo: Sportline (grande), Ford (chica), Piano (std) → 3 con una sola chica
  const c: Config = { ...config, salidas_en_vivo_propuestas: { ...config.salidas_en_vivo_propuestas, aysa: '2027-04', piano: '2027-03' } }
  const r = checkTopeSalidas(asignaciones, c, proyectos)
  return r.some(x => x.mes === '2027-03' && x.severidad === 'rojo') && !r.some(x => x.mes === '2027-04')
})())
check('las fuera del plan cuentan contra el tope', (() => {
  const c: Config = { ...config, salidas_en_vivo_propuestas: { ...config.salidas_en_vivo_propuestas, tim: '2026-10', piano: '2026-10' } }
  const r = checkTopeSalidas(asignaciones, c, proyectos)   // oct: TIM + Piano + Finadiet = 3, ninguna chica
  return r.some(x => x.mes === '2026-10' && x.severidad === 'rojo' && x.mensaje.includes('Finadiet'))
})())
eq('sin tope configurado la regla no corre', checkTopeSalidas(asignaciones, { ...config, reglas_calendario: undefined }, proyectos).length, 0)

titulo('Dependencia Configuración → Pruebas, de la cuenta, sin importar la persona')
check('pruebas de Moni antes de que cierre la config de Willy dispara, aunque sean personas distintas', (() => {
  const mov = asignaciones.map(a => a.id === 'tim-pruebas-m' ? { ...a, inicio: '2026-09-25', fin: '2026-09-29' } : a)
  const r = checkDependenciaConfigPruebas(mov, proyectos)
  return r.length === 1 && r[0].asignacion_id === 'tim-pruebas-m' && r[0].mensaje === 'Las pruebas de TIM arrancan el 25/09, antes de que cierre su configuración (28/09)'
})())
check('empezar el mismo día en que cierra la configuración también dispara', (() => {
  const mov = asignaciones.map(a => a.id === 'tim-pruebas-w' ? { ...a, inicio: '2026-09-28' } : a)
  return checkDependenciaConfigPruebas(mov, proyectos).length === 1
})())
check('un relevamiento que se pisa con otro relevamiento NO es esta regla', (() => {
  const mov = asignaciones.map(a => a.id === 'tim-repaso' ? { ...a, inicio: '2026-09-14', fin: '2026-09-15' } : a)
  return checkDependenciaConfigPruebas(mov, proyectos).length === 0
})())

titulo('Carga mensual y semanal')
check('duplicar la dedicación de Willy en enero dispara rojo con el mensaje del mes', (() => {
  const mov = asignaciones.map(a => a.persona_id === 'guille' && a.inicio.startsWith('2027-01') ? { ...a, dedicacion_pct: 1 } : a)
  const r = checkCargaMensual(mov, personas, config, proyectos)
  return r.some(x => x.mes === '2027-01' && x.mensaje.startsWith('Enero 2027: Guille tiene'))
})())
check('el mensaje de carga nombra cuentas, no ids', (() => {
  const r = checkCargaMensual(asignaciones, personas, config, proyectos)
  return r.length === 1 && r[0].mensaje.includes('Marval') && !r[0].mensaje.includes('marval-')
})())
check('una semana al 300% es ámbar, nunca rojo', (() => {
  const mov = asignaciones.map(a => a.id === 'tim-config-w' ? { ...a, dedicacion_pct: 3 } : a)
  const r = checkCargaSemanal(mov, personas, config)
  return r.some(x => x.persona_id === 'guille' && x.semana === '2026-09-21') && r.every(x => x.severidad === 'ambar')
})())
check('Gaby con dos fases de 0,5 el mismo mes no dispara si el total entra en sus 4 h', (() => {
  const dos: Asignacion[] = [
    { id: 'a', proyecto_id: 'tim', tipo: 'Configuracion', persona_id: 'gaby_f', inicio: '2026-09-01', fin: '2026-09-04', duracion_dias: 4, dedicacion_pct: 0.5, predecesoras: [], es_bloqueo: false },
    { id: 'b', proyecto_id: 'dla', tipo: 'Configuracion', persona_id: 'gaby_f', inicio: '2026-09-01', fin: '2026-09-04', duracion_dias: 4, dedicacion_pct: 0.5, predecesoras: [], es_bloqueo: false },
  ]
  return checkCargaMensual(dos, personas, config, proyectos).length === 0
})())
eq('nombreMes', nombreMes('2027-01'), 'Enero 2027')

// ── A2: mes de salida como dato ───────────────────────────────────────────────
titulo('Mes de salida como dato (A2)')
eq('mesSalidaDe lee el plan', mesSalidaDe('dla', config), '2026-11')
eq('una cuenta sin mes devuelve null', mesSalidaDe('nadie', config), null)
const cuentas = cuentasMigracion(proyectos, asignaciones, config)
eq('DLA sale en noviembre, no en octubre (sus pruebas terminan el 30/10)', cuentas.find(c => c.id === 'dla')!.enVivo, '2026-11-30')
eq('sin config, DLA cae al fin de sus fases', cuentasMigracion(proyectos, asignaciones).find(c => c.id === 'dla')!.enVivo, '2026-10-30')
const fuera = cuentasFueraDelPlan(config)
eq('dos cuentas fuera del plan: POF y Finadiet', fuera.map(c => c.nombre).join(','), 'POF,Finadiet')
check('están marcadas como fuera del plan y sin fases', fuera.every(c => c.fueraDelPlan && c.fases.length === 0))
const trimestres = migracionPorTrimestre([...cuentas, ...fuera])
eq('POF aparece como salida en T3 2026', trimestres.find(t => t.key === '2026-3')!.salidas.join(','), 'POF')
check('DLA aparece en T4 2026 junto con Finadiet', (() => {
  const s = trimestres.find(t => t.key === '2026-4')!.salidas
  return s.includes('DLA') && s.includes('Finadiet')
})())
eq('al cierre están las 15 en vivo', trimestres[trimestres.length - 1].enVivo, 15)
const r = resumenMigracion([...cuentas, ...fuera], '2026-10-15')
eq('al 15/10/2026 solo POF está en vivo', r.enVivoHoy, 1)
eq('el programa cierra con Carrier en abril 2027', `${r.cuentaCierre} ${r.ultimaSalida}`, 'Carrier 2027-04-30')

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
