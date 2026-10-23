/**
 * Tests de cuentas en paralelo del equipo (src/paralelo.ts) y de la regla `paralelo`
 * (src/rules.ts). Willy, 23/10/2026: el tope es por EQUIPO, default 4.
 */
import type { Asignacion, Config, Proyecto } from '../src/types'
import { celdasParalelo, cuentasPorDia, estadoParalelo, mesesPasadosDeTope, topeParalelo } from '../src/paralelo'
import { checkParalelo, computeViolaciones } from '../src/rules'
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
  check(nombre, JSON.stringify(actual) === JSON.stringify(esperado), `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(actual)}`)
}
function titulo(t: string) { console.log(`\n${t}`) }

const config = planV3.config as unknown as Config
const proyectos = planV3.proyectos as unknown as Proyecto[]
const feriados = feriadosDeConfig(config)

function barra(id: string, proyecto: string | null, inicio: string, fin: string, extra: Partial<Asignacion> = {}): Asignacion {
  return { id, proyecto_id: proyecto, tipo: 'Configuracion', persona_id: 'moni', inicio, fin, duracion_dias: 1, dedicacion_pct: 0.5, predecesoras: [], es_bloqueo: false, ...extra }
}

titulo('topeParalelo')
eq('default 4 si el plan no lo trae', topeParalelo({ ...config, reglas_calendario: {} }), 4)
eq('lo toma del JSON', topeParalelo({ ...config, reglas_calendario: { max_cuentas_en_paralelo: 3 } }), 3)

titulo('cuentasPorDia — cuenta cuentas distintas, no barras ni personas')
// Lunes 2 al viernes 6 de noviembre de 2026.
const base: Asignacion[] = [
  barra('a1', 'tim', '2026-11-02', '2026-11-06'),
  barra('a2', 'tim', '2026-11-02', '2026-11-06', { persona_id: 'guille' }),   // misma cuenta, otra persona
  barra('b1', 'piano', '2026-11-04', '2026-11-05'),
  barra('v1', null, '2026-11-02', '2026-11-06', { tipo: 'Vacaciones', es_bloqueo: true }),  // no cuenta
  barra('c1', 'copetro', '2026-11-07', '2026-11-08'),  // sábado y domingo: no hay días hábiles
]
const porDia = cuentasPorDia(base, feriados)
eq('lunes: solo TIM', [...(porDia.get('2026-11-02') ?? [])], ['tim'])
eq('miércoles: TIM y Piano', [...(porDia.get('2026-11-04') ?? [])].sort(), ['piano', 'tim'])
eq('el fin de semana no aparece', porDia.has('2026-11-07'), false)

titulo('celdasParalelo — el número de la semana es el máximo del mismo día, no la suma')
const cruzadas: Asignacion[] = [
  barra('x', 'tim', '2026-11-02', '2026-11-02'),     // lunes
  barra('y', 'piano', '2026-11-06', '2026-11-06'),   // viernes
]
const semana = celdasParalelo(cuentasPorDia(cruzadas, feriados), 'semanas')
eq('una sola celda de semana', semana.length, 1)
eq('lunes y viernes no estuvieron a la vez: máximo 1', semana[0].max, 1)
const mes = celdasParalelo(porDia, 'meses')
eq('celda de mes anclada al 1°', mes[0].fecha, '2026-11-01')
eq('máximo del mes: 2', mes[0].max, 2)
eq('día pico: el primero en que se llegó', mes[0].diaPico, '2026-11-04')

titulo('estadoParalelo')
eq('3 de 4: ok', estadoParalelo(3, 4), 'ok')
eq('4 de 4: en el tope', estadoParalelo(4, 4), 'tope')
eq('5 de 4: pasado', estadoParalelo(5, 4), 'pasado')

titulo('regla paralelo')
const cinco: Asignacion[] = ['tim', 'piano', 'copetro', 'dla', 'marval'].map((p, i) => barra(`p${i}`, p, '2026-11-09', '2026-11-13'))
const tramos = mesesPasadosDeTope(cuentasPorDia(cinco, feriados), 4)
eq('cinco cuentas la misma semana: un mes pasado', tramos.length, 1)
eq('se pasa los 5 días hábiles', tramos[0].dias, 5)
const v = checkParalelo(cinco, config, proyectos)
eq('una violación roja', v.map(x => x.severidad), ['rojo'])
check('el mensaje nombra las cuentas y el tope', /TIM/.test(v[0].mensaje) && /tope del equipo es 4/.test(v[0].mensaje), v[0].mensaje)
eq('con tope 5 no salta', checkParalelo(cinco, { ...config, reglas_calendario: { max_cuentas_en_paralelo: 5 } }, proyectos).length, 0)

titulo('plan v3')
const asigV3 = planV3.asignaciones as unknown as Asignacion[]
const maxV3 = Math.max(...[...cuentasPorDia(asigV3, feriados).values()].map(s => s.size))
console.log(`  (máximo de cuentas a la vez en el v3: ${maxV3})`)
const enV3 = computeViolaciones(asigV3, planV3.personas as never, config, proyectos).filter(x => x.tipo === 'paralelo')
eq('computeViolaciones incluye la regla y coincide con checkParalelo', enV3.length, checkParalelo(asigV3, config, proyectos).length)

console.log(`\n${fallos ? `${fallos} FALLAS` : 'TODO OK'} — ${corridos} chequeos`)
if (fallos) process.exit(1)
