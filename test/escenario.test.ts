/**
 * Tests de los escenarios de capacidad (src/escenario.ts), del rearmado que adelanta cuentas
 * (adelantarTodoNivelado), del tope de carga por persona (carga_maxima_pct) y de la regla de
 * diciembre del plan. Corren sobre el plan v3 (test/fixtures/plan-v3.json). 23/10/2026.
 */
import type { Asignacion, Config, Persona, Proyecto } from '../src/types'
import { adelantarTodoNivelado, cuentaArrancada, planificarCuentaNivelada } from '../src/planificadorNivelado'
import { claveViolacion, computeViolaciones } from '../src/rules'
import { mesSalidaDe } from '../src/capacidad'
import {
  compararPlanes, conPalancas, palancasDe, pasosEscalera, personasDeImplementacion, rearmarConPalancas, ultimaSalida,
  type PlanDatos,
} from '../src/escenario'
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

const personas = planV3.personas as unknown as Persona[]
const proyectos = planV3.proyectos as unknown as Proyecto[]
const asignaciones = planV3.asignaciones as unknown as Asignacion[]
const config = planV3.config as unknown as Config
const plan: PlanDatos = { personas, proyectos, asignaciones, config }
const HOY = '2026-06-01'
const feriados = feriadosDeConfig(config)
const duros = (p: PlanDatos) => new Set(computeViolaciones(p.asignaciones, p.personas, p.config, p.proyectos)
  .filter(v => v.severidad === 'rojo' && v.tipo !== 'carga_mes' && v.tipo !== 'carga_semana').map(claveViolacion))

// ── palancas ──────────────────────────────────────────────────────────────────
titulo('palancasDe / conPalancas — ida y vuelta')
const base = palancasDe(plan)
eq('las personas de implementación del v3', personasDeImplementacion(plan).map(p => p.id).sort(), ['gaby_f', 'guille', 'moni'])
eq('el tope del v3', base.tope, 4)
const objetivo = { tope: 5, horasDia: { ...base.horasDia, gaby_f: 5 }, cargaMaxima: { ...base.cargaMaxima, guille: 1.2, moni: 1.2, gaby_f: 1.2 } }
const conP = conPalancas(plan, objetivo)
eq('vuelve a leer las mismas palancas', palancasDe(conP), objetivo)
check('no toca ninguna fecha', conP.asignaciones === asignaciones)
eq('sacar el 120 % borra la clave (el JSON no crece)', 'carga_maxima_pct' in conPalancas(conP, base).personas.find(p => p.id === 'guille')!, false)

// ── tope de carga por persona ─────────────────────────────────────────────────
titulo('carga_maxima_pct — el aviso semanal respeta lo permitido, el control mensual no cambia')
const vsBase = computeViolaciones(asignaciones, personas, config, proyectos)
const guille2 = personas.map(p => (p.id === 'guille' ? { ...p, carga_maxima_pct: 2 } : p))
const vs2 = computeViolaciones(asignaciones, guille2, config, proyectos)
check('el v3 trae avisos semanales de Guille', vsBase.some(v => v.tipo === 'carga_semana' && v.persona_id === 'guille'))
check('con hasta 200 % ya no', !vs2.some(v => v.tipo === 'carga_semana' && v.persona_id === 'guille'))
check('el rojo mensual de enero sigue', vs2.some(v => v.tipo === 'carga_mes' && v.persona_id === 'guille'))

titulo('carga_maxima_pct — más capacidad nunca hace que una cuenta deje de entrar en su mes')
{
  const generosas = personas.map(p => ({ ...p, carga_maxima_pct: 1.5 }))
  const perdidas: string[] = []
  for (const p of proyectos) {
    const mes = mesSalidaDe(p.id, config)
    if (!mes) continue
    const a = planificarCuentaNivelada(p.id, asignaciones, mes, personas, config, proyectos, { hoyISO: HOY })
    if (!a.ok) continue
    const b = planificarCuentaNivelada(p.id, asignaciones, mes, generosas, config, proyectos, { hoyISO: HOY })
    if (!b.ok) perdidas.push(`${p.nombre}: ${b.motivo}`)
  }
  check('ninguna se pierde al 150 %', perdidas.length === 0, perdidas.join(' | '))
}

// ── regla de diciembre ────────────────────────────────────────────────────────
titulo('diciembre_una_sola_salida — el diciembre de GSMA es solo suyo')
const cfgDic: Config = { ...config, reglas_calendario: { ...config.reglas_calendario, diciembre_una_sola_salida: 'gsma', diciembre_sin_moni: true } }
const vsDic = computeViolaciones(asignaciones, personas, cfgDic, proyectos)
const dic = vsDic.find(v => v.tipo === 'tope_salidas' && v.mes === '2026-12' && v.severidad === 'rojo')
check('el v3 saca a Bonafide en diciembre: rojo', !!dic && dic.mensaje.includes('Bonafide'), dic?.mensaje ?? 'sin violación')
const bona = planificarCuentaNivelada('bonafide', asignaciones, '2026-12', personas, cfgDic, proyectos, { hoyISO: HOY })
check('el planificador no la ubica ahí', !bona.ok && bona.motivo.includes('reserva'), bona.ok ? 'entró' : bona.motivo)
const gsma = planificarCuentaNivelada('gsma', asignaciones, '2026-12', personas, cfgDic, proyectos, { hoyISO: HOY })
check('GSMA sí entra en su diciembre', gsma.ok, gsma.ok ? '' : gsma.motivo)
const cope = planificarCuentaNivelada('copetro', asignaciones, '2027-01', personas, cfgDic, proyectos, { hoyISO: HOY })
check('Copetro sale en enero', cope.ok, cope.ok ? '' : cope.motivo)
if (cope.ok) {
  const enDic = cope.asignaciones.filter(a => a.persona_id === 'moni' && !a.es_bloqueo && a.inicio <= '2026-12-31' && a.fin >= '2026-12-01')
  check('sin tareas de Moni en diciembre', enDic.length === 0, enDic.map(a => `${a.id} ${a.inicio}→${a.fin}`).join(', '))
}

// ── rearmar adelantando ───────────────────────────────────────────────────────
titulo('adelantarTodoNivelado — plan v3 con hoy = 01/06/2026')
const r = adelantarTodoNivelado(asignaciones, personas, config, proyectos, { hoyISO: HOY })
const despues: PlanDatos = { ...plan, asignaciones: r.asignaciones, config: r.config }
console.log(`  (movidas: ${r.reporte.movidas.map(m => `${m.nombre} ${m.antes}→${m.despues}`).join(', ') || 'ninguna'} · igual ${r.reporte.igual.length} · no entran ${r.reporte.noEntran.length})`)
const candidatas = proyectos.filter(p => mesSalidaDe(p.id, config) && asignaciones.some(a => a.proyecto_id === p.id && !a.es_bloqueo))
eq('cada cuenta queda contada una vez', r.reporte.movidas.length + r.reporte.igual.length + r.reporte.noEntran.length + r.reporte.enCurso.length, candidatas.length)
check('ninguna cuenta se atrasa', proyectos.every(p => { const a = mesSalidaDe(p.id, config), d = mesSalidaDe(p.id, r.config); return !a || !d || d <= a }))
check('las movidas salen antes', r.reporte.movidas.every(m => m.despues < m.antes))
const nuevos = [...duros(despues)].filter(m => !duros(plan).has(m))
check('no agrega conflictos rojos que no sean de carga', nuevos.length === 0, nuevos.join(' | '))
check('las que ya arrancaron no se tocan', proyectos.filter(p => cuentaArrancada(p.id, asignaciones, HOY))
  .every(p => JSON.stringify(r.asignaciones.filter(a => a.proyecto_id === p.id)) === JSON.stringify(asignaciones.filter(a => a.proyecto_id === p.id))))
check('la última salida no se atrasa', (ultimaSalida(despues) ?? '') <= (ultimaSalida(plan) ?? ''))

titulo('rearmarConPalancas — parte de la base y aplica las palancas')
const rp = rearmarConPalancas(plan, objetivo, HOY)
eq('el plan rearmado trae las palancas', palancasDe(rp.plan), objetivo)
check('y no atrasa la última salida', (ultimaSalida(rp.plan) ?? '') <= (ultimaSalida(plan) ?? ''))

// ── comparar ──────────────────────────────────────────────────────────────────
titulo('compararPlanes')
const igual = compararPlanes(plan, plan)
eq('contra sí mismo no hay movidas', igual.movidas.length, 0)
eq('ni palancas cambiadas', igual.palancas, [])
const c = compararPlanes(plan, rp.plan)
eq('las movidas son las del reporte', c.movidas.map(m => m.id).sort(), rp.reporte.movidas.map(m => m.id).sort())
check('describe el tope y la jornada de Gaby', c.palancas.some(t => t.includes('tope de cuentas abiertas 4 → 5')) && c.palancas.some(t => t.startsWith('Gaby F. 4 h → 5 h')), c.palancas.join(' | '))
check('trae una fila por persona de implementación', c.equipo.map(e => e.id).sort().join() === 'gaby_f,guille,moni')
check('los meses cubren de la primera a la última salida', c.meses[0] <= Object.keys(c.salidas.antes).sort()[0] && c.meses[c.meses.length - 1] >= (ultimaSalida(plan) ?? ''))

// ── qué aporta cada palanca ───────────────────────────────────────────────────
titulo('pasosEscalera')
const alias = (id: string) => personas.find(p => p.id === id)?.alias ?? id
const pasos = pasosEscalera(base, objetivo, alias)
eq('etiquetas', pasos.map(p => p.etiqueta), ['Solo tope 5', '+ Gaby F. 5 h', '+ solo Guille al 120 %', '+ solo Moni al 120 %', '+ solo Gaby F. al 120 %', '+ todos al 120 %'].sort((a, b) => pasos.findIndex(p => p.etiqueta === a) - pasos.findIndex(p => p.etiqueta === b)))
eq('el primero solo cambia el tope', [pasos[0].palancas.tope, pasos[0].palancas.horasDia.gaby_f, pasos[0].palancas.cargaMaxima.guille], [5, base.horasDia.gaby_f, 1])
eq('el último es el objetivo', pasos[pasos.length - 1].palancas, objetivo)
eq('sin cambios: un solo paso', pasosEscalera(base, base, alias).map(p => p.etiqueta), ['Sin cambiar palancas'])
void feriados

console.log(`\n${fallos ? `${fallos} FALLAS` : 'TODO OK'} — ${corridos} chequeos`)
if (fallos) process.exit(1)
