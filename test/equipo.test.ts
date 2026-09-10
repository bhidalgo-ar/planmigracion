/**
 * Tests de la lógica de la pestaña Equipo (src/insightsEquipo.ts) sobre el plan v3
 * corregido. Los totales por persona tienen que coincidir con `cargaMensual`, que es la
 * única fuente de la matemática de horas.
 */

import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { cargaMensual } from '../src/capacidad'
import {
  cargaEquipo, cuentasEquipo, equipoHoy, franjaSalidas, fraseDelMes, lecturaTickets, mesesDelPrograma, tierDe,
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

titulo('cuentasEquipo — B3: quién hace qué')
const cuentas = cuentasEquipo(proyectos, asignaciones, config)
eq('13 cuentas con fases', cuentas.length, 13)
eq('la primera en salir es TIM', cuentas[0].id, 'tim')
eq('la última es Carrier', cuentas[cuentas.length - 1].id, 'carrier')
eq('TIM es estándar', cuentas[0].tier, 'std')
eq('GSMA es chica', tierDe('gsma', config), 'chica')
eq('TIM: corte 19/10', cuentas[0].corte, '2026-10-19')
eq('TIM: margen 6 hábiles', cuentas[0].margen, 6)
check('todas con margen ok en el v3', cuentas.every(c => c.estadoMargen === 'ok'), cuentas.map(c => `${c.id}:${c.margen}`).join(' '))
check('las personas de TIM son Gaby, Willy y Moni', cuentas[0].personas.sort().join(',') === 'gaby_f,guille,moni')
check('las fases vienen ordenadas por inicio', cuentas.every(c => c.fases.every((f, i) => i === 0 || c.fases[i - 1].inicio <= f.inicio)))

titulo('franjaSalidas — B4')
const franja = franjaSalidas(proyectos, asignaciones, config)
eq('una fila por mes del programa', franja.length, meses.length)
const sep = franja.find(f => f.mes === '2026-09')!
eq('septiembre: solo POF, fuera del simulador', `${sep.salidas.length} ${sep.salidas[0].nombre} ${sep.salidas[0].fueraDelPlan}`, '1 POF true')
const oct = franja.find(f => f.mes === '2026-10')!
eq('octubre: TIM + Finadiet = 2/2', `${oct.salidas.length}/${oct.tope}`, '2/2')
eq('octubre está ok', oct.estado, 'ok')
const mar = franja.find(f => f.mes === '2027-03')!
eq('marzo: 3 salidas permitidas', mar.estadoTope, 'permitido')
eq('marzo se pinta ámbar', mar.estado, 'ambar')
check('ningún mes en rojo con el v3', franja.every(f => f.estado !== 'rojo'))
check('las cuentas del plan traen margen y corte', oct.salidas.filter(s => !s.fueraDelPlan).every(s => s.margen != null && s.corte != null))
check('con 4 salidas el mes queda rojo', (() => {
  const c: Config = { ...config, salidas_en_vivo_propuestas: { ...config.salidas_en_vivo_propuestas, carrier: '2027-03' } }
  return franjaSalidas(proyectos, asignaciones, c).find(f => f.mes === '2027-03')!.estado === 'rojo'
})())

titulo('insumos — B5')
const filas = config.insumos!.tickets_meta4_ytd!.filas
eq('12 clientes en la tabla de tickets', filas.length, 12)
eq('lectura: Marval concentra, Copetro críticas', lecturaTickets(filas),
  'Marval concentra escalados y retrabajo; Copetro tiene la tasa de críticas más alta (78 %).')
eq('sin filas, sin lectura', lecturaTickets([]), '')
eq('equipo hoy en [FALTA] devuelve null', equipoHoy({ ...config, insumos: { ...config.insumos, equipo_payroll_hoy: { filas: '[FALTA]' } } }), null)
const hoy = equipoHoy(config)!
eq('el v3 trae 25 clientes activos del equipo (sin Bajas, sin Aysa/Ford)', hoy.filas.length, 25)
eq('15 en Meta4 y 10 en Axton', `${hoy.total.meta4}/${hoy.total.axton}/${hoy.total.otros}`, '15/10/0')
check('la distribución por analista viene ordenada por cantidad', hoy.porAnalista.every((a, i) => i === 0 || (hoy.porAnalista[i - 1].meta4 + hoy.porAnalista[i - 1].axton) >= (a.meta4 + a.axton)))
eq('Sergio lleva 5 cuentas Meta4', hoy.porAnalista.find(a => a.nombre === 'Sergio')!.meta4, 5)
eq('por equipo: Candela lleva 13', hoy.porLider.find(a => a.nombre === 'Candela')!.meta4 + hoy.porLider.find(a => a.nombre === 'Candela')!.axton, 13)
check('con filas mínimas también agrupa', (() => {
  const c: Config = { ...config, insumos: { ...config.insumos, equipo_payroll_hoy: { filas: [
    { cliente: 'A', analista: 'x', sistema: 'Axton' }, { cliente: 'B', analista: 'x', sistema: 'M4' }, { cliente: 'C', analista: 'y', sistema: 'Meta 4' },
  ] } } }
  const h = equipoHoy(c)!
  return h.porAnalista[0].nombre === 'x' && h.porAnalista[0].meta4 === 1 && h.porAnalista[0].axton === 1 && h.total.meta4 === 2
})())

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLAS`} — ${corridos} chequeos`)
process.exit(fallos === 0 ? 0 : 1)
