import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona, TipoFase, Violacion } from './types'
import { cargaSemanal, cuentasEnAxton, cuentasEnMeta4, mesDe, mesSalidaDe, salidasFueraDelPlan } from './capacidad'
import { ddmm, fechaCorteDe, habilesHasta, nombreMes } from './rules'
import { tierDe, TIER_LABEL } from './insightsEquipo'
import { cargaPorMes, paraleloPorMes, personasDeImplementacion, picoDe, ultimaSalida, type PlanDatos } from './escenario'
import { topeParalelo } from './paralelo'
import { feriadosDeConfig, getMondayOfWeek, toISO } from './utils/dates'
import { cuentaArrancada, esLiquidacionEnVivo } from './planificadorNivelado'

/**
 * Lo que leen las vistas del programa (23/10/2026): Salidas (la mesa de meses), Hoy (lo que
 * pasa ahora y lo que viene) y Reunión (cuatro preguntas con su respuesta). Todo sale del plan
 * cargado, así cada vista se rearma sola cuando se mueve una cuenta. Funciones puras:
 * `test/vistas.test.ts`.
 */

export const ETAPAS: TipoFase[] = ['Relevamiento', 'Configuracion', 'Pruebas', 'Cierre']
export type EstadoEtapa = 'hecha' | 'en_curso' | 'pendiente' | 'no_tiene'
export type Momento = 'sin_empezar' | 'armando' | 'esperando' | 'en_vivo' | 'en_axton'

const ETAPA_TXT: Record<string, string> = {
  Relevamiento: 'relevamiento', Configuracion: 'configuración', Pruebas: 'pruebas', Cierre: 'actualización final',
}

export interface EstadoCuenta {
  id: string
  nombre: string
  /** chica / estándar / grande / XL; '' si el plan no la clasifica. */
  tier: string
  mes: string | null
  corte: string | null
  etapas: Record<string, EstadoEtapa>
  momento: Momento
  /** Lo que está pasando, para leer de corrido: "En pruebas hasta 06/11", "Arranca 29/10". */
  texto: string
  /** Qué sigue: "Sigue actualización final 11/11" (vacío si no hay nada más). */
  sigue: string
  /** Primer día con una tarea de implementación; null si no tiene. */
  arranca: string | null
  /** No arrancó: se puede mover de mes. */
  movible: boolean
}

/** Tareas del equipo de implementación: sin bloqueos, sin la primera liquidación y sin las del analista de payroll. */
function esDeImplementacion(a: Asignacion, payroll: ReadonlySet<string>): boolean {
  return !a.es_bloqueo && !esLiquidacionEnVivo(a) && !payroll.has(a.persona_id) && !(a._fase ?? '').startsWith('Payroll')
}

export function idsPayroll(personas: Persona[]): Set<string> {
  return new Set(personas.filter(p => p.rol === 'payroll').map(p => p.id))
}

/** Cómo está una cuenta a una fecha. */
export function estadoDeCuenta(proyectoId: string, plan: PlanDatos, hoyISO: string): EstadoCuenta {
  const p = plan.proyectos.find(x => x.id === proyectoId)
  const nombre = p?.nombre ?? proyectoId
  const payroll = idsPayroll(plan.personas)
  const propias = plan.asignaciones.filter(a => a.proyecto_id === proyectoId && !a.es_bloqueo)
  const impl = propias.filter(a => esDeImplementacion(a, payroll))
  const liq = propias.filter(esLiquidacionEnVivo)
  const mes = mesSalidaDe(proyectoId, plan.config)
  const corte = mes ? fechaCorteDe(proyectoId, mes, plan.config, feriadosDeConfig(plan.config)) : null
  const t = tierDe(proyectoId, plan.config)

  const etapas: Record<string, EstadoEtapa> = {}
  for (const tipo of ETAPAS) {
    const bs = impl.filter(a => a.tipo === tipo)
    if (!bs.length) { etapas[tipo] = 'no_tiene'; continue }
    const hechas = bs.filter(a => a.fin < hoyISO).length
    const activa = bs.some(a => a.inicio <= hoyISO && a.fin >= hoyISO)
    etapas[tipo] = hechas === bs.length ? 'hecha' : activa || hechas > 0 ? 'en_curso' : 'pendiente'
  }

  const finDe = (bs: Asignacion[]) => bs.map(a => a.fin).sort().pop() ?? ''
  const proximas = impl.filter(a => a.inicio > hoyISO).sort((a, b) => a.inicio.localeCompare(b.inicio))
  const sigueTxt = proximas.length ? `Sigue ${ETAPA_TXT[proximas[0].tipo] ?? proximas[0].tipo} ${ddmm(proximas[0].inicio)}` : ''
  const arranca = impl.map(a => a.inicio).sort()[0] ?? null
  const movible = !cuentaArrancada(proyectoId, plan.asignaciones, hoyISO)
  const base = { id: proyectoId, nombre, tier: t ? TIER_LABEL[t] : '', mes, corte, etapas, arranca, movible }

  const liqIni = liq.map(a => a.inicio).sort()[0]
  const liqFin = finDe(liq)
  if (liq.length && liqIni <= hoyISO && liqFin >= hoyISO) {
    return { ...base, momento: 'en_vivo', texto: `1ª liquidación en vivo hasta ${ddmm(liqFin)}`, sigue: '' }
  }
  if ((liq.length && liqFin < hoyISO) || (!liq.length && impl.length && finDe(impl) < hoyISO && mes && mes < hoyISO.slice(0, 7))) {
    return { ...base, momento: 'en_axton', texto: 'En Axton', sigue: '' }
  }
  const activas = impl.filter(a => a.inicio <= hoyISO && a.fin >= hoyISO)
  if (activas.length) {
    // La etapa más avanzada de las que corren hoy, hasta cuándo dura esa etapa; y lo que sigue
    // es la primera tarea de una etapa posterior (no otra barra de la misma).
    const tipo = ETAPAS.slice().reverse().find(x => activas.some(a => a.tipo === x)) ?? activas[0].tipo
    const despues = proximas.find(a => ETAPAS.indexOf(a.tipo) > ETAPAS.indexOf(tipo))
    const sigue = despues ? `Sigue ${ETAPA_TXT[despues.tipo] ?? despues.tipo} ${ddmm(despues.inicio)}` : ''
    return { ...base, momento: 'armando', texto: `En ${ETAPA_TXT[tipo] ?? tipo} hasta ${ddmm(finDe(impl.filter(a => a.tipo === tipo)))}`, sigue }
  }
  if (impl.some(a => a.fin < hoyISO)) {
    return { ...base, momento: 'esperando', texto: proximas.length ? sigueTxt : `Armada · corte ${corte ? ddmm(corte) : '—'}`, sigue: '' }
  }
  return { ...base, momento: 'sin_empezar', texto: arranca ? `Arranca ${ddmm(arranca)}` : 'Sin tareas', sigue: '' }
}

// ── meses ─────────────────────────────────────────────────────────────────────────

export function sumarMes(mes: string, k: number): string {
  let [y, m] = mes.split('-').map(Number)
  m += k
  while (m > 12) { m -= 12; y++ }
  while (m < 1) { m += 12; y-- }
  return `${y}-${String(m).padStart(2, '0')}`
}

export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = []
  for (let m = desde; m <= hasta && out.length < 120; m = sumarMes(m, 1)) out.push(m)
  return out
}

/** 'Nov 26' a partir de '2026-11'. */
export function mesCorto(mes: string): string {
  return `${nombreMes(mes).slice(0, 3)} ${mes.slice(2, 4)}`
}

/** Las vacaciones de una persona que tocan un mes, como "vac. 18–29". */
function vacacionesEnMes(personaId: string, mes: string, asignaciones: Asignacion[]): string {
  const ini = `${mes}-01`, fin = `${mes}-31`
  const vs = asignaciones.filter(a => a.tipo === 'Vacaciones' && a.persona_id === personaId && a.inicio <= fin && a.fin >= ini)
  return vs.map(a => `${(a.inicio < ini ? ini : a.inicio).slice(8)}–${(a.fin > fin ? toISO(addDays(parseISO(`${sumarMes(mes, 1)}-01`), -1)) : a.fin).slice(8)}`)
    .map((t, i) => (i === 0 ? `vac. ${t}` : t)).join(', ')
}

// ── A · Mesa de salidas ───────────────────────────────────────────────────────────

export interface TarjetaSalida extends Partial<EstadoCuenta> {
  id: string
  nombre: string
  fueraDelPlan: boolean
  texto: string
}

export interface MesaDeSalidas {
  meses: Array<{ mes: string; esHoy: boolean; tarjetas: TarjetaSalida[]; enAxton: number; paralelo: number }>
  equipo: Array<{ id: string; alias: string; celdas: Array<{ mes: string; pct: number | null; vacaciones: string }> }>
  tope: number
  enAxtonHoy: number
  porMigrar: number
  quedanEnMeta4: number
  ultima: string | null
  /** "Una cuenta por mes hasta noviembre 2027" o "12 salidas hasta …". */
  titular: string
  pico: { alias: string; pct: number; mes: string } | null
}

/** Cuántas cuentas faltan migrar (siguen en Meta 4 al cierre de este mes y no se quedan para siempre). */
export function porMigrar(config: Config, hoyISO: string): { porMigrar: number; quedan: number } {
  const quedan = cuentasEnMeta4('9999-12', config).length
  return { porMigrar: Math.max(0, cuentasEnMeta4(hoyISO.slice(0, 7), config).length - quedan), quedan }
}

export function titularSalidas(plan: PlanDatos, hoyISO: string): string {
  const mesHoy = hoyISO.slice(0, 7)
  const ult = ultimaSalida(plan)
  if (!ult || ult < mesHoy) return 'No quedan salidas en el plan'
  const porMes = new Map<string, number>()
  for (const p of plan.proyectos) { const m = mesSalidaDe(p.id, plan.config); if (m && m >= mesHoy) porMes.set(m, (porMes.get(m) ?? 0) + 1) }
  for (const c of salidasFueraDelPlan(plan.config)) if (c.mes >= mesHoy) porMes.set(c.mes, (porMes.get(c.mes) ?? 0) + 1)
  const total = [...porMes.values()].reduce((s, n) => s + n, 0)
  const hasta = nombreMes(ult).toLowerCase()
  return Math.max(...porMes.values()) <= 1 ? `Una cuenta por mes hasta ${hasta}` : `${total} salidas hasta ${hasta}`
}

export function picoDelEquipo(plan: PlanDatos): { alias: string; pct: number; mes: string } | null {
  const carga = cargaPorMes(plan)
  let out: { alias: string; pct: number; mes: string } | null = null
  for (const p of personasDeImplementacion(plan)) {
    const k = picoDe(carga[p.id])
    if (k && (!out || k.pct > out.pct)) out = { alias: p.alias, pct: k.pct, mes: k.mes }
  }
  return out
}

export function mesaDeSalidas(plan: PlanDatos, hoyISO: string): MesaDeSalidas {
  const mesHoy = hoyISO.slice(0, 7)
  const ult = ultimaSalida(plan)
  const horizonte = plan.config.horizonte.hasta.slice(0, 7)
  const tope = sumarMes(ult && ult > mesHoy ? ult : mesHoy, 1)
  const hasta = tope < horizonte ? tope : horizonte
  const meses = mesesEntre(mesHoy, hasta > mesHoy ? hasta : sumarMes(mesHoy, 6))
  const par = paraleloPorMes(plan)
  const porMes = new Map<string, TarjetaSalida[]>()
  for (const p of plan.proyectos) {
    const m = mesSalidaDe(p.id, plan.config)
    if (!m || m < mesHoy) continue
    const e = estadoDeCuenta(p.id, plan, hoyISO)
    ;(porMes.get(m) ?? porMes.set(m, []).get(m)!).push({ ...e, fueraDelPlan: false })
  }
  for (const c of salidasFueraDelPlan(plan.config)) {
    if (c.mes < mesHoy) continue
    ;(porMes.get(c.mes) ?? porMes.set(c.mes, []).get(c.mes)!).push({
      id: `fuera:${c.nombre}`, nombre: c.nombre, fueraDelPlan: true,
      texto: c.mes === mesHoy ? 'Fuera del plan · sale este mes' : 'Fuera del plan',
    })
  }
  const carga = cargaPorMes(plan)
  const { porMigrar: pm, quedan } = porMigrar(plan.config, hoyISO)
  return {
    meses: meses.map(mes => ({
      mes, esHoy: mes === mesHoy, enAxton: cuentasEnAxton(mes, plan.config), paralelo: par[mes] ?? 0,
      tarjetas: (porMes.get(mes) ?? []).sort((a, b) => Number(a.fueraDelPlan) - Number(b.fueraDelPlan) || a.nombre.localeCompare(b.nombre)),
    })),
    equipo: personasDeImplementacion(plan).map(p => ({
      id: p.id, alias: p.alias,
      celdas: meses.map(mes => ({ mes, pct: carga[p.id]?.[mes] ?? null, vacaciones: vacacionesEnMes(p.id, mes, plan.asignaciones) })),
    })),
    tope: topeParalelo(plan.config),
    enAxtonHoy: cuentasEnAxton(mesHoy, plan.config),
    porMigrar: pm,
    quedanEnMeta4: quedan,
    ultima: ult,
    titular: titularSalidas(plan, hoyISO),
    pico: picoDelEquipo(plan),
  }
}

// ── B · Hoy, próximo, después ─────────────────────────────────────────────────────

export interface HoyProximo {
  titular: string
  bajada: string
  ahora: Array<{ nombre: string; etiqueta: string; texto: string; sigue: string; momento: Momento | 'fuera' }>
  proximas: Array<{ mes: string; corte: string | null; habiles: number | null; cuentas: EstadoCuenta[] }>
  despues: Array<{ mes: string; nombre: string; tier: string; arranca: string | null }>
  mesesSinSalida: string[]
  semanas: string[]
  equipo: Array<{ alias: string; pcts: Array<number | null> }>
  /** "Guille llega al 98 % la semana del 23/11 …" o null si nadie pasa del 85 %. */
  picoSemanal: string | null
  vacaciones: Array<{ alias: string; inicio: string; fin: string }>
  /** Lo que hay que decidir: los conflictos rojos y los meses con el equipo en el tope de cuentas abiertas. */
  decidir: { rojos: string[]; mesesEnTope: string[] }
}

export function hoyProximo(plan: PlanDatos, violaciones: Violacion[], hoyISO: string): HoyProximo {
  const mesHoy = hoyISO.slice(0, 7)
  const feriados = feriadosDeConfig(plan.config)
  const { porMigrar: pm } = porMigrar(plan.config, hoyISO)
  const ult = ultimaSalida(plan)
  const ultimas = ult ? [
    ...plan.proyectos.filter(p => mesSalidaDe(p.id, plan.config) === ult).map(p => p.nombre),
    ...salidasFueraDelPlan(plan.config).filter(c => c.mes === ult).map(c => c.nombre),
  ] : []
  const titular = pm === 0 ? 'No quedan cuentas por migrar.'
    : `Faltan ${pm} cuenta${pm !== 1 ? 's' : ''}. La última, ${ultimas.join(' y ')}, sale en ${nombreMes(ult!).toLowerCase()}.`

  const estados = plan.proyectos.filter(p => mesSalidaDe(p.id, plan.config) || plan.asignaciones.some(a => a.proyecto_id === p.id && !a.es_bloqueo))
    .map(p => estadoDeCuenta(p.id, plan, hoyISO))
  const en14 = toISO(addDays(parseISO(hoyISO), 14))
  const ahora: HoyProximo['ahora'] = []
  for (const e of estados) {
    if (e.momento === 'en_vivo' || e.momento === 'armando') ahora.push({ nombre: e.nombre, etiqueta: e.momento === 'en_vivo' ? '1ª liquidación' : e.texto.split(' hasta')[0], texto: e.texto, sigue: e.sigue, momento: e.momento })
    else if (e.momento === 'sin_empezar' && e.arranca && e.arranca <= en14) ahora.push({ nombre: e.nombre, etiqueta: `Arranca ${ddmm(e.arranca)}`, texto: e.texto, sigue: e.sigue, momento: e.momento })
    else if (e.momento === 'esperando' && e.mes && e.mes <= sumarMes(mesHoy, 1)) ahora.push({ nombre: e.nombre, etiqueta: 'Esperando el corte', texto: e.texto, sigue: e.sigue, momento: e.momento })
  }
  for (const c of salidasFueraDelPlan(plan.config)) if (c.mes === mesHoy) ahora.push({ nombre: c.nombre, etiqueta: 'Sale este mes', texto: 'Fuera del plan: ya estaba configurada.', sigue: '', momento: 'fuera' })
  const orden: Record<string, number> = { armando: 0, en_vivo: 1, esperando: 2, fuera: 3, sin_empezar: 4, en_axton: 5 }
  ahora.sort((a, b) => orden[a.momento] - orden[b.momento])

  const mesesConSalida = [...new Set(estados.map(e => e.mes).filter((m): m is string => !!m && m >= mesHoy))].sort()
  const proxMeses = mesesConSalida.slice(0, 3)
  const proximas = proxMeses.map(mes => {
    const cuentas = estados.filter(e => e.mes === mes)
    const corte = cuentas.map(c => c.corte).filter((x): x is string => !!x).sort()[0] ?? null
    return { mes, corte, habiles: corte && corte >= hoyISO ? habilesHasta(hoyISO, corte, feriados) : null, cuentas }
  })
  const despues = estados.filter(e => e.mes && e.mes > (proxMeses[proxMeses.length - 1] ?? '9999'))
    .sort((a, b) => a.mes!.localeCompare(b.mes!) || a.nombre.localeCompare(b.nombre))
    .map(e => ({ mes: e.mes!, nombre: e.nombre, tier: e.tier, arranca: e.arranca }))
  const sin = ult ? mesesEntre(sumarMes(mesHoy, 1), ult).filter(m => !mesesConSalida.includes(m) && !salidasFueraDelPlan(plan.config).some(c => c.mes === m)) : []

  // Las próximas 8 semanas, desde el lunes de esta.
  const lunes = toISO(getMondayOfWeek(parseISO(hoyISO)))
  const semanas = Array.from({ length: 8 }, (_, i) => toISO(addDays(parseISO(lunes), 7 * i)))
  const ps = personasDeImplementacion(plan)
  const sem = cargaSemanal(ps, plan.asignaciones, plan.config)
  const equipo = ps.map(p => ({
    alias: p.alias,
    pcts: semanas.map(s => { const c = sem.find(x => x.personaId === p.id && x.semana === s); return c && c.capacidad > 0 ? Math.round((100 * c.horas) / c.capacidad) : null }),
  }))
  let pico: { alias: string; pct: number; semanas: string[] } | null = null
  for (const e of equipo) {
    const max = Math.max(...e.pcts.map(x => x ?? 0))
    if (max >= 85 && (!pico || max > pico.pct)) pico = { alias: e.alias, pct: max, semanas: semanas.filter((_, i) => e.pcts[i] === max) }
  }
  let picoSemanal: string | null = null
  if (pico) {
    const mesPico = mesDe(pico.semanas[0])
    const c = cargaPorMes(plan)[ps.find(p => p.alias === pico!.alias)!.id]?.[mesPico]
    const cuando = pico.semanas.length > 1 ? `las semanas del ${pico.semanas.map(ddmm).join(' y del ')}` : `la semana del ${ddmm(pico.semanas[0])}`
    picoSemanal = `${pico.alias} llega al ${pico.pct} % ${cuando}${c != null ? `, aunque ${nombreMes(mesPico).toLowerCase()} completo da ${c} %` : ''}.`
  }

  const vacaciones = plan.asignaciones
    .filter(a => a.tipo === 'Vacaciones' && a.fin >= hoyISO && ps.some(p => p.id === a.persona_id))
    .sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, 6)
    .map(a => ({ alias: ps.find(p => p.id === a.persona_id)!.alias, inicio: a.inicio, fin: a.fin }))

  const par = paraleloPorMes(plan), tope = topeParalelo(plan.config)
  const mesesEnTope = mesesEntre(mesHoy, sumarMes(mesHoy, 3)).filter(m => (par[m] ?? 0) >= tope)
  const rojos = violaciones.filter(v => v.severidad === 'rojo').map(v => v.mensaje)

  const prox = proximas[0]
  const bajada = [
    `${cuentasEnAxton(mesHoy, plan.config)} cuentas en Axton hoy.`,
    rojos.length ? `${rojos.length} conflicto${rojos.length !== 1 ? 's' : ''} en rojo.` : 'Ninguna regla en rojo.',
    prox ? `La próxima salida es en ${nombreMes(prox.mes).toLowerCase()}: ${prox.cuentas.map(c => c.nombre).join(' y ')}${prox.corte ? `, con corte el ${ddmm(prox.corte)}${prox.habiles != null ? `, dentro de ${prox.habiles} días hábiles` : ''}` : ''}.` : '',
  ].filter(Boolean).join(' ')

  return { titular, bajada, ahora, proximas, despues, mesesSinSalida: sin, semanas, equipo, picoSemanal, vacaciones, decidir: { rojos, mesesEnTope } }
}

// ── C · Modo reunión ──────────────────────────────────────────────────────────────

export interface Capitulo { num: number; pregunta: string; respuesta: string }

export function capitulosReunion(plan: PlanDatos, violaciones: Violacion[], hoyISO: string): Capitulo[] {
  const mesHoy = hoyISO.slice(0, 7)
  const enAxton = cuentasEnAxton(mesHoy, plan.config)
  const total = enAxton + cuentasEnMeta4(mesHoy, plan.config).length
  const pico = picoDelEquipo(plan)
  const rojos = violaciones.filter(v => v.severidad === 'rojo').length
  const ult = ultimaSalida(plan)
  const titular = titularSalidas(plan, hoyISO)
  return [
    { num: 1, pregunta: '¿Dónde estamos?', respuesta: `${enAxton} de ${total} cuentas en Axton` },
    { num: 2, pregunta: '¿Qué sale y cuándo?', respuesta: ult ? titular.replace('Una cuenta por mes', 'Una por mes').replace(nombreMes(ult).toLowerCase(), mesCorto(ult).toLowerCase()) : titular },
    { num: 3, pregunta: '¿Da el equipo?', respuesta: pico ? `Pico ${pico.pct} %, ${pico.alias} en ${nombreMes(pico.mes).split(' ')[0].toLowerCase()}` : 'Sin carga planificada' },
    { num: 4, pregunta: '¿Qué decidimos hoy?', respuesta: rojos ? `${rojos} en rojo` : 'Nada en rojo' },
  ]
}

/** Las estaciones de la línea del programa: un mes por estación, de hoy a la última salida. */
export function estacionesDelPrograma(plan: PlanDatos, hoyISO: string): Array<{ mes: string; enAxton: number; cuentas: string[]; esHoy: boolean; ultima: boolean }> {
  const mesHoy = hoyISO.slice(0, 7)
  const ult = ultimaSalida(plan)
  if (!ult || ult < mesHoy) return []
  return mesesEntre(mesHoy, ult).map(mes => ({
    mes, esHoy: mes === mesHoy, ultima: mes === ult, enAxton: cuentasEnAxton(mes, plan.config),
    cuentas: [
      ...salidasFueraDelPlan(plan.config).filter(c => c.mes === mes).map(c => c.nombre),
      ...plan.proyectos.filter(p => mesSalidaDe(p.id, plan.config) === mes).map(p => p.nombre).sort(),
    ],
  }))
}
