/**
 * Tests de la lógica de la pestaña Equipo (src/insightsEquipo.ts) sobre el plan v3
 * corregido. Los totales por persona tienen que coincidir con `cargaMensual`, que es la
 * única fuente de la matemática de horas. La matriz por analista cruza la Matrix de
 * clientes con el mes de salida de cada cuenta.
 */

import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { cargaMensual } from '../src/capacidad'
import {
  cargaEquipo, fraseDelMes, lecturaTickets, matrizAnalistas, mesesDelPrograma, tierDe,
} from '../src/insightsEquipo'
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

titulo('mesesDelPrograma — de la primera fase al último mes de salida')
const meses = mesesDelPrograma(asignaciones, config)
eq('arranca en septiembre 2026', meses[0], '2026-09')
eq('termina en abril 2027 (salida de Carrier)', meses[meses.length - 1], '2027-04')
eq('son 8 meses', meses.length, 8)

titulo('cargaEquipo — B1: coincide con cargaMensual')
const carga = cargaEquipo(personas, asignaciones, config)
eq('solo las personas con fases: Willy, Moni, Gaby', carga.map(c => c.id).sort().join(','), 'gaby_f,guille,moni')
const cm = cargaMensual(personas, asignaciones, config)
for (const c of carga) {
  const total = cm.filter(x => x.personaId === c.id).reduce((s, x) => s + x.horas, 0)
  eq(`total de ${c.alias} = suma de cargaMensual`, c.total, Math.round(total))
  eq(`${c.alias} tiene una fila por mes del programa`, c.meses.length, meses.length)
}
const willy = carga.find(c => c.id === 'guille')!
eq('el pico de Willy es enero 2027', willy.pico?.mes, '2027-01')
eq('y está en rojo', willy.pico?.estado, 'rojo')
eq('Willy tiene 7 h por día', willy.horasDia, 7)
eq('Gaby tiene 4 h por día', carga.find(c => c.id === 'gaby_f')!.horasDia, 4)
check('el ámbar arranca en el 85 % de uso', carga.every(c => c.meses.every(m => m.estado !== 'ambar' || (m.uso >= 0.85 && m.uso <= 1))))
check('la lista viene ordenada por total', carga.every((c, i) => i === 0 || carga[i - 1].total >= c.total))

titulo('fraseDelMes — B2: el solapamiento explicado')
const enero = willy.meses.find(m => m.mes === '2027-01')!
const frase = fraseDelMes('Willy', enero, asignaciones, proyectos)
check('nombra las cuentas del mes', frase.includes('Copetro') && frase.includes('Campari'), frase)
check('dice que se pasa de la capacidad', frase.includes('se pasa de su capacidad'), frase)
check('trae horas contra capacidad', /\d+ h de 84/.test(frase), frase)
const dic = willy.meses.find(m => m.mes === '2026-12')!
const fraseDic = fraseDelMes('Willy', dic, asignaciones, proyectos)
check('diciembre: configura Copetro y Campari a la vez', fraseDic.includes('configura') && fraseDic.includes('a la vez'), fraseDic)
check('un mes vacío da cadena vacía', fraseDelMes('X', { ...enero, porCuenta: {}, horas: 0 }, asignaciones, proyectos) === '')
check('ninguna frase muestra un id', carga.every(c => c.meses.every(m => !/-(config|pruebas|repaso|corrida)/.test(fraseDelMes(c.alias, m, asignaciones, proyectos)))))

titulo('tierDe')
eq('GSMA es chica', tierDe('gsma', config), 'chica')
eq('TIM es estándar', tierDe('tim', config), 'std')
eq('una cuenta desconocida no tiene tier', tierDe('nadie', config), null)

titulo('matrizAnalistas — B3: cómo liquida cada analista, mes a mes')
// En el v3: TIM sale oct, Piano y DLA nov, GSMA y Bonafide dic, Copetro y Campari ene,
// Lowsedo y Marval feb, Sportline/Aysa/Ford mar, Carrier abr; POF sep y Finadiet oct.
const m = matrizAnalistas(proyectos, asignaciones, config)!
check('con la Matrix cargada hay matriz', m !== null)
eq('los meses son los del programa', m.meses.join(','), meses.join(','))
const fila = (a: string) => m.filas.find(f => f.analista === a)!
eq('Araceli: Piano sale en nov y Marval en feb → 3 meses en dos sistemas (nov, dic, ene)', fila('Araceli').mesesDobles, 3)
eq('Agustina R.: TIM oct y DLA nov con 2 cuentas Axton → 2 meses (sep, oct)', fila('Agustina R.').mesesDobles, 2)
eq('Sergio: 5 en Meta 4, salen dic/ene/feb → 2 meses (dic, ene)', fila('Sergio').mesesDobles, 2)
eq('Candela: POF sep con Finadiet todavía en Meta 4 → 1 mes', fila('Candela').mesesDobles, 1)
eq('Melina: solo Carrier, nunca en dos sistemas', fila('Melina').mesesDobles, 0)
eq('Team TASA: Toyota y TPA no migran, siguen en Meta 4 sin mes doble', fila('Team TASA').mesesDobles, 0)
check('las filas vienen ordenadas por meses en dos sistemas', m.filas.every((f, i) => i === 0 || m.filas[i - 1].mesesDobles >= f.mesesDobles))
eq('Sergio en diciembre: 3 en Meta 4 y 2 en Axton', `${fila('Sergio').meses[3].meta4.length}/${fila('Sergio').meses[3].axton.length}`, '3/2')
check('la celda dice qué cuentas', fila('Sergio').meses[3].axton.sort().join(',') === 'Bonafide,GSMA')
eq('Agustina R. en noviembre ya liquida todo en Axton', fila('Agustina R.').meses[2].meta4.length, 0)
eq('Team TASA en abril sigue con 2 en Meta 4', fila('Team TASA').meses[7].meta4.length, 2)
check('Celeste y Micaela son 100 % Axton', m.soloAxton.map(f => f.analista).includes('Celeste') && m.soloAxton.map(f => f.analista).includes('Micaela'))
eq('Aysa y Ford migran pero no tienen fila en la Matrix', m.sinAnalista.join(','), 'Aysa,Ford')
eq('totales sep: 11 en Axton (9 legacy + Coty + POF)', m.totales[0].axton, 11)
eq('totales sep: 14 en Meta 4', m.totales[0].meta4, 14)
eq('totales abr: 25 en Axton y 0 en Meta 4', `${m.totales[7].axton}/${m.totales[7].meta4}`, '25/0')
eq('sin ticketera, los tickets quedan en null', m.totales[0].ticketsAxton, null)
eq('en septiembre sale POF', m.totales[0].salen.join(','), 'POF')
eq('en octubre salen TIM y Finadiet', m.totales[1].salen.sort().join(','), 'Finadiet,TIM')

titulo('matrizAnalistas — analista_destino es quien la lleva hoy')
const conDestino: Config = { ...config, insumos: { ...config.insumos, equipo_payroll_hoy: { filas: [
  { cliente: 'TIM', analista: 'Vieja', sistema: 'Meta4', analista_destino: 'Nueva' },
  { cliente: 'DLA', analista: 'Vieja', sistema: 'Meta4' },
  { cliente: 'Geopagos', analista: 'Nueva', sistema: 'Axton' },
] } } }
const md = matrizAnalistas(proyectos, asignaciones, conDestino)!
eq('TIM aparece en la fila de la nueva analista', md.filas.find(f => f.analista === 'Nueva')!.meses[0].meta4.join(','), 'TIM')
eq('y la vieja se queda solo con DLA', md.filas.find(f => f.analista === 'Vieja')!.meses[0].meta4.join(','), 'DLA')
eq('la nueva queda en dos sistemas en sep (TIM en Meta 4, Geopagos en Axton)', md.filas.find(f => f.analista === 'Nueva')!.mesesDobles, 1)
check('las cuentas que no están en esa Matrix quedan sin analista', md.sinAnalista.length === 13 && md.sinAnalista.includes('Piano'))
eq('sin Matrix no hay matriz', matrizAnalistas(proyectos, asignaciones, { ...config, insumos: { ...config.insumos, equipo_payroll_hoy: { filas: '[FALTA]' } } }), null)

titulo('matrizAnalistas — lo que liquida otro equipo de H&A no es carga de payroll')
const conExterno: Config = { ...config, insumos: { ...config.insumos, equipo_payroll_hoy: { filas: [
  ...(config.insumos!.equipo_payroll_hoy!.filas as Array<Record<string, unknown>>),
  { cliente: 'Aysa', analista: 'Eventuales', sistema: 'Meta4', equipo_externo: 'Eventuales' },
  { cliente: 'Ford', analista: 'Eventuales', sistema: 'Meta4', equipo_externo: 'Eventuales' },
] } } } as Config
const me = matrizAnalistas(proyectos, asignaciones, conExterno)!
eq('Aysa y Ford salen listadas con su equipo', me.otrosEquipos.map(o => `${o.cuenta}/${o.equipo}`).join(','), 'Aysa/Eventuales,Ford/Eventuales')
eq('y ya no figuran como [FALTA: analista]', me.sinAnalista.length, 0)
check('no arman fila de analista', !me.filas.some(f => f.analista === 'Eventuales') && !me.soloAxton.some(f => f.analista === 'Eventuales'))
eq('el resto de las filas queda igual', me.filas.length, m.filas.length)
eq('sin filas externas, la lista viene vacía', m.otrosEquipos.length, 0)
check('el nombre matchea sin acentos ni mayúsculas', (() => {
  const c: Config = { ...config, insumos: { ...config.insumos, equipo_payroll_hoy: { filas: [{ cliente: 'plastic omnium florida', analista: 'A', sistema: 'Meta 4' }] } } }
  const x = matrizAnalistas(proyectos, asignaciones, c)!
  const f = [...x.filas, ...x.soloAxton][0]
  return f.meses[0].axton.join(',') === 'POF' && !x.sinAnalista.includes('POF')
})())

titulo('lecturaTickets — insumo')
const filas = config.insumos!.tickets_meta4_ytd!.filas
eq('12 clientes en la tabla de tickets', filas.length, 12)
eq('lectura: Marval concentra, Copetro críticas', lecturaTickets(filas),
  'Marval concentra escalados y retrabajo; Copetro tiene la tasa de críticas más alta (78 %).')
eq('sin filas, sin lectura', lecturaTickets([]), '')

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
