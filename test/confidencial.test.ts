/**
 * Tests de la pestaña confidencial (src/confidencial.ts) y del export que la protege.
 * El bloque `equipo_confidencial` de estos tests es de FORMA, con números inventados a
 * propósito para el test: nunca son datos reales del equipo, y el fixture v3 del repo no
 * trae el bloque.
 */

// localStorage y sessionStorage falsos: zustand/persist pide el primero y el desbloqueo usa el segundo.
function storageFalso(): Storage {
  const mem = new Map<string, string>()
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => mem.clear(),
    key: () => null,
    get length() { return mem.size },
  } as Storage
}
;(globalThis as unknown as { localStorage: Storage }).localStorage = storageFalso()
;(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = storageFalso()

import type { Asignacion, Config, Persona } from '../src/types'
import {
  bloquear, desbloquear, estaDesbloqueado, filasConfidencial, filasReparto, lecturaTransicion, mesesConfidencial,
  soporteMesAMes, tieneBloqueConfidencial, verificarContrasena,
} from '../src/confidencial'
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
const configV3 = planV3.config as unknown as Config

// Bloque de FORMA (brief §3.3), números de ejemplo para el test.
const BLOQUE = {
  _doc: 'ejemplo de forma para el test',
  dedicacion_por_mes: {
    susi:   { '2026-09': { meta4_soporte: 0.3, toyota: 0.4 }, '2026-10': { meta4_soporte: 0.5, toyota: 0.5 } },
    leo:    { '2026-09': { meta4_soporte: 0.7 }, '2026-10': { meta4_soporte: 0.6 } },
    lucas:  { '2026-09': { meta4_soporte: '[FALTA]' }, '2026-10': { meta4_soporte: 0.4 } },
    guille: { '2026-09': { migracion: 0.6, otros: 0.4 } },
  },
  transicion_susana: { desde: '2026-11', toma_meta4_de: ['leo', 'lucas'], _nota: 'nota de prueba' },
}
const configCon: Config = { ...configV3, equipo_confidencial: BLOQUE }

titulo('Contraseña — hash SHA-256, nunca el texto en el código')
eq('la contraseña correcta desbloquea', await verificarContrasena('Mudar123'), true)
eq('una incorrecta no', await verificarContrasena('mudar123'), false)
eq('vacía no', await verificarContrasena(''), false)

titulo('Desbloqueo — vive en sessionStorage, atado a esta carga de la página')
bloquear()
eq('arranca bloqueado', estaDesbloqueado(), false)
desbloquear()
eq('desbloquear lo abre', estaDesbloqueado(), true)
eq('no toca localStorage', globalThis.localStorage.length, 0)
check('lo guardado en sessionStorage no es un "1" fijo: otra carga de la página no lo reconoce',
  globalThis.sessionStorage.getItem('simulador-ha-confidencial') !== '1' && (globalThis.sessionStorage.getItem('simulador-ha-confidencial') ?? '').length > 8)
globalThis.sessionStorage.setItem('simulador-ha-confidencial', 'token-de-otra-carga')
eq('un token de otra carga no desbloquea', estaDesbloqueado(), false)
bloquear()
eq('bloquear lo cierra', estaDesbloqueado(), false)

titulo('Existencia de la pestaña')
eq('el v3 del repo NO trae el bloque (regla dura)', tieneBloqueConfidencial(configV3), false)
eq('con el bloque, la pestaña existe', tieneBloqueConfidencial(configCon), true)
eq('un bloque vacío no cuenta', tieneBloqueConfidencial({ ...configV3, equipo_confidencial: { dedicacion_por_mes: {} } }), false)

titulo('Vista — filas por persona y celdas por mes')
eq('meses del bloque: sep, oct y nov (por la transición)', mesesConfidencial(BLOQUE).join(','), '2026-09,2026-10,2026-11')
const filas = filasConfidencial(configCon, personas)
eq('orden: Susi, Leo, Lucas, Willy', filas.map(f => f.personaId).join(','), 'susi,leo,lucas,guille')
eq('Leo y Lucas tienen alias aunque no sean personas del plan', `${filas[1].alias}/${filas[2].alias}`, 'Leo/Lucas')
eq('Susi sep: 30 % Meta4 + 40 % Toyota', `${filas[0].meses[0].frentes.meta4_soporte}/${filas[0].meses[0].frentes.toyota}`, '0.3/0.4')
eq('Lucas sep está en [FALTA]', filas[2].meses[0].conFaltas, true)
eq('y dice qué falta', filas[2].meses[0].faltas.join(','), 'Soporte Meta4')
eq('Willy oct no tiene entrada: celda vacía', filas[3].meses[1].vacio, true)
eq('una clave desconocida cae en otros', filasConfidencial({ ...configV3, equipo_confidencial: { dedicacion_por_mes: { lau: { '2026-09': { capacitacion: 0.2 } } } } }, personas)[0].meses[0].frentes.otros, 0.2)
check('sin bloque, sin filas', filasConfidencial(configV3, personas).length === 0)

titulo('Lectura de la transición')
const lectura = lecturaTransicion(configCon, personas)!
eq('desde noviembre 2026', lectura.desde, '2026-11')
eq('toma de Leo y Lucas', lectura.tomaDe.join(','), 'Leo,Lucas')
eq('horas liberadas = (0,6 + 0,4) × 7 h × 5 del mes anterior', lectura.horasSemanaLiberadas, 35)
eq('el texto', lectura.texto, 'Desde noviembre de 2026, Susana toma el soporte Meta4 de Leo y Lucas; quedan libres 35 h por semana.')
const sinMes = lecturaTransicion({ ...configV3, equipo_confidencial: { ...BLOQUE, transicion_susana: { desde: '[FALTA: mes 2027]', toma_meta4_de: ['leo', 'lucas'] } } }, personas)!
check('con el mes en [FALTA] lo dice y no estima', sinMes.desde === null && sinMes.texto.includes('[FALTA: mes]') && sinMes.horasSemanaLiberadas === null, sinMes.texto)
const conFalta = lecturaTransicion({ ...configV3, equipo_confidencial: { ...BLOQUE, transicion_susana: { desde: '2026-10', toma_meta4_de: ['leo', 'lucas'] } } }, personas)!
check('si un dato del mes anterior está en [FALTA], las horas quedan en [FALTA]', conFalta.horasSemanaLiberadas === null && conFalta.texto.includes('[FALTA: horas'), conFalta.texto)

titulo('Reparto calculado — Susi por tickets, Moni por su fórmula, el resto del bloque')
const asignaciones = planV3.asignaciones as unknown as Asignacion[]
const bloqueLargo = {
  ...BLOQUE,
  dedicacion_por_mes: {
    ...BLOQUE.dedicacion_por_mes,
    susi: { '2026-09': { meta4_soporte: 1 }, '2026-10': { meta4_soporte: 1 }, '2026-11': { meta4_soporte: 1 } },
    moni: { '2026-09': { axton_soporte: 1 }, '2026-10': { axton_soporte: 1 }, '2026-11': { axton_soporte: 1 } },
  },
  transicion_susana: { desde: '2026-10', toma_meta4_de: ['leo', 'lucas'] },
}
// En el v3: TIM sale oct, DLA nov, POF sep, Finadiet oct. Base 11 tickets/mes.
const configTickets: Config = {
  ...configV3,
  equipo_confidencial: bloqueLargo,
  soporte_tickets: { meses_medidos: 10, meta4_por_cuenta: { tim: 50, dla: 30, POF: 20, Finadiet: 10 }, axton_hoy: { X: 100 } },
  capacidad: { ...configV3.capacidad!, susi_soporte_meta4: { desde: '2026-10', base_tickets_mes: 11 } },
}
const reparto = filasReparto(configTickets, personas)
const susiR = reparto.find(f => f.personaId === 'susi')!
const moniR = reparto.find(f => f.personaId === 'moni')!
const leoR = reparto.find(f => f.personaId === 'leo')!
eq('Susi está marcada como calculada', susiR.calculada, true)
eq('Susi sep (antes de la transición): 30 % soporte, 70 % migración (perilla por año)', `${susiR.meses[0].frentes.meta4_soporte?.toFixed(2)}/${susiR.meses[0].frentes.migracion?.toFixed(2)}`, '0.30/0.70')
check('Susi oct: queda DLA (3 tk/mes de 11) → 27 % soporte, 73 % migración', Math.abs((susiR.meses[1].frentes.migracion ?? 0) - (1 - 3 / 11)) < 0.005)
eq('Susi nov: sin tickets en Meta 4, todo migración', susiR.meses[2].frentes.migracion, 1)
eq('Susi ya no tiene [FALTA] en las celdas calculadas', susiR.meses.some(m => m.conFaltas), false)
eq('Moni está marcada como calculada', moniR.calculada, true)
check('Moni: soporte Axton + migración suman 1', moniR.meses.every(m => Math.abs((m.frentes.axton_soporte ?? 0) + (m.frentes.migracion ?? 0) - 1) < 0.001))
check('Moni sep con 11 cuentas en Axton: 0,8 − 0,02 × 1 = 0,78 para migración', Math.abs((moniR.meses[0].frentes.migracion ?? 0) - 0.78) < 0.001)
eq('Leo no se calcula: muestra lo del bloque', `${leoR.calculada ?? false}/${leoR.meses[0].frentes.meta4_soporte}`, 'false/0.7')
eq('Leo nov (sin entrada en el bloque) sigue vacío', leoR.meses[2].vacio, true)
eq('sin ticketera, Susi muestra el bloque tal cual', filasReparto({ ...configTickets, soporte_tickets: undefined }, personas).find(f => f.personaId === 'susi')!.calculada ?? false, false)

titulo('Qué libera Meta 4 y qué carga Axton, mes a mes')
const sop = soporteMesAMes(configTickets, personas, asignaciones)
eq('un renglón por mes del programa', sop.length, 8)
eq('sep: 9 tickets/mes en Meta 4 con 14 cuentas', `${sop[0].ticketsMeta4}/${sop[0].cuentasMeta4}`, '9/14')
eq('sep: 12 tickets/mes en Axton con 11 cuentas', `${sop[0].ticketsAxton}/${sop[0].cuentasAxton}`, '12/11')
check('oct: Susi 1 − 3/11', Math.abs(sop[1].dispSusi - (1 - 3 / 11)) < 0.005)
check('la disponibilidad de Moni baja mes a mes', sop.every((s, i) => i === 0 || s.dispMoni <= sop[i - 1].dispMoni))
eq('sin ticketera los tickets son null, no cero', soporteMesAMes(configV3, personas, asignaciones)[0].ticketsMeta4, null)

titulo('Lectura de la transición con la ticketera')
const lecturaTk = lecturaTransicion(configTickets, personas)!
check('dice que los tickets de hoy son su día completo y cuánto le queda en octubre', lecturaTk.texto.includes('~11 tickets por mes de hoy') && lecturaTk.texto.includes('en octubre de 2026 le queda 73 %'), lecturaTk.texto)
check('y cuándo llega al 100 %', lecturaTk.texto.includes('llega al 100 % en noviembre de 2026'), lecturaTk.texto)
check('sin ticketera, el texto es el de siempre', !lecturaTransicion(configCon, personas)!.texto.includes('tickets'))

titulo('Export — el bloque sale solo con la sesión desbloqueada')
const { useSimuladorStore } = await import('../src/store')
useSimuladorStore.getState().importarJSON(JSON.stringify({ ...planV3, config: configCon }))
check('el plan importado tiene el bloque en memoria', tieneBloqueConfidencial(useSimuladorStore.getState().config))
bloquear()
eq('bloqueado: el export avisa que lo omite', useSimuladorStore.getState().exportOmiteConfidencial(), true)
const exportBloqueado = JSON.parse(useSimuladorStore.getState().exportarJSON()) as { config: Record<string, unknown>; asignaciones: unknown[] }
eq('bloqueado: el export NO trae equipo_confidencial', 'equipo_confidencial' in exportBloqueado.config, false)
eq('y el resto del plan va completo', exportBloqueado.asignaciones.length, planV3.asignaciones.length)
check('el resto del config va intacto', 'salidas_en_vivo_propuestas' in exportBloqueado.config && 'capacidad' in exportBloqueado.config)
desbloquear()
eq('desbloqueado: no avisa', useSimuladorStore.getState().exportOmiteConfidencial(), false)
const exportAbierto = JSON.parse(useSimuladorStore.getState().exportarJSON()) as { config: Record<string, unknown> }
eq('desbloqueado: el export SÍ trae el bloque', 'equipo_confidencial' in exportAbierto.config, true)
bloquear()
useSimuladorStore.getState().importarJSON(JSON.stringify(planV3))
eq('un plan sin bloque no lo hereda del seed ni de la memoria', tieneBloqueConfidencial(useSimuladorStore.getState().config), false)
eq('y sin bloque el export no avisa nada', useSimuladorStore.getState().exportOmiteConfidencial(), false)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
