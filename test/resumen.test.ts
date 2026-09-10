/**
 * Tests del resumen ejecutivo animado: `derivarResumen` (los datos que alimentan el
 * video) y `guion` (los textos que se generan a partir de esos datos).
 *
 * El contrato que verifican es el que cierra el handoff de diseño: con el plan v3 y
 * hoy = 10/09/2026, el video tiene que contar 10 de 25 cuentas, cuatro trimestres,
 * ocho meses, enero 2027 como mes crítico y Carrier como última salida. Si alguno de
 * estos números cambia sin que haya cambiado el plan, algo se rompió.
 */

import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { derivarResumen, enLetras, fechaLarga, mesDeAnio } from '../src/resumen/derivarResumen'
import { armarGuion, CUES, ESCENAS, hashDeSegundo, segundoDelHash, subtituloEn, unirConY } from '../src/resumen/guion'
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

const HOY = new Date(2026, 8, 10)   // 10 de septiembre de 2026
const data = derivarResumen(personas, proyectos, asignaciones, config, HOY)

// ── conteo de cuentas ─────────────────────────────────────────────────────────
titulo('derivarResumen — cuántas cuentas hay y dónde están')
eq('la fecha de hoy entra tal cual', data.hoy, '2026-09-10')
eq('diez cuentas ya operan en Axton', data.yaEnAxton, 10)
eq('quince cuentas quedan por migrar', data.porMigrar, 15)
eq('el total es la suma', data.total, 25)
eq('hay una salida por cuenta por migrar', data.salidas.length, 15)
check('POF y Finadiet entran como salidas fuera del plan',
  data.salidas.filter(s => s.fueraDelPlan).map(s => s.nombre).join(', ') === 'POF, Finadiet')
check('ninguna cuenta especial (TASA) entra a la cuenta',
  !data.salidas.some(s => proyectos.find(p => p.id === s.id)?.especial))
check('las salidas quedan ordenadas por mes',
  data.salidas.every((s, i) => i === 0 || data.salidas[i - 1].mes <= s.mes),
  data.salidas.map(s => s.mes).join(' '))

// ── trimestres ────────────────────────────────────────────────────────────────
titulo('derivarResumen — la ola, trimestre a trimestre')
eq('son cuatro trimestres con salidas', data.trimestres.length, 4)
eq('Q3 2026 tiene una salida', data.trimestres[0].salidas.length, 1)
eq('Q4 2026 tiene seis', data.trimestres[1].salidas.length, 6)
eq('Q1 2027 tiene siete', data.trimestres[2].salidas.length, 7)
eq('Q2 2027 tiene una', data.trimestres[3].salidas.length, 1)
eq('el primer trimestre se llama Q3 2026', data.trimestres[0].label, 'Q3 2026')
eq('un trimestre de un solo mes se lee con el mes entero', data.trimestres[0].sub, 'septiembre · 1 salida')
eq('un trimestre de varios meses se lee como rango corto', data.trimestres[1].sub, 'oct – dic · 6 salidas')

// ── eje de meses ──────────────────────────────────────────────────────────────
titulo('derivarResumen — el eje de meses es continuo')
eq('van de septiembre 2026 a abril 2027', data.meses.length, 8)
eq('el primero es sep 26', data.meses[0].label, 'sep 26')
eq('el último es abr 27', data.meses[7].label, 'abr 27')
eq('las salidas repartidas por mes suman quince',
  data.meses.reduce((s, m) => s + m.salidas.length, 0), 15)
check('no hay huecos: cada mes sigue al anterior',
  data.meses.every((m, i) => i === 0 || m.key > data.meses[i - 1].key))

// ── fin del programa ──────────────────────────────────────────────────────────
titulo('derivarResumen — cuándo termina')
eq('el programa cierra en abril de 2027', data.fin.mes, '2027-04')
eq('se muestra como "abril 2027"', data.fin.label, 'abril 2027')
eq('la última cuenta en salir es Carrier', data.fin.cuenta, 'Carrier')

// ── mes crítico ───────────────────────────────────────────────────────────────
titulo('derivarResumen — el mes crítico y su gantt')
const cuello = data.cuello!
check('hay un mes crítico', !!cuello)
eq('es enero 2027', cuello.mes, '2027-01')
eq('se muestra como "Enero 2027"', cuello.label, 'Enero 2027')
eq('son cuatro cuentas al mismo tiempo', cuello.cuentas.length, 4)
eq('en el orden en que arrancan', cuello.cuentas.join(', '), 'Copetro, Campari, Marval, Lowsedo')
eq('hay una fila por cuenta', cuello.filas.length, 4)
eq('la ventana arranca un lunes', cuello.ventana.desde, '2026-12-21')
eq('y termina un domingo', cuello.ventana.hasta, '2027-02-07')
eq('el blackout de configuración cae adentro de la ventana',
  `${cuello.blackout?.desde} → ${cuello.blackout?.hasta}`, '2026-12-21 → 2027-01-08')

// Las tres pruebas de Copetro (Gaby, Moni y Willy en paralelo) son UNA barra.
const copetro = cuello.filas.find(f => f.cuenta === 'Copetro')!
eq('Copetro tiene una sola barra', copetro.barras.length, 1)
eq('esa barra es de Pruebas', copetro.barras[0].fase, 'Pruebas')
eq('va del primer inicio al último fin',
  `${copetro.barras[0].desde}..${copetro.barras[0].hasta}`, '2027-01-04..2027-01-13')

const marval = cuello.filas.find(f => f.cuenta === 'Marval')!
eq('Marval tiene sus tres fases', marval.barras.length, 3)
check('y quedan ordenadas por fecha de inicio',
  marval.barras.every((b, i) => i === 0 || marval.barras[i - 1].desde <= b.desde))

// ── alertas ───────────────────────────────────────────────────────────────────
titulo('derivarResumen — las alertas que se muestran')
eq('son dos', data.alertas.length, 2)
eq('la roja va primero', data.alertas[0].severidad, 'rojo')
eq('y habla de la carga del mes crítico',
  data.alertas[0].texto, 'Carga del equipo en enero por encima de la capacidad')
eq('la segunda es el tope de salidas de marzo',
  data.alertas[1].texto, 'Marzo 2027: tres salidas en vivo, el tope del mes')

// ── formatos de texto ─────────────────────────────────────────────────────────
titulo('helpers de texto')
eq('una fecha se lee entera', fechaLarga('2026-09-10'), '10 de septiembre de 2026')
eq('un mes dentro de una oración lleva "de"', mesDeAnio('2027-04'), 'abril de 2027')
eq('uno en femenino', enLetras(1), 'una')
eq('uno en masculino', enLetras(1, false), 'uno')
eq('cuatro', enLetras(4), 'cuatro')
eq('diez', enLetras(10), 'diez')
eq('de once para arriba va el número', enLetras(11), '11')
eq('una sola cuenta no lleva "y"', unirConY(['Copetro']), 'Copetro')
eq('dos cuentas se unen con "y"', unirConY(['Copetro', 'Campari']), 'Copetro y Campari')
eq('varias, comas y una "y" al final',
  unirConY(['Copetro', 'Campari', 'Marval', 'Lowsedo']), 'Copetro, Campari, Marval y Lowsedo')

// ── guion ─────────────────────────────────────────────────────────────────────
titulo('guion — los textos salen del plan, no del componente')
const g = armarGuion(data, true, 'v3')

eq('la apertura fecha el resumen', g.apertura.sub, 'Resumen ejecutivo · 10 de septiembre de 2026')
eq('el header nombra el plan importado', g.header.plan, 'Plan v3 · 10 de septiembre de 2026')
eq('el título de Hoy sale del total', g.hoy.tituloResto, 'de 25 cuentas ya operan en Axton')
eq('el título del cuello cuenta las cuentas en letras',
  g.cuello.titulo, 'Enero 2027: cuatro cuentas al mismo tiempo')
eq('el contador del final compara contra el total', g.fin.contadorTotal, '/ 25')
eq('la cápsula nombra el mes de cierre', g.fin.capsula, 'abril 2027')
eq('y la cuenta que cierra', g.fin.capsulaSub, 'Carrier, la última salida en vivo')
eq('el cierre resume la ola', g.cierre.linea1, '15 cuentas en 8 meses.')
eq('y dice cuándo termina', g.cierre.linea2, 'El programa cierra en abril de 2027.')

const textos = g.subtitulos.map(s => s.texto)
eq('hay siete subtítulos', textos.length, 7)
eq('el primero cuenta dónde estamos hoy',
  textos[0], 'Hoy, 10 de las 25 cuentas ya operan en Axton. Faltan 15.')
eq('el segundo cuenta en cuántos trimestres sale la ola',
  textos[1], 'Las 15 salen en vivo en cuatro trimestres.')
eq('el tercero nombra los dos trimestres más cargados, en orden cronológico',
  textos[2], 'Q4 2026 concentra seis salidas; Q1 2027, siete.')
eq('el cuarto lista las cuentas del mes crítico',
  textos[3], 'Enero 2027 es el mes crítico: Copetro, Campari, Marval y Lowsedo a la vez.')
eq('el quinto explica la alerta roja',
  textos[4], 'La carga supera la capacidad del equipo: es la alerta roja del plan.')
eq('el sexto cierra el número', textos[5], 'Con esta ola, Axton pasa de 10 a 25 cuentas.')
eq('el séptimo nombra la última salida',
  textos[6], 'La última salida en vivo es Carrier, en abril de 2027.')

const sinAlertas = armarGuion(data, false, 'actual')
eq('con las alertas apagadas el mes crítico se explica por el solapamiento',
  sinAlertas.subtitulos[4].texto,
  'Cuatro cuentas se solapan en un mes con blackout de configuración.')
eq('y el header dice "Plan actual"', sinAlertas.header.plan, 'Plan actual · 10 de septiembre de 2026')

// ── tiempos ───────────────────────────────────────────────────────────────────
titulo('guion — el reloj y las escenas')
eq('el video dura 45 segundos', CUES.total, 45)
eq('las duraciones de las escenas suman el total',
  ESCENAS.reduce((s, e) => s + e.dur, 0), CUES.total)
eq('la apertura arranca en 0', CUES.Apertura, 0)
eq('Hoy en el 4', CUES.Hoy, 4)
eq('la ola en el 10', CUES.Ola, 10)
eq('el cuello en el 24', CUES.Cuello, 24)
eq('el final en el 33', CUES.Fin, 33)
eq('el cierre en el 40', CUES.Cierre, 40)

check('en la apertura todavía no hay subtítulo', subtituloEn(g.subtitulos, 1) === null)
eq('a los 5 segundos se lee el de Hoy', subtituloEn(g.subtitulos, 5)?.texto, textos[0])
eq('a los 30 se lee el del mes crítico', subtituloEn(g.subtitulos, 30)?.texto, textos[4])
check('los subtítulos van en orden de tiempo',
  g.subtitulos.every((s, i) => i === 0 || g.subtitulos[i - 1].at < s.at))

// ── el segundo en la URL ──────────────────────────────────────────────────────
titulo('guion — clavar una escena con #t=')
eq('lee el segundo del hash', segundoDelHash('#t=31'), 31)
eq('acepta decimales', segundoDelHash('#t=31.5'), 31.5)
eq('el segundo cero es válido', segundoDelHash('#t=0'), 0)
eq('y el último segundo también', segundoDelHash('#t=45'), 45)
check('sin hash no hay segundo', segundoDelHash('') === null)
check('un hash de otra cosa se ignora', segundoDelHash('#insights') === null)
check('un segundo fuera del video se ignora', segundoDelHash('#t=99') === null)
check('un valor que no es número se ignora', segundoDelHash('#t=abc') === null)
check('un negativo se ignora', segundoDelHash('#t=-3') === null)
eq('funciona con el t= atrás de otro parámetro', segundoDelHash('#vista=resumen&t=24'), 24)
eq('arma el hash con un decimal', hashDeSegundo(31.44), '#t=31.4')
eq('y redondea el segundo decimal', hashDeSegundo(31.46), '#t=31.5')
eq('recorta lo que se pasa del final', hashDeSegundo(999), '#t=45')
eq('y lo que va antes del arranque', hashDeSegundo(-5), '#t=0')
check('lo que arma se puede volver a leer',
  segundoDelHash(hashDeSegundo(CUES.Cuello + 7)) === CUES.Cuello + 7)

// ── el video sigue al plan ────────────────────────────────────────────────────
titulo('derivarResumen — si el plan cambia, el video cambia')
const configMovido = {
  ...config,
  salidas_en_vivo_propuestas: { ...config.salidas_en_vivo_propuestas, carrier: '2027-06' },
} as Config
const movido = derivarResumen(personas, proyectos, asignaciones, configMovido, HOY)
eq('correr la última salida corre el cierre del programa', movido.fin.mes, '2027-06')
eq('y estira el eje de meses', movido.meses.length, 10)
eq('el eje incluye los meses sin salidas',
  movido.meses.filter(m => m.salidas.length === 0).map(m => m.label).join(', '), 'abr 27, may 27')
eq('el total de cuentas no cambia', movido.total, 25)

// ── cierre ────────────────────────────────────────────────────────────────────
console.log(`\n${corridos - fallos}/${corridos} verificaciones OK`)
if (fallos > 0) {
  console.error(`${fallos} verificaciones fallaron`)
  process.exit(1)
}
