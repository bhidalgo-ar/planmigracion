/**
 * Tests de lo que leen las vistas Salidas, Hoy y Reunión (src/vistasPrograma.ts). Corren
 * sobre el plan v3 (test/fixtures/plan-v3.json) mirado al 01/10/2026. 23/10/2026.
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { capitulosReunion, estacionesDelPrograma, estadoDeCuenta, hoyProximo, mesaDeSalidas, mesesEntre, porMigrar, titularSalidas } from '../src/vistasPrograma'
import { computeViolaciones } from '../src/rules'
import { cuentasEnAxton, mesSalidaDe } from '../src/capacidad'
import type { PlanDatos } from '../src/escenario'
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

const plan: PlanDatos = {
  personas: planV3.personas as unknown as Persona[],
  proyectos: planV3.proyectos as unknown as Proyecto[],
  asignaciones: planV3.asignaciones as unknown as Asignacion[],
  config: planV3.config as unknown as Config,
}
const HOY = '2026-10-01'
const viol = computeViolaciones(plan.asignaciones, plan.personas, plan.config, plan.proyectos)

titulo('estadoDeCuenta — TIM y Carrier al 01/10/2026 (plan v3)')
const tim = estadoDeCuenta('tim', plan, HOY)
eq('TIM está en pruebas', tim.momento, 'armando')
check('y lo dice con la fecha', tim.texto.startsWith('En pruebas hasta'), tim.texto)
eq('relevamiento y configuración hechos', [tim.etapas.Relevamiento, tim.etapas.Configuracion], ['hecha', 'hecha'])
check('lo que sigue es de una etapa posterior, no otra prueba', !tim.sigue.startsWith('Sigue pruebas'), tim.sigue)
const carrier = estadoDeCuenta('carrier', plan, HOY)
eq('Carrier ya tuvo su corrida: esperando', carrier.momento, 'esperando')
check('y dice cuándo sigue', carrier.texto.startsWith('Sigue relevamiento'), carrier.texto)
eq('ninguna cuenta del v3 arrancó al 01/06', estadoDeCuenta('carrier', plan, '2026-06-01').momento, 'sin_empezar')
eq('después de su liquidación, TIM está en Axton', estadoDeCuenta('tim', plan, '2027-06-01').momento, 'en_axton')

titulo('mesaDeSalidas — una columna por mes, de hoy a un mes después de la última salida')
const mesa = mesaDeSalidas(plan, HOY)
eq('arranca en el mes de hoy', mesa.meses[0].mes, '2026-10')
eq('termina un mes después de la última salida (Carrier, abril 2027)', mesa.meses[mesa.meses.length - 1].mes, '2027-05')
eq('octubre: TIM y Finadiet (fuera del plan)', mesa.meses[0].tarjetas.map(t => t.nombre), ['TIM', 'Finadiet'])
check('las fuera del plan van marcadas', mesa.meses[0].tarjetas.find(t => t.nombre === 'Finadiet')!.fueraDelPlan)
eq('cada mes cuenta las que están en Axton', mesa.meses.map(m => m.enAxton), mesa.meses.map(m => cuentasEnAxton(m.mes, plan.config)))
eq('una fila por persona de implementación', mesa.equipo.map(e => e.id).sort(), ['gaby_f', 'guille', 'moni'])
check('el pico del equipo es el rojo de Guille en enero', mesa.pico?.alias === 'Guille' && mesa.pico.mes === '2027-01', JSON.stringify(mesa.pico))
const { porMigrar: pm } = porMigrar(plan.config, HOY)
eq('por migrar = las que siguen en Meta 4 este mes', pm, mesa.porMigrar)
eq('marzo 2027 tiene tres salidas: no es "una por mes"', titularSalidas(plan, HOY).startsWith('Una cuenta'), false)

titulo('hoyProximo')
const h = hoyProximo(plan, viol, HOY)
check('el titular nombra la última salida', h.titular.includes('Carrier') && h.titular.includes('abril 2027'), h.titular)
check('ahora incluye la cuenta que está en pruebas', h.ahora.some(a => a.nombre === 'TIM'))
eq('las próximas son los próximos tres meses con salida', h.proximas.map(p => p.mes), ['2026-10', '2026-11', '2026-12'])
check('con el corte y los hábiles que faltan', h.proximas.every(p => p.corte === null || (p.habiles !== null && p.habiles >= 0)))
eq('después: el resto, en orden', h.despues.map(d => d.mes), [...h.despues.map(d => d.mes)].sort())
eq('las 8 semanas arrancan el lunes de esta', h.semanas[0], '2026-09-28')
check('dice los rojos del plan', h.decidir.rojos.length === viol.filter(v => v.severidad === 'rojo').length)

titulo('capitulosReunion y estaciones')
const caps = capitulosReunion(plan, viol, HOY)
eq('cuatro preguntas', caps.map(c => c.pregunta), ['¿Dónde estamos?', '¿Qué sale y cuándo?', '¿Da el equipo?', '¿Qué decidimos hoy?'])
check('dónde estamos: N de M en Axton', /^\d+ de \d+ cuentas en Axton$/.test(caps[0].respuesta), caps[0].respuesta)
check('qué decidimos: los rojos', caps[3].respuesta === `${viol.filter(v => v.severidad === 'rojo').length} en rojo`, caps[3].respuesta)
const est = estacionesDelPrograma(plan, HOY)
eq('una estación por mes de hoy a la última salida', est.map(e => e.mes), mesesEntre('2026-10', '2027-04'))
check('cada salida del plan está en su estación', plan.proyectos.filter(p => (mesSalidaDe(p.id, plan.config) ?? '') >= '2026-10').every(p => est.find(e => e.mes === mesSalidaDe(p.id, plan.config))!.cuentas.includes(p.nombre)))

console.log(`\n${fallos ? `${fallos} FALLAS` : 'TODO OK'} — ${corridos} chequeos`)
if (fallos) process.exit(1)
