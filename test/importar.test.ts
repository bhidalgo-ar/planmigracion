/**
 * Tests de la validación al importar (src/validacionPlan.ts) y de su uso en el store.
 * Un JSON roto tiene que dar un resultado legible, nunca una excepción ni pantalla blanca.
 */

const mem = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(), key: () => null, length: 0,
}

import { validarPlan } from '../src/validacionPlan'
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

const clon = () => JSON.parse(JSON.stringify(planV3)) as typeof planV3 & { config: Record<string, unknown> }

titulo('validarPlan — el v3 entra limpio')
const okV3 = validarPlan(JSON.stringify(planV3))
eq('ok', okV3.ok, true)
eq('sin errores', okV3.errores.length, 0)
eq('sin avisos', okV3.avisos.join(' | '), '')
eq('91 fases, 13 cuentas, 6 personas', `${okV3.resumen.asignaciones}/${okV3.resumen.proyectos}/${okV3.resumen.personas}`, '91/13/6')
check('el config pasa entero (claves que no valida incluidas)', !!okV3.plan && 'tiers_v3' in okV3.plan.config && 'insumos' in okV3.plan.config)

titulo('validarPlan — errores de forma frenan el import')
const roto = validarPlan('{ esto no es json')
check('JSON sintácticamente inválido: mensaje, no excepción', !roto.ok && roto.errores[0].startsWith('El archivo no es un JSON válido'), roto.errores[0])
const lista = validarPlan('[1,2,3]')
check('un array no es un plan', !lista.ok && lista.errores[0].includes('forma de un plan'))
const sinRaiz = validarPlan(JSON.stringify({ personas: [], proyectos: [] }))
check('faltan claves raíz: las nombra', !sinRaiz.ok && sinRaiz.errores[0].includes('"asignaciones"') && sinRaiz.errores[0].includes('"config"'), sinRaiz.errores[0])
const sinHorizonte = clon(); delete sinHorizonte.config.horizonte
const rH = validarPlan(JSON.stringify(sinHorizonte))
check('sin horizonte: error con la ruta config.horizonte', !rH.ok && rH.errores.some(e => e.startsWith('config.horizonte')), rH.errores.join(' | '))
const sinFeriados = clon(); delete sinFeriados.config.feriados_nacionales_2026
check('sin feriados 2026: error', !validarPlan(JSON.stringify(sinFeriados)).ok)
const malFecha = clon(); (malFecha.asignaciones[0] as { inicio: string }).inicio = '14/09/2026'
const rF = validarPlan(JSON.stringify(malFecha))
check('una fecha con otro formato: error con la ruta de la fase', !rF.ok && rF.errores.some(e => e.startsWith('asignaciones[0].inicio')), rF.errores.join(' | '))
const alReves = clon(); (alReves.asignaciones[0] as { inicio: string; fin: string }).fin = '2026-01-01'
check('fin antes de inicio: error', !validarPlan(JSON.stringify(alReves)).ok)
const tipoRaro = clon(); (tipoRaro.asignaciones[0] as { tipo: string }).tipo = 'UAT'
check('un tipo de fase desconocido: error', !validarPlan(JSON.stringify(tipoRaro)).ok)
// La Actualización Final es fase 'Cierre'. Cuando se agregó, el enum del validador
// todavía tenía tres fases y el plan entero se rechazaba: nada de "se ignora esa barra".
const conCierre = clon(); (conCierre.asignaciones[0] as { tipo: string }).tipo = 'Cierre'
const rCierre = validarPlan(JSON.stringify(conCierre))
check('la fase Cierre (Actualización Final) se acepta', rCierre.ok, rCierre.errores.join(' | '))
const horizInvertido = clon(); (horizInvertido.config.horizonte as { desde: string; hasta: string }).hasta = '2020-01-01'
check('horizonte invertido: error', !validarPlan(JSON.stringify(horizInvertido)).ok)

titulo('validarPlan — datos dudosos entran con aviso')
const huerfana = clon(); (huerfana.asignaciones[0] as { persona_id: string }).persona_id = 'nadie'
const rP = validarPlan(JSON.stringify(huerfana))
eq('persona inexistente: el plan entra', rP.ok, true)
eq('y cuenta 1 fase sin asignar', rP.resumen.sinAsignar, 1)
check('el aviso nombra la cuenta y la fila "Sin asignar"', rP.avisos[0].includes('TIM') && rP.avisos[0].includes('Sin asignar'), rP.avisos[0])
const predRota = clon(); (predRota.asignaciones[1] as { predecesoras: string[] }).predecesoras = ['no-existe']
const rD = validarPlan(JSON.stringify(predRota))
check('predecesora inexistente: aviso, no error', rD.ok && rD.avisos.some(a => a.includes('"no-existe"')), rD.avisos.join(' | '))
const conExtra = clon(); (conExtra as unknown as Record<string, unknown>).notas_de_willy = { x: 1 }
const rX = validarPlan(JSON.stringify(conExtra))
check('una clave raíz desconocida se ignora y se avisa', rX.ok && rX.ignoradas.join(',') === 'notas_de_willy' && rX.avisos.some(a => a.includes('notas_de_willy')))
const cuentaRota = clon(); (cuentaRota.asignaciones[2] as { proyecto_id: string }).proyecto_id = 'fantasma'
check('cuenta inexistente en una fase: aviso', validarPlan(JSON.stringify(cuentaRota)).avisos.some(a => a.includes('"fantasma"')))

titulo('Store — importarJSON usa la validación')
const { useSimuladorStore } = await import('../src/store')
useSimuladorStore.getState().importarJSON(JSON.stringify(planV3))
const antes = useSimuladorStore.getState().asignaciones.length
const rStore = useSimuladorStore.getState().importarJSON('{ roto')
eq('un JSON roto devuelve el resultado con el error', rStore.ok, false)
eq('y el plan cargado sigue igual', useSimuladorStore.getState().asignaciones.length, antes)
const rSinH = useSimuladorStore.getState().importarJSON(JSON.stringify(sinHorizonte))
check('sin horizonte no se importa (antes: pantalla blanca)', !rSinH.ok && useSimuladorStore.getState().config.horizonte.desde === planV3.config.horizonte.desde)
const rOk = useSimuladorStore.getState().importarJSON(JSON.stringify(huerfana))
eq('con persona inexistente sí se importa', rOk.ok, true)
eq('la fase huérfana queda en el plan (para la fila "Sin asignar")', useSimuladorStore.getState().asignaciones.filter(a => a.persona_id === 'nadie').length, 1)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
