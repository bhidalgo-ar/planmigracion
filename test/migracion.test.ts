/**
 * Tests de la lectura de avance de la migración (src/insightsMigracion.ts), que alimenta
 * la vista Insights. Se corren con `npm test` junto con los de duraciones.
 */

import type { Asignacion, Persona, Proyecto } from '../src/types'
import {
  cargaPorPersona, cuentasMigracion, estadoA, migracionPorTrimestre, resumenMigracion,
} from '../src/insightsMigracion'
import planFixture from './fixtures/plan-con-disponibilidad.json'

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

const proyectos = planFixture.proyectos as unknown as Proyecto[]
const asignaciones = planFixture.asignaciones as unknown as Asignacion[]
const personas = planFixture.personas as unknown as Persona[]

const cuentas = cuentasMigracion(proyectos, asignaciones)

// ── cuentasMigracion ──────────────────────────────────────────────────────────
titulo('cuentasMigracion — fecha de salida a Axton por cuenta')
eq('devuelve una entrada por cuenta', cuentas.length, 17)

const coty = cuentas.find(c => c.id === 'coty')!
eq('coty arranca con su relevamiento', coty.inicio, '2026-06-08')
eq('coty sale en vivo al terminar su última fase', coty.enVivo, '2026-08-06')
eq('coty tiene sus 3 fases', coty.fases.length, 3)
check('las fases quedan ordenadas por inicio',
  coty.fases.every((f, i) => i === 0 || coty.fases[i - 1].inicio <= f.inicio))

// El bloqueo de supervisión de TASA no es una fase: no debe contar ni mover el go-live.
const tasa = cuentas.find(c => c.id === 'tasa')!
check('el bloqueo de TASA no entra como fase',
  tasa.fases.every(f => f.id !== 'tasa-config'), `fases: ${tasa.fases.map(f => f.id).join(', ')}`)
eq('TASA sale en vivo al fin de sus pruebas', tasa.enVivo, '2027-05-27')
check('TASA queda marcada como especial', tasa.especial)

// ── estadoA ───────────────────────────────────────────────────────────────────
titulo('estadoA — los tres estados de una cuenta')
eq('antes de arrancar está en Meta 4 sin empezar', estadoA(coty, '2026-06-01'), 'sin_empezar')
eq('el día que arranca ya está en migración', estadoA(coty, '2026-06-08'), 'en_migracion')
eq('un día antes del go-live sigue en migración', estadoA(coty, '2026-08-05'), 'en_migracion')
eq('el día del go-live ya está en vivo', estadoA(coty, '2026-08-06'), 'en_vivo')
eq('una cuenta sin plan nunca sale de Meta 4',
  estadoA({ id: 'x', nombre: 'X', especial: false, inicio: null, enVivo: null, fases: [] }, '2030-01-01'),
  'sin_empezar')

// ── migracionPorTrimestre ─────────────────────────────────────────────────────
titulo('migracionPorTrimestre — foto al cierre de cada trimestre')
const trimestres = migracionPorTrimestre(cuentas)
check('cubre varios trimestres', trimestres.length >= 5, `${trimestres.length} trimestres`)
eq('arranca en el trimestre del primer día de trabajo', trimestres[0].label, 'T2 26')
eq('termina en el trimestre del último go-live', trimestres[trimestres.length - 1].label, 'T3 27')

check('los tres estados suman siempre el total de cuentas',
  trimestres.every(t => t.sinEmpezar + t.enMigracion + t.enVivo === cuentas.length),
  trimestres.map(t => t.sinEmpezar + t.enMigracion + t.enVivo).join('/'))

check('el acumulado en vivo nunca baja',
  trimestres.every((t, i) => i === 0 || trimestres[i - 1].enVivo <= t.enVivo),
  trimestres.map(t => t.enVivo).join(' → '))

eq('al final del último trimestre están todas en vivo',
  trimestres[trimestres.length - 1].enVivo, cuentas.length)
eq('las salidas por trimestre suman todas las cuentas',
  trimestres.reduce((s, t) => s + t.salidas.length, 0), cuentas.length)
eq('en el primer trimestre todavía no salió ninguna', trimestres[0].enVivo, 0)

// ── cargaPorPersona ───────────────────────────────────────────────────────────
titulo('cargaPorPersona — cuántas cuentas hace cada uno')
const carga = cargaPorPersona(personas, cuentas)
const de = (id: string) => carga.find(c => c.id === id)!

eq('gaby releva 9 cuentas', de('gaby_f').cuentas, 9)
eq('y sus 9 fases son todas relevamiento', de('gaby_f').porTipo.Relevamiento, 9)
eq('gaby no configura nada', de('gaby_f').porTipo.Configuracion, 0)

eq('moni toca 8 cuentas', de('moni').cuentas, 8)
eq('con 16 fases en total', de('moni').fases, 16)
eq('8 configuraciones', de('moni').porTipo.Configuracion, 8)
eq('y 8 pruebas', de('moni').porTipo.Pruebas, 8)

// Lau tiene 3 asignaciones en TASA, pero una es el bloqueo de supervisión.
eq('lau queda con 1 cuenta', de('lau').cuentas, 1)
eq('y 2 fases: el bloqueo no cuenta', de('lau').fases, 2)

eq('axton configura 1 cuenta', de('axton').cuentas, 1)
check('la lista viene ordenada por cantidad de cuentas',
  carga.every((c, i) => i === 0 || carga[i - 1].cuentas >= c.cuentas),
  carga.map(c => `${c.id}:${c.cuentas}`).join(' '))
eq('la suma de fases de todos es el total de fases del plan',
  carga.reduce((s, c) => s + c.fases, 0),
  asignaciones.filter(a => !a.es_bloqueo).length)

// ── resumenMigracion ──────────────────────────────────────────────────────────
titulo('resumenMigracion — cabecera de la vista')
const r = resumenMigracion(cuentas, '2026-08-03')
eq('total de cuentas', r.totalCuentas, 17)
eq('todas planificadas', r.sinPlanificar, 0)
eq('el plan arranca con coty', r.inicioPrograma, '2026-06-08')
eq('la primera salida es la de coty', r.primeraSalida, '2026-08-06')
eq('la última salida cierra el programa', r.ultimaSalida, '2027-07-19')
eq('y la cuenta que cierra es Aysa', r.cuentaCierre, 'Aysa')
eq('al 3/8/2026 todavía no salió ninguna', r.enVivoHoy, 0)
check('y hay trabajo en curso ese día', r.enMigracionHoy > 0, `${r.enMigracionHoy} en migración`)
eq('duración del programa en meses', r.mesesPrograma, 13)

// Un plan vacío no debe romper nada ni inventar fechas.
titulo('Casos borde')
const vacias = cuentasMigracion(proyectos, [])
eq('sin asignaciones, ninguna cuenta tiene salida', vacias.filter(c => c.enVivo).length, 0)
eq('y no hay trimestres que mostrar', migracionPorTrimestre(vacias).length, 0)
const rVacio = resumenMigracion(vacias, '2026-08-03')
eq('el resumen reporta todas sin planificar', rVacio.sinPlanificar, 17)
eq('sin fecha de cierre inventada', rVacio.ultimaSalida, null)

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
