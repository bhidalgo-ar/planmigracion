/**
 * Tests del modelo de soporte por tickets (src/capacidad.ts): qué tickets siguen en Meta 4 y
 * cuántos atiende Axton mes a mes, y la disponibilidad de Susi que sale de eso. Los números
 * del bloque son de ejemplo (redondos), sobre el plan v3 del repo.
 */

import type { Config, Persona } from '../src/types'
import { cuentasEnMeta4, disponibilidadMes, ticketsAxton, ticketsMeta4Restantes } from '../src/capacidad'
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
function cerca(nombre: string, actual: number | null, esperado: number) {
  check(nombre, actual !== null && Math.abs(actual - esperado) < 0.005, `esperado ${esperado}, obtenido ${String(actual)}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

const personas = planV3.personas as unknown as Persona[]
const configV3 = planV3.config as unknown as Config
const susi = personas.find(p => p.id === 'susi')

// En el v3: TIM sale 2026-10, DLA 2026-11, POF 2026-09 y Finadiet 2026-10 (fuera del plan).
const conTickets: Config = {
  ...configV3,
  soporte_tickets: {
    meses_medidos: 10,
    meta4_por_cuenta: { tim: 50, dla: 30, POF: 20, Finadiet: 10 },
    axton_hoy: { 'Cuenta X': 100 },
  },
  capacidad: { ...configV3.capacidad!, susi_soporte_meta4: { desde: '2026-10', base_tickets_mes: 11 } },
}

titulo('Sin ticketera en el plan: nadie estima')
eq('ticketsMeta4Restantes devuelve null', ticketsMeta4Restantes('2026-09', configV3), null)
eq('ticketsAxton devuelve null', ticketsAxton('2026-09', configV3), null)
eq('Susi sigue con la perilla por año (0,7 en 2026)', disponibilidadMes('susi', '2026-10', configV3, undefined, susi), 0.7)
eq('y 0,9 en 2027', disponibilidadMes('susi', '2027-03', configV3, undefined, susi), 0.9)

titulo('Cuentas que siguen en Meta 4 al cierre de cada mes')
eq('sep 2026: las 13 del plan + Finadiet (POF ya salió)', cuentasEnMeta4('2026-09', configV3).length, 14)
eq('oct 2026: salen TIM y Finadiet → 12', cuentasEnMeta4('2026-10', configV3).length, 12)
eq('abr 2027: ninguna', cuentasEnMeta4('2027-04', configV3).length, 0)
check('la clave de las fuera del plan es el alias', cuentasEnMeta4('2026-09', configV3).some(c => c.clave === 'Finadiet'))

titulo('Tickets por mes que siguen en Meta 4')
cerca('sep: TIM + DLA + Finadiet = 90 / 10 meses', ticketsMeta4Restantes('2026-09', conTickets), 9)
cerca('oct: solo DLA = 30 / 10', ticketsMeta4Restantes('2026-10', conTickets), 3)
cerca('nov: nada', ticketsMeta4Restantes('2026-11', conTickets), 0)
check('una cuenta sin fila en la ticketera cuenta 0, no rompe', ticketsMeta4Restantes('2026-09', conTickets) !== null)

titulo('Tickets por mes que atiende Axton')
cerca('sep: los de hoy + POF = 120 / 10', ticketsAxton('2026-09', conTickets), 12)
cerca('oct: + TIM y Finadiet = 180 / 10', ticketsAxton('2026-10', conTickets), 18)
cerca('nov: + DLA = 210 / 10', ticketsAxton('2026-11', conTickets), 21)
cerca('con meses_medidos inválidos no se divide por cero', ticketsAxton('2026-11', { ...conTickets, soporte_tickets: { ...conTickets.soporte_tickets!, meses_medidos: 0 } }) ?? -1, -1)

titulo('Disponibilidad de Susi por tickets')
eq('antes de la transición: perilla por año', disponibilidadMes('susi', '2026-09', conTickets, undefined, susi), 0.7)
cerca('oct: 1 − 3 / 11', disponibilidadMes('susi', '2026-10', conTickets, undefined, susi), 1 - 3 / 11)
eq('nov: sin tickets en Meta 4, día completo para migración', disponibilidadMes('susi', '2026-11', conTickets, undefined, susi), 1)
check('nunca baja de 0 aunque queden más tickets que la base', disponibilidadMes('susi', '2026-10', { ...conTickets, capacidad: { ...conTickets.capacidad!, susi_soporte_meta4: { desde: '2026-10', base_tickets_mes: 1 } } }, undefined, susi) === 0)
eq('el bloque confidencial con `migracion` explícito sigue mandando', disponibilidadMes('susi', '2026-10', { ...conTickets, equipo_confidencial: { dedicacion_por_mes: { susi: { '2026-10': { migracion: 0.42 } } } } }, undefined, susi), 0.42)
eq('otra persona no se ve afectada por el bloque de Susi', disponibilidadMes('guille', '2026-10', conTickets), 0.6)
eq('con persona_id distinto, aplica a esa persona', disponibilidadMes('lau', '2026-10', { ...conTickets, capacidad: { ...conTickets.capacidad!, susi_soporte_meta4: { desde: '2026-10', base_tickets_mes: 11, persona_id: 'lau' } } }), 1 - 3 / 11)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
