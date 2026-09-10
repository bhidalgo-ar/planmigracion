/**
 * Tests de "quién hace qué": reasignar una fase viendo el impacto (simularReasignacion) y
 * pasarle fases a otra persona en bloque (traspaso). Sobre el fixture v3.
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { aplicarTraspaso, describirTraspaso, fasesATraspasar, simularReasignacion, tieneRolPara } from '../src/planificador'
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
feriadosDeConfig(config)

const persona = (over: Partial<Persona>): Persona => ({ id: 'x', alias: 'X', skills: [], capacidad_horas_semana: 40, buffer_pct: 0, ...over })

titulo('tieneRolPara — rol o skill de la fase, como señal')
check('skill configuracion → Configuración', tieneRolPara(persona({ skills: ['configuracion'] }), 'Configuracion'))
check('skill testeo también cuenta para Pruebas', tieneRolPara(persona({ skills: ['testeo'] }), 'Pruebas'))
check('rol configuracion sin skills → Configuración', tieneRolPara(persona({ rol: 'configuracion' }), 'Configuracion'))
check('sin skills ni rol → no', !tieneRolPara(persona({}), 'Relevamiento'))
check('skill cierre → Cierre', tieneRolPara(persona({ skills: ['cierre'] }), 'Cierre'))
check('configuracion no habilita Pruebas', !tieneRolPara(persona({ skills: ['configuracion'] }), 'Pruebas'))

titulo('simularReasignacion — la configuración de Moni en TIM (tim-config-m)')
const cands = simularReasignacion('tim-config-m', asignaciones, personas, config, proyectos)
eq('una candidata por persona del plan', cands.length, personas.length)
eq('la primera es la actual (Moni)', cands[0].personaId, 'moni')
check('la actual está marcada y no simula cambio', cands[0].actual && cands[0].estado === 'verde' && cands[0].motivo === null)
check('después de la actual vienen primero quienes tienen el rol', (() => {
  const resto = cands.slice(1)
  const primerSinRol = resto.findIndex(c => !c.tieneRol)
  const ultimoConRol = resto.map(c => c.tieneRol).lastIndexOf(true)
  return primerSinRol === -1 || ultimoConRol < primerSinRol
})(), cands.map(c => `${c.alias}:${c.tieneRol ? 'rol' : '-'}`).join(' '))
check('cada candidata tiene un estado válido', cands.every(c => ['verde', 'ambar', 'rojo'].includes(c.estado)))
check('una candidata sin conflictos nuevos no trae motivo', cands.filter(c => !c.actual && c.estado === 'verde').every(c => c.motivo === null))
eq('una fase inexistente devuelve vacío', simularReasignacion('nadie', asignaciones, personas, config, proyectos).length, 0)

const conVac = [...asignaciones, { id: 'vac-gaby_f-2026-09-21', proyecto_id: null, tipo: 'Vacaciones' as const, persona_id: 'gaby_f', inicio: '2026-09-21', fin: '2026-09-30', duracion_dias: 8, dedicacion_pct: 1, predecesoras: [], es_bloqueo: true, _nombre: 'Vacaciones' }]
const gaby = simularReasignacion('tim-config-m', conVac, personas, config, proyectos).find(c => c.personaId === 'gaby_f')!
eq('pasársela a Gaby de vacaciones esas fechas es rojo', gaby.estado, 'rojo')
check('y el motivo nombra las vacaciones', /vacaciones/i.test(gaby.motivo ?? ''), gaby.motivo ?? '')

titulo('Traspaso en bloque — Moni le pasa sus configuraciones a Susi desde enero 2027')
const t = { origen: 'moni', destino: 'susi', tipos: ['Configuracion' as const], desdeMes: '2027-01' }
const mueve = fasesATraspasar(asignaciones, t)
check('mueve al menos una fase', mueve.length > 0, String(mueve.length))
check('todas son configuraciones de Moni que arrancan en 2027', mueve.every(a => a.persona_id === 'moni' && a.tipo === 'Configuracion' && a.inicio >= '2027-01-01'))
check('no incluye las de 2026', !mueve.some(a => a.inicio < '2027-01-01'))
const despues = aplicarTraspaso(asignaciones, t)
eq('misma cantidad de barras', despues.length, asignaciones.length)
check('las movidas ahora son de Susi y no cambiaron de fecha', mueve.every(a => {
  const d = despues.find(x => x.id === a.id)!
  return d.persona_id === 'susi' && d.inicio === a.inicio && d.fin === a.fin && d.duracion_dias === a.duracion_dias
}))
check('las demás quedaron igual', despues.filter(a => !mueve.some(m => m.id === a.id)).every(a => a === asignaciones.find(x => x.id === a.id)))
const rep = describirTraspaso(asignaciones, t, personas, config, proyectos)
eq('el reporte cuenta las mismas fases', rep.fases, mueve.length)
check('el reporte trae conteos antes y después', typeof rep.rojosAntes === 'number' && typeof rep.rojosDespues === 'number')
eq('origen = destino no mueve nada', describirTraspaso(asignaciones, { ...t, destino: 'moni' }, personas, config, proyectos).fases, 0)
const todo = fasesATraspasar(asignaciones, { origen: 'moni', destino: 'susi', tipos: null, desdeMes: null })
eq('sin filtros mueve todas las fases de Moni (no los bloqueos)', todo.length, asignaciones.filter(a => a.persona_id === 'moni' && !a.es_bloqueo).length)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
