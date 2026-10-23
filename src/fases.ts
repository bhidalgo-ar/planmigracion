import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona, TipoFase } from './types'
import { horasDeBarra, horasDiaDe } from './capacidad'
import { calcularFin, diasHabiles, feriadosDeConfig, siguienteDiaHabil, toISO } from './utils/dates'

/**
 * Una barra por fase y por persona (23/10/2026, Willy: "quiero que la configuración sea una cosa,
 * las pruebas otra y el relevamiento lo mismo"). El plan v12 traía cada fase partida en tareas
 * encadenadas (Configuración eran cuatro: alta y carga base de Moni, conceptos de Willy, salidas
 * de Moni, imputación de Willy), y eso hacía imposible tocar algo a mano. Acá cada fase de armado
 * de una cuenta queda en una barra por persona, todas con las fechas de la fase y con la suma de
 * las horas que esa persona tenía en ella, y en el Timeline la fase se ve y se edita como una
 * sola cosa. Lo que se pierde es el orden de adentro de la fase; las vacaciones que caen adentro
 * son un hueco para esa persona (ver `repartoDeBarra` en `capacidad.ts`), no un conflicto.
 *
 * Se junta una sola vez: una fase que ya está en una barra por persona y sin tareas que esperen
 * a otras de la misma fase queda como está, aunque el planificador haya dejado que una persona
 * termine antes que otra. Así importar un plan exportado no lo cambia.
 *
 * La primera liquidación, la actualización final y las tareas del analista de payroll quedan
 * como están. Funciones puras: `test/fases.test.ts`.
 */

export const FASES_DE_ARMADO: readonly TipoFase[] = ['Relevamiento', 'Configuracion', 'Pruebas']

const SLUG: Record<string, string> = { Relevamiento: 'relevamiento', Configuracion: 'configuracion', Pruebas: 'pruebas' }

/** Barra de una fase de armado: relevamiento, configuración o pruebas de una cuenta, sin las del analista. */
export function esBarraDeFase(a: Asignacion): boolean {
  return !a.es_bloqueo && !!a.proyecto_id && FASES_DE_ARMADO.includes(a.tipo) && !a._fase
}

/** Horas totales de una barra: `_horas` si las trae, si no jornada × dedicación × días. */
function horasTotales(a: Asignacion, persona: Persona | undefined, config: Config): number {
  return horasDeBarra(a) ?? horasDiaDe(persona, config) * a.dedicacion_pct * Math.max(1, a.duracion_dias)
}

const red2 = (n: number) => Math.round(n * 100) / 100
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const red3 = (n: number) => Math.round(n * 1000) / 1000

/** Dedicación que hace que "Recalcular duraciones" devuelva justo `dias` para esas horas. */
function dedicacionPara(horas: number, dias: number, persona: Persona | undefined, config: Config): number {
  const hd = horasDiaDe(persona, config)
  return hd > 0 && dias > 0 ? Math.max(0.001, red3(horas / (hd * dias))) : 0
}

/**
 * Tareas de una misma fase separadas por más de estos días hábiles son dos tramos de trabajo
 * distintos y no se juntan: la corrida de relevamientos de septiembre del plan v3 y el repaso
 * de meses después juntos dejarían la cuenta abierta todo ese tiempo. En los planes v12 a v21
 * las tareas de una fase están a 9 hábiles o menos.
 */
export const SEPARACION_TRAMOS_HABILES = 15

/**
 * Junta las tareas de cada fase de armado en una barra por persona, con las fechas de la fase
 * (de cada tramo, si la fase tiene tramos separados). Una persona con una sola barra conserva
 * su id; si tenía varias, la barra nueva es `cuenta-fase-persona` (`-2`, `-3` para los tramos
 * siguientes). Una fase que ya estaba juntada no se toca (ver arriba). Las predecesoras pasan a
 * ser de fase a fase (cada barra espera a toda la fase anterior) y las de las demás barras
 * apuntan a las barras nuevas. Aplicada sobre un plan ya juntado devuelve lo mismo.
 */
export function juntarPorFase(asignaciones: Asignacion[], personas: Persona[], config: Config): Asignacion[] {
  const feriados = feriadosDeConfig(config)
  const personaDe = new Map(personas.map(p => [p.id, p]))
  const grupos = new Map<string, Asignacion[]>()
  for (const a of asignaciones) {
    if (!esBarraDeFase(a)) continue
    const k = `${a.proyecto_id}|${a.tipo}`
    const g = grupos.get(k)
    if (g) g.push(a); else grupos.set(k, [a])
  }
  if (!grupos.size) return asignaciones

  const enGrupo = new Map<string, string>()
  for (const [k, g] of grupos) for (const a of g) enGrupo.set(a.id, k)

  // Por grupo: ¿ya está juntado? Si no, sus tramos y el id nuevo de cada barra.
  interface Tramo { clave: string; inicio: string; fin: string; porId: Map<string, Asignacion[]> }
  const idNuevo = new Map<string, string>()
  const tramoDe = new Map<string, string>()
  const tramos: Tramo[] = []
  const yaJuntados = new Set<string>()
  for (const [k, g] of grupos) {
    const unaPorPersona = new Set(g.map(a => a.persona_id)).size === g.length
    if (unaPorPersona && !g.some(a => a.predecesoras.some(p => enGrupo.get(p) === k))) {
      yaJuntados.add(k)
      continue
    }
    const orden = g.slice().sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0))
    const cortes: Asignacion[][] = []
    let finMax = ''
    for (const a of orden) {
      const separada = cortes.length > 0 && a.inicio > finMax && diasHabiles(finMax, a.inicio, feriados) - 2 > SEPARACION_TRAMOS_HABILES
      if (!cortes.length || separada) cortes.push([a]); else cortes[cortes.length - 1].push(a)
      if (a.fin > finMax) finMax = a.fin
    }
    cortes.forEach((xs, ti) => {
      const clave = `${k}|${ti}`
      const porPersona = new Map<string, Asignacion[]>()
      for (const a of xs) {
        const ys = porPersona.get(a.persona_id)
        if (ys) ys.push(a); else porPersona.set(a.persona_id, [a])
      }
      const porId = new Map<string, Asignacion[]>()
      for (const [pid, ys] of porPersona) {
        const id = ys.length === 1 ? ys[0].id : `${ys[0].proyecto_id}-${SLUG[ys[0].tipo]}-${pid}${ti ? `-${ti + 1}` : ''}`
        porId.set(id, ys)
        for (const a of ys) { idNuevo.set(a.id, id); tramoDe.set(a.id, clave) }
      }
      tramos.push({
        clave, porId,
        inicio: xs.reduce((m, a) => (a.inicio < m ? a.inicio : m), xs[0].inicio),
        fin: xs.reduce((m, a) => (a.fin > m ? a.fin : m), xs[0].fin),
      })
    })
  }
  /** Predecesoras con los ids nuevos, sin las del mismo tramo (adentro de un tramo no hay orden). */
  const mapear = (ids: string[], excluirTramo?: string) => {
    const out: string[] = []
    for (const p of ids) {
      if (excluirTramo && tramoDe.get(p) === excluirTramo) continue
      const q = idNuevo.get(p) ?? p
      if (!out.includes(q)) out.push(q)
    }
    return out
  }

  const juntadas = new Map<string, Asignacion>()
  for (const tr of tramos) {
    const todas = [...tr.porId.values()].flat()
    const preds = mapear(todas.flatMap(a => a.predecesoras), tr.clave)
    const dur = diasHabiles(tr.inicio, tr.fin, feriados)
    for (const [id, xs] of tr.porId) {
      // Una barra que ya ocupa todo el tramo queda como está (salvo predecesoras).
      if (xs.length === 1 && xs[0].inicio === tr.inicio && xs[0].fin === tr.fin) {
        juntadas.set(id, sameIds(xs[0].predecesoras, preds) ? xs[0] : { ...xs[0], predecesoras: preds })
        continue
      }
      const persona = personaDe.get(xs[0].persona_id)
      const horas = red2(xs.reduce((s, a) => s + horasTotales(a, persona, config), 0))
      const plantilla = red2(xs.reduce((s, a) => s + (typeof a._horas_plantilla === 'number' ? a._horas_plantilla : horasTotales(a, persona, config)), 0))
      const barra: Asignacion = {
        ...xs[0], id, inicio: tr.inicio, fin: tr.fin, duracion_dias: dur, predecesoras: preds,
        _horas: horas, _horas_plantilla: plantilla,
        dedicacion_pct: dedicacionPara(horas, dur, persona, config),
      }
      if (xs.length > 1) delete barra._tarea
      if (xs.some(a => a.fijada)) barra.fijada = true
      else delete barra.fijada
      juntadas.set(id, barra)
    }
  }

  const out: Asignacion[] = []
  const puestas = new Set<string>()
  for (const a of asignaciones) {
    const id = idNuevo.get(a.id)
    if (id) {
      if (!puestas.has(id)) { out.push(juntadas.get(id)!); puestas.add(id) }
      continue
    }
    // Fases ya juntadas y demás barras: solo se actualizan las predecesoras que apuntaban a tareas juntadas.
    const preds = a.predecesoras.length ? mapear(a.predecesoras).filter(p => p !== a.id) : a.predecesoras
    out.push(sameIds(a.predecesoras, preds) ? a : { ...a, predecesoras: preds })
  }
  return out
}

// ── una fase de una cuenta ────────────────────────────────────────────────────────

export interface FaseDeCuenta {
  proyectoId: string
  tipo: TipoFase
  inicio: string
  fin: string
  /** Una barra por persona. */
  barras: Asignacion[]
  /** Alguna barra fijada a mano (📌). */
  fijada: boolean
}

/** Las barras de una fase de armado de una cuenta. */
export function barrasDeFase(asignaciones: Asignacion[], proyectoId: string, tipo: TipoFase): Asignacion[] {
  return asignaciones.filter(a => a.proyecto_id === proyectoId && a.tipo === tipo && esBarraDeFase(a))
}

export function faseDeCuenta(asignaciones: Asignacion[], proyectoId: string, tipo: TipoFase): FaseDeCuenta | null {
  const barras = barrasDeFase(asignaciones, proyectoId, tipo)
  if (!barras.length) return null
  return {
    proyectoId, tipo, barras,
    inicio: barras.reduce((m, a) => (a.inicio < m ? a.inicio : m), barras[0].inicio),
    fin: barras.reduce((m, a) => (a.fin > m ? a.fin : m), barras[0].fin),
    fijada: barras.some(a => !!a.fijada),
  }
}

export interface CambioDeFase {
  inicio?: string
  fin?: string
  /** Horas por persona (id → horas). Las que no vienen quedan como estaban. */
  horas?: Record<string, number>
  /** 📌: la fase conserva su duración cuando se rearma el calendario. */
  fijada?: boolean
}

/** El día `iso` si es hábil; si no, el hábil siguiente. */
function alHabil(iso: string, feriados: ReadonlySet<string>): string {
  const d = parseISO(iso), dow = d.getDay()
  return dow !== 0 && dow !== 6 && !feriados.has(iso) ? iso : siguienteDiaHabil(iso, feriados)
}

/**
 * Edita una fase entera: todas sus barras pasan a las fechas nuevas (mismas para todos) y, si
 * vienen, a las horas nuevas. Lo que no viene en el cambio queda igual. La dedicación se
 * recalcula para que "Recalcular duraciones" no deshaga los días.
 */
export function editarFase(
  asignaciones: Asignacion[], proyectoId: string, tipo: TipoFase, cambio: CambioDeFase,
  personas: Persona[], config: Config,
): Asignacion[] {
  const f = faseDeCuenta(asignaciones, proyectoId, tipo)
  if (!f) return asignaciones
  const feriados = feriadosDeConfig(config)
  const personaDe = new Map(personas.map(p => [p.id, p]))
  const inicio = alHabil(cambio.inicio ?? f.inicio, feriados)
  let fin = cambio.fin ?? f.fin
  if (fin < inicio) fin = inicio
  const dur = diasHabiles(inicio, fin, feriados)
  fin = calcularFin(inicio, dur, feriados)
  const ids = new Set(f.barras.map(b => b.id))
  return asignaciones.map(a => {
    if (!ids.has(a.id)) return a
    const persona = personaDe.get(a.persona_id)
    const antes = horasTotales(a, persona, config)
    const horas = cambio.horas && a.persona_id in cambio.horas ? red2(cambio.horas[a.persona_id]) : antes
    const out: Asignacion = { ...a, inicio, fin, duracion_dias: dur, _horas: horas, dedicacion_pct: dedicacionPara(horas, dur, persona, config) }
    // La primera vez que se reparte a mano se guarda lo que traía, para poder volver a "Como la plantilla".
    if (typeof a._horas_plantilla !== 'number' && Math.abs(horas - antes) > 0.005) out._horas_plantilla = red2(antes)
    if (cambio.fijada === true) out.fijada = true
    else if (cambio.fijada === false) delete out.fijada
    return out
  })
}

/** Mueve una fase entera `dias` días corridos (cae siempre en un hábil). No cambia duración ni horas. */
export function moverFase(
  asignaciones: Asignacion[], proyectoId: string, tipo: TipoFase, dias: number, config: Config,
): Asignacion[] {
  const f = faseDeCuenta(asignaciones, proyectoId, tipo)
  if (!f || !dias) return asignaciones
  const feriados = feriadosDeConfig(config)
  const ids = new Set(f.barras.map(b => b.id))
  return asignaciones.map(a => {
    if (!ids.has(a.id)) return a
    const inicio = alHabil(toISO(addDays(parseISO(a.inicio), dias)), feriados)
    return { ...a, inicio, fin: calcularFin(inicio, a.duracion_dias, feriados) }
  })
}

// ── reparto de horas entre las personas de una fase ───────────────────────────────

/** Horas de cada persona en la fase (id → horas). */
export function horasPorPersona(f: FaseDeCuenta, personas: Persona[], config: Config): Record<string, number> {
  const personaDe = new Map(personas.map(p => [p.id, p]))
  return Object.fromEntries(f.barras.map(b => [b.persona_id, red2(horasTotales(b, personaDe.get(b.persona_id), config))]))
}

const total = (h: Record<string, number>) => Object.values(h).reduce((s, x) => s + x, 0)

/** El reparto de la plantilla con el total de hoy: cada uno su proporción de `_horas_plantilla`. */
export function repartoPlantilla(f: FaseDeCuenta, actual: Record<string, number>): Record<string, number> {
  const base = Object.fromEntries(f.barras.map(b => [b.persona_id, typeof b._horas_plantilla === 'number' ? b._horas_plantilla : actual[b.persona_id] ?? 0]))
  const tb = total(base), ta = total(actual)
  if (!(tb > 0)) return { ...actual }
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, red2((v / tb) * ta)]))
}

/** Mitad y mitad (o partes iguales si son más de dos), con el mismo total. */
export function repartoParejo(actual: Record<string, number>): Record<string, number> {
  const ks = Object.keys(actual)
  const t = total(actual)
  return Object.fromEntries(ks.map(k => [k, red2(t / Math.max(1, ks.length))]))
}

/**
 * A mano: una persona pasa a `horas` y el resto se ajusta en proporción a lo que tenía, así el
 * total de la fase no cambia. Nunca da negativo ni más que el total.
 */
export function repartoAMano(actual: Record<string, number>, personaId: string, horas: number): Record<string, number> {
  const t = total(actual)
  const h = Math.max(0, Math.min(t, horas))
  const otros = Object.keys(actual).filter(k => k !== personaId)
  if (!otros.length) return { ...actual }
  const resto = t - h
  const baseOtros = otros.reduce((s, k) => s + actual[k], 0)
  const out: Record<string, number> = { [personaId]: red2(h) }
  for (const k of otros) out[k] = red2(baseOtros > 0 ? (actual[k] / baseOtros) * resto : resto / otros.length)
  return out
}
