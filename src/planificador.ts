import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { feriadosDeConfig, getMondayOfWeek, toISO } from './utils/dates'
import { computeViolaciones, fechaCorteDe, habilesHasta } from './rules'
import { cargaMensual, mesSalidaDe } from './capacidad'

/**
 * Planificador hacia atrás: el mismo algoritmo que armar_calendario_migracion.py, adentro
 * de la app. Recibe UNA decisión (el mes de salida en vivo de una cuenta) y deriva las
 * fechas de todas sus fases desde el corte de novedades de ese mes:
 *
 *   1. Pruebas: el lunes hábil más tarde que deje `margen_minimo_habiles` antes del corte y
 *      no toque el blackout de fin de año. Todas las pruebas arrancan ese lunes.
 *   2. Configuración: el lunes hábil más tarde que termine antes de las pruebas, fuera del
 *      blackout. Todas las configuraciones arrancan ese lunes.
 *   3. Relevamiento: la última (por orden actual) el lunes anterior a la configuración; las
 *      anteriores encadenan hacia atrás, cada una terminando el hábil previo a la siguiente.
 *   4. Cierre: pegado al corte, no a las pruebas. La última barra termina el hábil anterior
 *      al corte y las demás encadenan hacia atrás. Puede pisar las pruebas: se informa.
 *
 * Solo cambia `inicio` y `fin`. Conserva id, persona, duración, dedicación y predecesoras,
 * así funciona con cualquier forma de cuenta (v3 con corrida, v5 con Cierre) y sin depender
 * de la tabla de duraciones por tier. Lo que el algoritmo NO resuelve a propósito son los
 * choques de carga entre cuentas: esos quedan a la vista en las reglas para decidirlos.
 */

// ── calendario ────────────────────────────────────────────────────────────────────

export function esHabilISO(iso: string, feriados: ReadonlySet<string>): boolean {
  const dow = parseISO(iso).getDay()
  return dow !== 0 && dow !== 6 && !feriados.has(iso)
}

/** El día hábil anterior a `iso` (nunca el mismo día). */
export function habilAnterior(iso: string, feriados: ReadonlySet<string>): string {
  let d = addDays(parseISO(iso), -1)
  while (!esHabilISO(toISO(d), feriados)) d = addDays(d, -1)
  return toISO(d)
}

/** Los `n` días hábiles a partir de `inicioISO` inclusive (si cae no hábil, arranca en el siguiente). */
export function habilesDesde(inicioISO: string, n: number, feriados: ReadonlySet<string>): string[] {
  const out: string[] = []
  let d = parseISO(inicioISO)
  while (out.length < Math.max(1, n)) {
    const iso = toISO(d)
    if (esHabilISO(iso, feriados)) out.push(iso)
    d = addDays(d, 1)
  }
  return out
}

/** Los `n` días hábiles que TERMINAN en `finISO` inclusive, en orden cronológico. */
export function ultimosHabiles(finISO: string, n: number, feriados: ReadonlySet<string>): string[] {
  const out: string[] = []
  let d = parseISO(finISO)
  while (out.length < Math.max(1, n)) {
    const iso = toISO(d)
    if (esHabilISO(iso, feriados)) out.push(iso)
    d = addDays(d, -1)
  }
  return out.reverse()
}

/** El lunes de la semana de `iso`; si ese lunes es feriado, el de la semana anterior. */
export function lunesHabilAnteriorOIgual(iso: string, feriados: ReadonlySet<string>): string {
  let d = getMondayOfWeek(parseISO(iso))
  while (!esHabilISO(toISO(d), feriados)) d = addDays(d, -7)
  return toISO(d)
}

export function pisaBlackout(iniISO: string, finISO: string, blackout?: [string, string]): boolean {
  if (!blackout || blackout.length !== 2) return false
  const [b0, b1] = blackout
  return !(finISO < b0 || iniISO > b1)
}

// ── planificación de una cuenta ───────────────────────────────────────────────────

export type MotivoNoPlanificable = 'sin_fases' | 'sin_corte' | 'sin_lugar' | 'fuera_de_horizonte'

export const MOTIVO_TEXTO: Record<MotivoNoPlanificable, string> = {
  sin_fases: 'La cuenta no tiene fases planificadas.',
  sin_corte: '[FALTA: día de corte de novedades] Sin ese dato no se puede ubicar la cuenta. Va en config.cortes_novedades_dia.',
  sin_lugar: 'No hay lugar antes del corte que respete el margen mínimo y el blackout.',
  fuera_de_horizonte: 'Ese mes queda fuera del horizonte del plan.',
}

export type ResultadoPlan =
  | { ok: true; asignaciones: Asignacion[]; corte: string; margen: number; cierrePisaPruebas: boolean }
  | { ok: false; motivo: MotivoNoPlanificable }

const ORDEN_CRONO = (a: Asignacion, b: Asignacion) =>
  (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : a.id < b.id ? -1 : 1)
const MAX_INTENTOS = 60

export function planificarCuenta(proyectoId: string, asignaciones: Asignacion[], mesSalida: string, config: Config): ResultadoPlan {
  const propias = asignaciones.filter(a => a.proyecto_id === proyectoId && !a.es_bloqueo)
  if (!propias.length) return { ok: false, motivo: 'sin_fases' }
  const desde = config.horizonte.desde.slice(0, 7)
  const hasta = config.horizonte.hasta.slice(0, 7)
  if (mesSalida < desde || mesSalida > hasta) return { ok: false, motivo: 'fuera_de_horizonte' }

  const feriados = feriadosDeConfig(config)
  const corte = fechaCorteDe(proyectoId, mesSalida, config, feriados)
  if (!corte) return { ok: false, motivo: 'sin_corte' }
  const minimo = config.capacidad?.margen_minimo_habiles ?? 5
  const blackout = config.tiers_v3?.blackout_config

  const porTipo = (tipo: Asignacion['tipo']) => propias.filter(a => a.tipo === tipo).sort(ORDEN_CRONO)
  const pruebas = porTipo('Pruebas')
  const configs = porTipo('Configuracion')
  const relevs = porTipo('Relevamiento')
  const cierres = porTipo('Cierre')

  const nuevas = new Map<string, Asignacion>()
  const fijarDesde = (a: Asignacion, inicio: string) => {
    const dias = habilesDesde(inicio, a.duracion_dias, feriados)
    nuevas.set(a.id, { ...a, inicio: dias[0], fin: dias[dias.length - 1] })
  }
  const fijarHasta = (a: Asignacion, fin: string) => {
    const dias = ultimosHabiles(fin, a.duracion_dias, feriados)
    nuevas.set(a.id, { ...a, inicio: dias[0], fin: dias[dias.length - 1] })
  }
  const durMax = (xs: Asignacion[]) => Math.max(...xs.map(a => a.duracion_dias))
  const lunesAnterior = (lunes: string) => lunesHabilAnteriorOIgual(toISO(addDays(parseISO(lunes), -7)), feriados)
  const finDesde = (lunes: string, dur: number) => {
    const dias = habilesDesde(lunes, dur, feriados)
    return dias[dias.length - 1]
  }

  // 1. Pruebas: el lunes más tarde que deje el margen mínimo antes del corte y no toque el blackout.
  let margen = 0
  let iniPruebas: string | null = null
  if (pruebas.length) {
    const dur = durMax(pruebas)
    let lunes = lunesHabilAnteriorOIgual(corte, feriados)
    let encontrado = false
    for (let i = 0; i < MAX_INTENTOS; i++) {
      const fin = finDesde(lunes, dur)
      const m = fin < corte ? habilesHasta(fin, corte, feriados) : -1
      if (m >= minimo && !pisaBlackout(lunes, fin, blackout)) { margen = m; encontrado = true; break }
      lunes = lunesAnterior(lunes)
    }
    if (!encontrado) return { ok: false, motivo: 'sin_lugar' }
    iniPruebas = lunes
    for (const a of pruebas) fijarDesde(a, lunes)
  }

  // 2. Configuración: termina antes de las pruebas (o del corte, si la cuenta no tiene pruebas).
  let iniConfig: string | null = null
  if (configs.length) {
    const dur = durMax(configs)
    const tope = iniPruebas ?? corte
    let lunes = lunesHabilAnteriorOIgual(toISO(addDays(parseISO(tope), -3)), feriados)
    let encontrado = false
    for (let i = 0; i < MAX_INTENTOS; i++) {
      const fin = finDesde(lunes, dur)
      if (fin < tope && !pisaBlackout(lunes, fin, blackout)) { encontrado = true; break }
      lunes = lunesAnterior(lunes)
    }
    if (!encontrado) return { ok: false, motivo: 'sin_lugar' }
    iniConfig = lunes
    for (const a of configs) fijarDesde(a, lunes)
  }

  // 3. Relevamiento: la última el lunes anterior a la configuración; las demás hacia atrás.
  if (relevs.length) {
    const ancla = iniConfig ?? iniPruebas ?? corte
    const lunes = lunesHabilAnteriorOIgual(toISO(addDays(parseISO(ancla), -3)), feriados)
    const ultima = relevs[relevs.length - 1]
    fijarDesde(ultima, lunes)
    let siguienteInicio = nuevas.get(ultima.id)!.inicio
    for (let i = relevs.length - 2; i >= 0; i--) {
      fijarHasta(relevs[i], habilAnterior(siguienteInicio, feriados))
      siguienteInicio = nuevas.get(relevs[i].id)!.inicio
    }
  }

  // 4. Cierre: pegado al corte, encadenado hacia atrás en su orden actual.
  let cierrePisaPruebas = false
  if (cierres.length) {
    let fin = habilAnterior(corte, feriados)
    for (let i = cierres.length - 1; i >= 0; i--) {
      fijarHasta(cierres[i], fin)
      fin = habilAnterior(nuevas.get(cierres[i].id)!.inicio, feriados)
    }
    if (pruebas.length) {
      const finPruebas = pruebas.map(a => nuevas.get(a.id)!.fin).sort()[pruebas.length - 1]
      cierrePisaPruebas = nuevas.get(cierres[0].id)!.inicio <= finPruebas
    }
  }

  const resultado = propias.map(a => nuevas.get(a.id) ?? a)
  if (resultado.some(a => a.inicio < config.horizonte.desde)) return { ok: false, motivo: 'fuera_de_horizonte' }
  return { ok: true, asignaciones: resultado, corte, margen, cierrePisaPruebas }
}

/** Reemplaza en la lista completa las barras que vienen en `nuevas` (por id). El resto queda igual. */
export function aplicarPlan(asignaciones: Asignacion[], nuevas: Asignacion[]): Asignacion[] {
  const porId = new Map(nuevas.map(a => [a.id, a]))
  return asignaciones.map(a => porId.get(a.id) ?? a)
}

/** El mismo config con el mes de salida de una cuenta cambiado. Conserva `_fuera_del_plan` y el resto. */
export function configConSalida(config: Config, proyectoId: string, mes: string): Config {
  return {
    ...config,
    salidas_en_vivo_propuestas: { ...(config.salidas_en_vivo_propuestas ?? {}), [proyectoId]: mes },
  }
}

// ── qué pasa si la cuenta sale en otro mes ────────────────────────────────────────

export type EstadoDestino = 'verde' | 'ambar' | 'rojo' | 'gris'

export interface Destino {
  mes: string
  /** verde: no aparecen conflictos nuevos · ámbar: solo avisos nuevos · rojo: al menos un conflicto nuevo · gris: no se puede planificar ahí */
  estado: EstadoDestino
  actual: boolean
  /** El primer conflicto nuevo (o el motivo por el que no se puede), en castellano. */
  motivo: string | null
  rojos: number
  ambares: number
  deltaRojos: number
  deltaAmbares: number
  margen: number | null
  corte: string | null
}

/** Meses 'YYYY-MM' desde el más tarde entre hoy y el inicio del horizonte, hasta el fin del horizonte. */
export function mesesCandidatos(config: Config, hoyISO: string): string[] {
  const mesHoy = hoyISO.slice(0, 7)
  const mesDesde = config.horizonte.desde.slice(0, 7)
  const desde = mesHoy > mesDesde ? mesHoy : mesDesde
  const hasta = config.horizonte.hasta.slice(0, 7)
  const out: string[] = []
  let [y, m] = desde.split('-').map(Number)
  for (let i = 0; i < 120; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    if (key > hasta) break
    out.push(key)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

const cuenta = (vs: Violacion[], sev: Violacion['severidad']) => vs.filter(v => v.severidad === sev).length

export function simularDestinos(
  proyectoId: string, meses: string[], asignaciones: Asignacion[], personas: Persona[], config: Config, proyectos: Proyecto[],
): Destino[] {
  const base = computeViolaciones(asignaciones, personas, config, proyectos)
  const rojosBase = cuenta(base, 'rojo')
  const ambaresBase = cuenta(base, 'ambar')
  const mensajesBase = new Set(base.map(v => v.mensaje))
  const actual = mesSalidaDe(proyectoId, config)

  return meses.map(mes => {
    const plan = planificarCuenta(proyectoId, asignaciones, mes, config)
    if (!plan.ok) {
      return {
        mes, estado: 'gris', actual: mes === actual, motivo: MOTIVO_TEXTO[plan.motivo],
        rojos: rojosBase, ambares: ambaresBase, deltaRojos: 0, deltaAmbares: 0, margen: null, corte: null,
      }
    }
    const v = computeViolaciones(aplicarPlan(asignaciones, plan.asignaciones), personas, configConSalida(config, proyectoId, mes), proyectos)
    const rojos = cuenta(v, 'rojo')
    const ambares = cuenta(v, 'ambar')
    const deltaRojos = rojos - rojosBase
    const deltaAmbares = ambares - ambaresBase
    const nuevas = v.filter(x => x.severidad !== 'info' && !mensajesBase.has(x.mensaje))
    const motivo = (nuevas.find(x => x.severidad === 'rojo') ?? nuevas[0])?.mensaje ?? null
    const estado: EstadoDestino = deltaRojos > 0 ? 'rojo' : deltaAmbares > 0 ? 'ambar' : 'verde'
    return { mes, estado, actual: mes === actual, motivo, rojos, ambares, deltaRojos, deltaAmbares, margen: plan.margen, corte: plan.corte }
  })
}

// ── qué cambió después de mover ───────────────────────────────────────────────────

export interface ReporteMovimiento {
  proyectoId: string
  nombre: string
  mesAntes: string | null
  mesDespues: string
  corte: string
  margen: number
  cierrePisaPruebas: boolean
  rojosAntes: number
  rojosDespues: number
  ambaresAntes: number
  ambaresDespues: number
  /** Mensajes de conflictos y avisos que aparecieron con el movimiento. */
  nuevas: string[]
  /** Mensajes que había antes y ya no están. */
  resueltas: string[]
  /** Carga mensual de las personas de la cuenta, solo en los meses donde cambió. */
  cargas: Array<{ alias: string; mes: string; antes: number; despues: number; capacidad: number }>
}

export function describirMovimiento(args: {
  proyectoId: string
  proyectos: Proyecto[]
  personas: Persona[]
  antes: { asignaciones: Asignacion[]; config: Config; violaciones: Violacion[] }
  despues: { asignaciones: Asignacion[]; config: Config; violaciones: Violacion[] }
  plan: Extract<ResultadoPlan, { ok: true }>
}): ReporteMovimiento {
  const { proyectoId, proyectos, personas, antes, despues, plan } = args
  const nombre = proyectos.find(p => p.id === proyectoId)?.nombre ?? proyectoId
  const msgsAntes = new Set(antes.violaciones.filter(v => v.severidad !== 'info').map(v => v.mensaje))
  const msgsDespues = new Set(despues.violaciones.filter(v => v.severidad !== 'info').map(v => v.mensaje))

  const personasCuenta = new Set([...antes.asignaciones, ...despues.asignaciones]
    .filter(a => a.proyecto_id === proyectoId && !a.es_bloqueo).map(a => a.persona_id))
  const cargaAntes = cargaMensual(personas, antes.asignaciones, antes.config)
  const cargaDespues = cargaMensual(personas, despues.asignaciones, despues.config)
  const clave = (c: { personaId: string; mes: string }) => `${c.personaId}|${c.mes}`
  const mapaAntes = new Map(cargaAntes.map(c => [clave(c), c]))
  const mapaDespues = new Map(cargaDespues.map(c => [clave(c), c]))
  const cargas: ReporteMovimiento['cargas'] = []
  for (const k of new Set([...mapaAntes.keys(), ...mapaDespues.keys()])) {
    const [personaId, mes] = k.split('|')
    if (!personasCuenta.has(personaId)) continue
    const a = mapaAntes.get(k)?.horas ?? 0
    const d = mapaDespues.get(k)?.horas ?? 0
    if (Math.abs(a - d) < 0.5) continue
    cargas.push({
      alias: personas.find(p => p.id === personaId)?.alias ?? personaId, mes,
      antes: Math.round(a), despues: Math.round(d),
      capacidad: Math.round((mapaDespues.get(k) ?? mapaAntes.get(k))!.capacidad),
    })
  }
  cargas.sort((x, y) => (x.mes < y.mes ? -1 : x.mes > y.mes ? 1 : x.alias.localeCompare(y.alias, 'es')))

  return {
    proyectoId, nombre,
    mesAntes: mesSalidaDe(proyectoId, antes.config),
    mesDespues: mesSalidaDe(proyectoId, despues.config) ?? plan.corte.slice(0, 7),
    corte: plan.corte, margen: plan.margen, cierrePisaPruebas: plan.cierrePisaPruebas,
    rojosAntes: cuenta(antes.violaciones, 'rojo'), rojosDespues: cuenta(despues.violaciones, 'rojo'),
    ambaresAntes: cuenta(antes.violaciones, 'ambar'), ambaresDespues: cuenta(despues.violaciones, 'ambar'),
    nuevas: [...msgsDespues].filter(m => !msgsAntes.has(m)),
    resueltas: [...msgsAntes].filter(m => !msgsDespues.has(m)),
    cargas,
  }
}
