/**
 * Tests de vacaciones: los bloqueos `tipo: 'Vacaciones'` restan capacidad (mes y semana),
 * la regla `vacaciones` marca las fases que caen encima, y la tira de meses del panel
 * ("¿dónde entra la cuenta?") lo refleja. Sobre el fixture v3.
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { cargaMensual, cargaSemanal, diasDeVacaciones } from '../src/capacidad'
import { checkVacaciones, computeViolaciones } from '../src/rules'
import { planificarCuenta, simularDestinos } from '../src/planificador'
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
function cerca(nombre: string, actual: number, esperado: number, tol = 0.05) {
  check(nombre, Math.abs(actual - esperado) <= tol, `esperado ${esperado}, obtenido ${actual}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

const personas = planV3.personas as unknown as Persona[]
const proyectos = planV3.proyectos as unknown as Proyecto[]
const asignaciones = planV3.asignaciones as unknown as Asignacion[]
const config = planV3.config as unknown as Config
const feriados = feriadosDeConfig(config)

function vac(personaId: string, inicio: string, fin: string): Asignacion {
  return { id: `vac-${personaId}-${inicio}`, proyecto_id: null, tipo: 'Vacaciones', persona_id: personaId, inicio, fin,
    duracion_dias: 0, dedicacion_pct: 1, predecesoras: [], es_bloqueo: true, _nombre: 'Vacaciones' }
}

titulo('diasDeVacaciones — solo hábiles, solo bloqueos tipo Vacaciones de esa persona')
const conVac = [...asignaciones, vac('moni', '2026-10-12', '2026-10-16')]
const dias = diasDeVacaciones('moni', conVac, feriados)
eq('del 12 al 16/10 son 4 hábiles (el 12 es feriado)', dias.size, 4)
check('incluye el 13/10 y no el 12/10', dias.has('2026-10-13') && !dias.has('2026-10-12'))
eq('Guille no tiene vacaciones', diasDeVacaciones('guille', conVac, feriados).size, 0)
eq('un bloqueo que no es Vacaciones (corrida) no cuenta', diasDeVacaciones('gaby_f', asignaciones, feriados).size, 0)

titulo('cargaMensual — la capacidad del mes baja con los días de vacaciones')
const sinV = cargaMensual(personas, asignaciones, config).find(c => c.personaId === 'moni' && c.mes === '2026-10')!
const conV = cargaMensual(personas, conVac, config).find(c => c.personaId === 'moni' && c.mes === '2026-10')!
check('la capacidad de Moni en octubre baja', conV.capacidad < sinV.capacidad, `${sinV.capacidad} → ${conV.capacidad}`)
cerca('baja exactamente 4 días × 7 h × su disponibilidad', sinV.capacidad - conV.capacidad, 4 * 7 * conV.disponibilidad, 0.05)
eq('las horas planificadas no cambian (el choque lo marca la regla, no la capacidad)', conV.horas, sinV.horas)
eq('noviembre no se toca', cargaMensual(personas, conVac, config).find(c => c.personaId === 'moni' && c.mes === '2026-11')!.capacidad,
  cargaMensual(personas, asignaciones, config).find(c => c.personaId === 'moni' && c.mes === '2026-11')!.capacidad)

titulo('cargaSemanal — la semana de vacaciones queda con la capacidad de los días que quedan')
const semSin = cargaSemanal(personas, asignaciones, config).find(c => c.personaId === 'moni' && c.semana === '2026-10-12')!
const semCon = cargaSemanal(personas, conVac, config).find(c => c.personaId === 'moni' && c.semana === '2026-10-12')!
check('la semana del 12/10 tenía 4 hábiles de capacidad y queda en 0', semSin.capacidad > 0 && semCon.capacidad === 0, `${semSin.capacidad} → ${semCon.capacidad}`)
const semParcial = cargaSemanal(personas, [...asignaciones, vac('moni', '2026-10-13', '2026-10-15')], config).find(c => c.personaId === 'moni' && c.semana === '2026-10-12')!
cerca('con vacaciones del 13 al 15 queda solo el viernes 16: 1 × 7 × disp', semParcial.capacidad, semSin.capacidad / 4, 0.05)

titulo('Regla vacaciones — una fase sobre las vacaciones de quien la hace')
// tim-config-m es de Moni, 23/09 → 25/09
const pisa = checkVacaciones([...asignaciones, vac('moni', '2026-09-22', '2026-09-30')], personas, proyectos)
check('dispara para la configuración de Moni en TIM', pisa.some(v => v.asignacion_id === 'tim-config-m' && v.severidad === 'rojo'), pisa.map(v => v.asignacion_id).join(','))
check('el mensaje nombra persona, fase, cuenta y fechas',
  pisa.some(v => v.mensaje === 'Moni tiene la configuración de TIM del 23/09 al 25/09 y está de vacaciones del 22/09 al 30/09'), pisa.map(v => v.mensaje).join(' | '))
check('también pisa sus pruebas de TIM (29/09 → 01/10)', pisa.some(v => v.asignacion_id === 'tim-pruebas-m'))
check('no dispara para Guille aunque trabaje esos días', !pisa.some(v => v.persona_id === 'guille'))
eq('sin vacaciones cargadas no hay regla', checkVacaciones(asignaciones, personas, proyectos).length, 0)
check('computeViolaciones la incluye', computeViolaciones([...asignaciones, vac('moni', '2026-09-22', '2026-09-30')], personas, config, proyectos).some(v => v.tipo === 'vacaciones'))
check('el v3 sin vacaciones sigue dando lo mismo que antes', computeViolaciones(asignaciones, personas, config, proyectos).every(v => v.tipo !== 'vacaciones'))

titulo('Planificador y tira de meses — las vacaciones no se esquivan solas, se ven')
const vacNov = [...asignaciones, vac('moni', '2026-11-02', '2026-11-30')]
const r = planificarCuenta('tim', vacNov, '2026-11', config)
check('planificar TIM en noviembre sigue funcionando (las vacaciones no son fases)', r.ok)
const destinos = simularDestinos('tim', ['2026-11', '2026-12'], vacNov, personas, config, proyectos)
const nov = destinos.find(d => d.mes === '2026-11')!
eq('noviembre es rojo', nov.estado, 'rojo')
check('y el motivo puede ser el tope o las vacaciones de Moni (los dos son rojos nuevos)', /vacaciones|tope|salidas/i.test(nov.motivo ?? ''), nov.motivo ?? '')
const soloVac = simularDestinos('bonafide', ['2026-11'], [...asignaciones, vac('guille', '2026-10-19', '2026-11-30')], personas, config, proyectos)[0]
check('Bonafide en noviembre con Guille de vacaciones: el motivo nombra las vacaciones', /vacaciones/i.test(soloVac.motivo ?? ''), soloVac.motivo ?? '')

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
