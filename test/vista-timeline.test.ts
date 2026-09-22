/**
 * Tests de la geometría de la vista del timeline (spec 2026-09-22, §3 y §5): el rango del eje
 * de tiempo y la banda de carga semanal.
 *
 * Los dos bugs que motivaron la spec tienen su chequeo acá:
 *  - la banda pintaba por ORDEN DE APILADO, no por % de capacidad, así que una semana al 40 %
 *    y una al 100 % se veían idénticas;
 *  - la altura se clampeaba a 1,6 × el alto de caja, con lo cual una barra podía dibujar
 *    15 px fuera de su fila y pisar la de al lado, y 160 % se veía igual que 300 %.
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

import {
  altoDeBarra, estadoDeCarga, rangoDelEje, BANDA_ROW, BANDA_ETQ, BANDA_BAR_H,
} from '../src/vistaTimeline'
import { UMBRAL_AMBAR } from '../src/capacidad'
import { toISO } from '../src/utils/dates'
import planV3 from './fixtures/plan-v3.json'
import configSeed from '../data/config.json'

let fallos = 0
let corridos = 0
function eq(nombre: string, real: unknown, esperado: unknown) {
  corridos++
  const ok = real === esperado
  if (!ok) fallos++
  console.log(`${ok ? '  ok' : 'FALLA'}  ${nombre}${ok ? '' : ` — esperado ${String(esperado)}, dio ${String(real)}`}`)
}
function ok(nombre: string, cond: boolean, detalle = '') {
  corridos++
  if (!cond) fallos++
  console.log(`${cond ? '  ok' : 'FALLA'}  ${nombre}${cond ? '' : ` — ${detalle}`}`)
}

console.log('\n— Rango del eje de tiempo —')

const asigV3 = (planV3 as { asignaciones: { inicio: string; fin: string }[] }).asignaciones
const horizV3 = (planV3 as { config: { horizonte: { desde: string; hasta: string } } }).config.horizonte

// El plan v3 declara jun 2026 → oct 2027 y sus barras van del 14/09/2026 al 12/04/2027.
const ejeV3 = rangoDelEje(asigV3, horizV3, new Date(2026, 8, 22))
eq('el eje arranca en el mes de la primera barra, no en el horizonte declarado', toISO(ejeV3.desde), '2026-09-01')
eq('el eje termina un mes después de la última barra', toISO(ejeV3.hasta), '2027-05-31')
ok('el eje declarado era más largo que el que se dibuja ahora',
  horizV3.desde < toISO(ejeV3.desde) && horizV3.hasta > toISO(ejeV3.hasta),
  `${horizV3.desde}→${horizV3.hasta} contra ${toISO(ejeV3.desde)}→${toISO(ejeV3.hasta)}`)

// Los meses vacíos DEL MEDIO no se tocan: el eje sigue siendo lineal entre las dos puntas.
const conHueco = rangoDelEje(
  [{ inicio: '2026-10-05', fin: '2026-10-09' }, { inicio: '2027-02-01', fin: '2027-02-05' }],
  horizV3, new Date(2026, 9, 1),
)
eq('un plan con un hueco de tres meses conserva las dos puntas (desde)', toISO(conHueco.desde), '2026-10-01')
eq('un plan con un hueco de tres meses conserva las dos puntas (hasta)', toISO(conHueco.hasta), '2027-03-31')

const sinBarras = rangoDelEje([], horizV3, new Date(2026, 8, 22))
eq('sin asignaciones vale el horizonte del plan (desde)', toISO(sinBarras.desde), horizV3.desde)
eq('sin asignaciones vale el horizonte del plan (hasta)', toISO(sinBarras.hasta), horizV3.hasta)

// Hoy siempre entra: si no, la línea de hoy y el botón 📍 apuntarían fuera de pantalla.
const hoyDespues = rangoDelEje([{ inicio: '2026-09-01', fin: '2026-09-30' }], horizV3, new Date(2027, 7, 15))
ok('hoy siempre queda dentro del eje aunque el plan haya terminado antes',
  toISO(hoyDespues.hasta) >= '2027-08-15', toISO(hoyDespues.hasta))

// La cabeza nunca se va antes del horizonte declarado, que es de donde salen los feriados.
const antesDelHorizonte = rangoDelEje([{ inicio: '2026-01-15', fin: '2026-02-10' }], horizV3, new Date(2026, 5, 2))
eq('la cabeza no se va antes del horizonte declarado', toISO(antesDelHorizonte.desde), horizV3.desde)

console.log('\n— Banda de carga: color por % de capacidad —')

// El bug: los tramos se pintaban por orden de apilado (--t1/--t2/--t3), así que el color no
// decía nada de la carga. Ahora dos usos distintos dan colores distintos.
eq('media jornada de uso es verde', estadoDeCarga(20, 40), 'ok')
eq('justo en el umbral de aviso es ámbar', estadoDeCarga(40 * UMBRAL_AMBAR, 40), 'ambar')
eq('al borde de la capacidad es ámbar, no rojo', estadoDeCarga(40, 40), 'ambar')
eq('pasarse de capacidad es rojo', estadoDeCarga(44, 40), 'rojo')
ok('una semana al 40 % y una al 100 % ya no se ven igual',
  estadoDeCarga(16, 40) !== estadoDeCarga(40, 40))
// Vacaciones: capacidad 0 no es 0 % de uso, es una semana sin nada contra qué medir.
eq('capacidad 0 con horas planificadas se dibuja distinto', estadoDeCarga(8, 0), 'sin_capacidad')
eq('capacidad 0 sin horas no alarma', estadoDeCarga(0, 0), 'ok')

console.log('\n— Banda de carga: ninguna barra pisa la fila de al lado —')

eq('la etiqueta y la barra entran en el alto de fila', BANDA_ETQ + BANDA_BAR_H <= BANDA_ROW, true)

// El clamp viejo era 1,6 × el alto de caja: a 160 % la barra medía 41 px dentro de una caja
// de 26 y se metía en la fila de arriba.
for (const [horas, cap] of [[10, 40], [40, 40], [64, 40], [120, 40], [8, 0]] as const) {
  const { alto } = altoDeBarra(horas, cap)
  ok(`${horas} h sobre ${cap} h no dibuja más alto que su caja`, alto <= BANDA_BAR_H + 1e-9, `${alto} px de ${BANDA_BAR_H}`)
}

const a100 = altoDeBarra(40, 40)
const a160 = altoDeBarra(64, 40)
const a300 = altoDeBarra(120, 40)
eq('al 100 % la barra llega justo al techo', Math.round(a100.alto), BANDA_BAR_H)
eq('al 160 % no sobresale: lo dice el tope', a160.alto, BANDA_BAR_H)
eq('el 160 % queda marcado como excedido', a160.excedida, true)
eq('el 300 % también', a300.excedida, true)
eq('al 100 % clavado todavía no está excedida', a100.excedida, false)
eq('media carga mide la mitad', altoDeBarra(20, 40).alto, BANDA_BAR_H / 2)
eq('sin horas no dibuja nada', altoDeBarra(0, 40).alto, 0)

console.log('\n— Perillas del seed (22/09/2026) —')

// Dos valores que Willy fijó a mano y que no se mueven sin que él lo pida. El blackout
// cubre diciembre entero: hasta el 22/09/2026 iba del 21/12 al 08/01 y dejaba hábil la
// primera quincena, que es donde caían tres configuraciones del plan v3.
const seed = configSeed as unknown as {
  tiers_v3?: { blackout_config?: [string, string] }
  disponibilidad?: { por_persona_ano: Record<string, Record<string, number>> }
}
eq('el blackout del seed arranca el 1/12', seed.tiers_v3?.blackout_config?.[0], '2026-12-01')
eq('y termina el 31/12', seed.tiers_v3?.blackout_config?.[1], '2026-12-31')
eq('Willy al 80 % en 2026', seed.disponibilidad?.por_persona_ano.guille?.['2026'], 0.8)
eq('Willy al 80 % en 2027', seed.disponibilidad?.por_persona_ano.guille?.['2027'], 0.8)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
