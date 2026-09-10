import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { addDays, addWeeks, differenceInDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, RolPersona, TipoFase, Violacion } from './types'
import {
  calcularFin, calcularFinPorHoras, feriadosDeConfig, getMondayOfWeek,
  seSuperponen, siguienteDiaHabil, toISO,
} from './utils/dates'
import { computeViolaciones as _computeViolaciones } from './rules'
import { ORDEN_FASES } from './theme/fases'
import personasRaw from '../data/personas.json'
import proyectosRaw from '../data/proyectos.json'
import asignacionesRaw from '../data/asignaciones.json'
import configRaw from '../data/config.json'



const seedPersonas = personasRaw.personas as Persona[]
const seedProyectos = proyectosRaw.proyectos as Proyecto[]
const seedAsignaciones = asignacionesRaw.asignaciones as Asignacion[]
const seedConfig = configRaw as unknown as Config

/**
 * Completa con las del seed las claves de `config` que no existían todavía cuando
 * se guardó ese plan (localStorage de una versión vieja de la app, o un JSON
 * exportado antes de agregarlas). La usan `migrate` (planes ya persistidos) e
 * `importarJSON` (planes exportados): mismo problema, misma solución.
 */
function conFallbackDeSeed(config: Partial<Config> | undefined): Config {
  const c = config ?? {}
  return {
    ...c,
    horas_por_fase: c.horas_por_fase ?? seedConfig.horas_por_fase,
    disponibilidad: c.disponibilidad ?? seedConfig.disponibilidad,
    template_estandar: c.template_estandar ?? seedConfig.template_estandar,
    cartera_legacy_axton: c.cartera_legacy_axton ?? seedConfig.cartera_legacy_axton,
    // Capa de calendario y capacidad (plan v3). `equipo_confidencial` NO se rellena
    // nunca: si el plan importado no lo trae, no existe (brief 10/09/2026 §3.3).
    salidas_en_vivo_propuestas: c.salidas_en_vivo_propuestas ?? seedConfig.salidas_en_vivo_propuestas,
    cortes_novedades_dia: c.cortes_novedades_dia ?? seedConfig.cortes_novedades_dia,
    salidas_en_vivo_fuera_del_plan: c.salidas_en_vivo_fuera_del_plan ?? seedConfig.salidas_en_vivo_fuera_del_plan,
    tiers_v3: c.tiers_v3 ?? seedConfig.tiers_v3,
    reglas_calendario: c.reglas_calendario ?? seedConfig.reglas_calendario,
    capacidad: c.capacidad ?? seedConfig.capacidad,
    insumos: c.insumos ?? seedConfig.insumos,
  } as Config
}

// ---------- helpers ----------

/** alias → id seguro (sin acentos, sin espacios). Garantiza unicidad contra los ya usados. */
function slugUnico(texto: string, existentes: Set<string>): string {
  const base = texto
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item'
  let id = base
  let n = 2
  while (existentes.has(id)) id = `${base}_${n++}`
  return id
}

/**
 * Candidatos para una fase: los que la tienen como rol explícito MÁS los que la tienen
 * como skill (NO inventa clasificación: usa lo que el dataset ya tiene). Antes se cortaba
 * en el primer match de rol, y como Axton es el único con `rol: 'configuracion'`, toda
 * cuenta nueva le caía a él. Ahora compiten y gana el que termina antes (ver `pickPersona`).
 */
function candidatosPara(personas: Persona[], tipo: TipoFase): Persona[] {
  const rolDe: Partial<Record<TipoFase, RolPersona>> = {
    Relevamiento: 'relevamiento', Configuracion: 'configuracion', Pruebas: 'pruebas',
  }
  const skillDe: Partial<Record<TipoFase, string[]>> = {
    Relevamiento: ['relevamiento'], Configuracion: ['configuracion'], Pruebas: ['pruebas', 'testeo'],
  }
  const skills = skillDe[tipo] ?? []
  const out: Persona[] = personas.filter(p => p.rol && p.rol === rolDe[tipo])
  for (const p of personas) {
    if (out.some(q => q.id === p.id)) continue
    if (p.skills?.some(s => skills.includes(s))) out.push(p)
  }
  return out.length ? out : personas.slice(0, 1)
}

/**
 * Lunes de la semana siguiente al fin de una fase (ISO). Solo lo usa el alta de TASA:
 * es un proyecto especial cuyo encadenado no se toca. Las cuentas estándar encadenan con
 * `siguienteDiaHabil` (ver `inicioDeFase`).
 */
function siguienteLunes(finISO: string): string {
  return toISO(addWeeks(getMondayOfWeek(parseISO(finISO)), 1))
}

/** Horas de esfuerzo de una fase según el tipo de cuenta. null = fase sin horas en la tabla. */
function horasDeFase(config: Config, proyecto: Proyecto | null | undefined, tipo: TipoFase): number | null {
  const tabla = config.horas_por_fase ?? seedConfig.horas_por_fase
  if (!tabla) return null
  // Cuenta chica = <10 empleados. Criterio del dato, no del código: complejidad 'baja'.
  const esChica = proyecto?.complejidad === 'baja'
  const horas = (esChica ? tabla.chica : tabla.estandar)?.[tipo]
  return typeof horas === 'number' ? horas : null
}

/** Duración/fin/dedicación de una fase: por horas si la fase tiene horas, si no por días. */
function medirFase(
  inicio: string, horas: number | null, personaId: string, config: Config, feriados: ReadonlySet<string>,
): { fin: string; duracion_dias: number; dedicacion_pct: number } {
  if (horas == null) {
    const dur = DIAS_SIN_HORAS
    return { fin: calcularFin(inicio, dur, feriados), duracion_dias: dur, dedicacion_pct: 1 }
  }
  const r = calcularFinPorHoras(inicio, horas, personaId, config, feriados)
  return { fin: r.fin, duracion_dias: r.duracion_dias, dedicacion_pct: r.dedicacion_promedio }
}

/** Días de una fase que no está en la tabla de horas (ej. Vacaciones). */
const DIAS_SIN_HORAS = 10

/**
 * Inicio de una fase encadenada detrás de su predecesora.
 *
 * Configuración arranca al día hábil siguiente del INICIO del Relevamiento (el solapamiento
 * de 6 días medido en el tablero: BP1 estructural solo necesita el Checklist Inicial), pero
 * solo si las hace gente distinta. Si es la misma persona no puede estar en las dos a la vez:
 * arranca al día hábil siguiente del FIN. Pruebas siempre va después del fin de Configuración.
 */
function inicioDeFase(
  tipo: TipoFase, pred: Asignacion | null, personaId: string, feriados: ReadonlySet<string>,
): string | null {
  if (!pred) return null
  const solapa = tipo === 'Configuracion' && pred.tipo === 'Relevamiento' && pred.persona_id !== personaId
  return siguienteDiaHabil(solapa ? pred.inicio : pred.fin, feriados)
}

/** Orden canónico de fases dentro de una cuenta (para el respaldo de la cascada). */
const ORDEN_TIPO: Record<string, number> = {
  Relevamiento: 0, Configuracion: 1, Pruebas: 2, Vacaciones: 3,
}

/**
 * Fases que se mueven junto con `id` en modo estricto: la fase arrastrada + todas
 * las POSTERIORES de la misma cuenta. Nunca las anteriores (mover Configuración
 * arrastra Pruebas, pero deja Relevamiento donde está).
 *
 * Primero sigue el grafo de dependencias (predecesoras); además, como respaldo,
 * suma las fases de la misma cuenta con orden de fase mayor, para que también
 * funcione en cuentas cuyas fases se crearon sueltas (sin predecesoras).
 */
export function cascadaIds(asignaciones: Asignacion[], id: string): Set<string> {
  const out = new Set<string>([id])
  const base = asignaciones.find(a => a.id === id)
  if (!base) return out

  const mismaCuenta = asignaciones.filter(
    a => !a.es_bloqueo && a.proyecto_id != null && a.proyecto_id === base.proyecto_id,
  )

  // 1) sucesoras por dependencias declaradas (transitivas)
  let cambio = true
  while (cambio) {
    cambio = false
    for (const a of mismaCuenta) {
      if (out.has(a.id)) continue
      if (a.predecesoras.some(p => out.has(p))) { out.add(a.id); cambio = true }
    }
  }

  // 2) respaldo por orden de fase
  const ordenBase = ORDEN_TIPO[base.tipo] ?? 0
  for (const a of mismaCuenta) {
    if (out.has(a.id)) continue
    const orden = ORDEN_TIPO[a.tipo] ?? 0
    if (orden > ordenBase || (orden === ordenBase && a.inicio > base.inicio)) out.add(a.id)
  }

  return out
}

interface Hueco {
  inicio: string
  fin: string
  duracion_dias: number
  dedicacion_pct: number
}

/**
 * Primer hueco desde `inicioMinISO` donde `personaId` no choca con otra ocupación.
 *
 * Cuenta como ocupación cualquier fase de OTRA cuenta y también los BLOQUEOS (aunque sean
 * de la misma cuenta): un bloqueo es tiempo reservado, no una fase que pueda solaparse. Sin
 * eso, el bloqueo de supervisión de TASA no bloqueaba nada. Las fases de la MISMA cuenta sí
 * pueden solaparse: es el solapamiento relevamiento/configuración que existe en el tablero.
 *
 * La duración se recalcula en cada intento porque depende de la fecha: al correr el inicio
 * puede cruzar el fin de año y cambiar la disponibilidad de la persona.
 */
function buscarHueco(
  ocupadas: Asignacion[],
  personaId: string,
  proyectoId: string | null,
  inicioMinISO: string,
  horas: number | null,
  config: Config,
  feriados: ReadonlySet<string>,
): Hueco {
  let inicio = inicioMinISO
  for (let i = 0; i < 200; i++) {
    const medida = medirFase(inicio, horas, personaId, config, feriados)
    const conflicto = ocupadas.find(a =>
      a.persona_id === personaId && (a.es_bloqueo || a.proyecto_id !== proyectoId) &&
      seSuperponen(a.inicio, a.fin, inicio, medida.fin),
    )
    if (!conflicto) return { inicio, ...medida }
    inicio = siguienteDiaHabil(conflicto.fin, feriados)
  }
  return { inicio, ...medirFase(inicio, horas, personaId, config, feriados) }
}

/**
 * Elige quién hace una fase: entre los candidatos por rol o skill, el que la TERMINA ANTES
 * con su propia disponibilidad y sus propios huecos. Empate: el que tiene menos días
 * asignados. `minInicioDe` se evalúa por candidato porque el encadenado depende de quién
 * sea (una Configuración puede solapar el Relevamiento solo si la hace otra persona).
 */
function pickPersona(
  personas: Persona[],
  tipo: TipoFase,
  ocupadas: Asignacion[],
  proyectoId: string | null,
  minInicioDe: (personaId: string) => string,
  horas: number | null,
  config: Config,
  feriados: ReadonlySet<string>,
): { persona_id: string } & Hueco {
  const candidatos = candidatosPara(personas, tipo)
  const diasAsignados = (id: string) => ocupadas
    .filter(a => a.persona_id === id && !a.es_bloqueo)
    .reduce((s, a) => s + a.duracion_dias, 0)

  let mejor: ({ persona_id: string } & Hueco) | null = null
  let mejorDias = 0
  for (const p of candidatos) {
    const hueco = buscarHueco(ocupadas, p.id, proyectoId, minInicioDe(p.id), horas, config, feriados)
    const dias = diasAsignados(p.id)
    if (!mejor || hueco.fin < mejor.fin || (hueco.fin === mejor.fin && dias < mejorDias)) {
      mejor = { persona_id: p.id, ...hueco }
      mejorDias = dias
    }
  }
  return mejor ?? {
    persona_id: personas[0]?.id ?? '',
    ...buscarHueco(ocupadas, personas[0]?.id ?? '', proyectoId, minInicioDe(personas[0]?.id ?? ''), horas, config, feriados),
  }
}

export interface RecalculoReporte {
  /** Fases cuya duración se recalculó. */
  recalculadas: number
  /** Fases cuya duración efectivamente cambió, con los días de antes y de después. */
  cambiadas: Array<{ id: string; diasAntes: number; diasDespues: number }>
  /** Fases que quedaron afuera: bloqueos y proyectos especiales (TASA). */
  intactas: number
  /** Conflictos en rojo que quedan para resolver a mano moviendo barras. */
  conflictos: number
}

interface HistorySnapshot {
  personas: Persona[]
  proyectos: Proyecto[]
  asignaciones: Asignacion[]
  config: Config
}
const MAX_HISTORIAL = 50

/** Snapshot previo al cambio, para poder deshacer (Ctrl+Z). Se calcula ANTES de mutar. */
function conHistorial(state: SimuladorState): Pick<SimuladorState, 'historial'> {
  const snap: HistorySnapshot = {
    personas: state.personas, proyectos: state.proyectos,
    asignaciones: state.asignaciones, config: state.config,
  }
  return { historial: [...state.historial.slice(-(MAX_HISTORIAL - 1)), snap] }
}

interface SimuladorState {
  personas: Persona[]
  proyectos: Proyecto[]
  asignaciones: Asignacion[]
  config: Config
  violaciones: Violacion[]
  clienteSeleccionado: string | null
  /** Snapshots previos para Ctrl+Z. No se persiste (se pierde al recargar la página). */
  historial: HistorySnapshot[]

  updateAsignacion: (id: string, patch: Partial<Asignacion>) => void
  addFase: (proyectoId: string, tipo: TipoFase, personaId: string) => void
  updateConfigFecha: (key: 'transicion_susana_toyota' | 'retro_ready_axton', value: string | null) => void
  seleccionarCliente: (proyectoId: string | null) => void
  shiftAccount: (proyectoId: string, semanas: number) => void
  addPersona: (alias: string, rol: RolPersona | null) => void
  removePersona: (id: string, force?: boolean) => { ok: boolean; motivo?: string }
  renamePersona: (id: string, alias: string) => void
  addProyecto: (nombre: string, inicio: string) => string
  removeProyecto: (id: string) => void
  renameProyecto: (id: string, nombre: string) => void
  clearAsignaciones: () => void
  shiftAccountDias: (proyectoId: string, dias: number) => void
  shiftCascadaDias: (asignacionId: string, dias: number, nuevaPersona?: string) => void
  /** Deshace el último cambio de datos (no las acciones de solo-UI como seleccionar cuenta). */
  undo: () => void
  /**
   * Completa las cuentas sin ninguna fase (o a las que les falta alguna) encadenando
   * Relevamiento → Configuración → Pruebas con la persona de rol/skill correspondiente,
   * buscando el primer hueco libre para que no dispare Regla 2. No toca cuentas ya completas
   * ni TASA/Toyota (esa se planifica con la perilla "Inicio Toyota").
   */
  autoPlanificarPendientes: () => { creadas: number }
  /**
   * Recalcula duración y fin de TODAS las fases ya planificadas con las horas de la fase
   * y la disponibilidad de la persona que la tiene asignada. NO reasigna personas ni
   * reordena cuentas: el reparto manual se respeta tal cual está.
   */
  recalcularDuraciones: () => RecalculoReporte
  resetToSeed: () => void
  exportarJSON: () => string
  importarJSON: (json: string) => void
}

function recompute(
  asignaciones: Asignacion[],
  personas: Persona[],
  config: Config,
  proyectos: Proyecto[],
): Violacion[] {
  return _computeViolaciones(asignaciones, personas, config, proyectos)
}

export const useSimuladorStore = create<SimuladorState>()(
  persist(
    (set, get) => ({
      personas: seedPersonas,
      proyectos: seedProyectos,
      asignaciones: seedAsignaciones,
      config: seedConfig,
      violaciones: recompute(seedAsignaciones, seedPersonas, seedConfig, seedProyectos),
      clienteSeleccionado: null,
      historial: [],

      updateAsignacion(id, patch) {
        set(state => {
          const feriados = feriadosDeConfig(state.config)
          const asignaciones = state.asignaciones.map(a => {
            if (a.id !== id) return a
            const updated = { ...a, ...patch }
            if ('duracion_dias' in patch || 'inicio' in patch) {
              updated.fin = calcularFin(updated.inicio, updated.duracion_dias, feriados)
            }
            return updated
          })
          return {
            ...conHistorial(state),
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, state.config, state.proyectos),
          }
        })
      },

      // Planifica una fase suelta (Relev/Config/Pruebas) de una cuenta eligiendo quién la hace.
      // Encadena con la fase anterior si ya existe (no rompe R3); si es la primera, arranca
      // en el lunes de hoy (o el inicio del horizonte, lo que sea más tarde).
      addFase(proyectoId, tipo, personaId) {
        set(state => {
          const existing = state.asignaciones.filter(a => a.proyecto_id === proyectoId && !a.es_bloqueo)
          if (existing.some(a => a.tipo === tipo)) return {} // ya planificada
          const feriados = feriadosDeConfig(state.config)
          const proyecto = state.proyectos.find(p => p.id === proyectoId) ?? null
          const horas = horasDeFase(state.config, proyecto, tipo)

          const predTipo: Record<string, TipoFase | null> = {
            Relevamiento: null, Configuracion: 'Relevamiento', Pruebas: 'Configuracion',
          }
          const pred = predTipo[tipo] ? existing.find(a => a.tipo === predTipo[tipo]) ?? null : null

          let inicio: string
          const encadenado = inicioDeFase(tipo, pred, personaId, feriados)
          if (encadenado) {
            inicio = encadenado
          } else {
            const hoyMonday = getMondayOfWeek(new Date())
            const horizMonday = getMondayOfWeek(parseISO(state.config.horizonte.desde))
            inicio = toISO(hoyMonday > horizMonday ? hoyMonday : horizMonday)
          }
          const medida = medirFase(inicio, horas, personaId, state.config, feriados)

          const sufijo: Record<string, string> = { Relevamiento: 'relev', Configuracion: 'config', Pruebas: 'pruebas' }
          const idsExist = new Set(state.asignaciones.map(a => a.id))
          let id = `${proyectoId}-${sufijo[tipo] ?? 'fase'}`
          let n = 2
          while (idsExist.has(id)) id = `${proyectoId}-${sufijo[tipo] ?? 'fase'}_${n++}`

          const nueva: Asignacion = {
            id,
            proyecto_id: proyectoId,
            tipo,
            persona_id: personaId,
            inicio,
            fin: medida.fin,
            duracion_dias: medida.duracion_dias,
            dedicacion_pct: medida.dedicacion_pct,
            predecesoras: pred ? [pred.id] : [],
            es_bloqueo: false,
          }
          const asignaciones = [...state.asignaciones, nueva]
          return {
            ...conHistorial(state),
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, state.config, state.proyectos),
          }
        })
      },

      updateConfigFecha(key, value) {
        set(state => {
          const feriados = feriadosDeConfig(state.config)
          const config: Config = {
            ...state.config,
            fechas_clave: { ...state.config.fechas_clave, [key]: value },
          }

          let asignaciones = state.asignaciones

          // "Inicio Toyota" gobierna las fases de TASA:
          //  - TASA sin fases  → auto-crear Relev(lau 4m) → Config(axton 4m) → Pruebas(lau 2m)
          //  - TASA ya planificada → mover el bloque entero para que arranque en la nueva fecha
          if (key === 'transicion_susana_toyota' && value) {
            const targetInicio = toISO(getMondayOfWeek(parseISO(value)))
            const tasaFases = state.asignaciones.filter(a => a.proyecto_id === 'tasa' && !a.es_bloqueo)

            if (tasaFases.length === 0) {
              const relevInicio = targetInicio
              const relevFin    = calcularFin(relevInicio, 88, feriados)
              const configInicio = siguienteLunes(relevFin)
              const configFin   = calcularFin(configInicio, 88, feriados)
              const pruebasInicio = siguienteLunes(configFin)
              const pruebasFin  = calcularFin(pruebasInicio, 44, feriados)

              const mk = (
                sufijo: string, tipo: TipoFase, ini: string, fin: string, dur: number, preds: string[],
              ): Asignacion => ({
                id: `tasa-${sufijo}`,
                proyecto_id: 'tasa',
                tipo,
                // Configuración de TASA la ejecuta Axton; Lau releva y prueba.
                persona_id: sufijo === 'config' ? 'axton' : 'lau',
                inicio: ini, fin, duracion_dias: dur,
                dedicacion_pct: 1, predecesoras: preds, es_bloqueo: false,
              })

              const nuevas: Asignacion[] = [
                mk('relev',   'Relevamiento',  relevInicio,   relevFin,   88, []),
                mk('config',  'Configuracion', configInicio,  configFin,  88, ['tasa-relev']),
                mk('pruebas', 'Pruebas',       pruebasInicio, pruebasFin, 44, ['tasa-config']),
              ]
              asignaciones = [...state.asignaciones, ...nuevas]
            } else {
              // Desplazar TODAS las fases de TASA para que la más temprana arranque en targetInicio.
              const earliest = tasaFases.reduce((m, a) => (a.inicio < m ? a.inicio : m), tasaFases[0].inicio)
              const delta = differenceInDays(parseISO(targetInicio), parseISO(earliest))
              if (delta !== 0) {
                asignaciones = state.asignaciones.map(a => {
                  if (a.proyecto_id !== 'tasa') return a
                  const inicio = toISO(addDays(parseISO(a.inicio), delta))
                  return { ...a, inicio, fin: calcularFin(inicio, a.duracion_dias, feriados) }
                })
              }
            }
          }

          return {
            ...conHistorial(state),
            config,
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, config, state.proyectos),
          }
        })
      },

      seleccionarCliente(proyectoId) {
        set({ clienteSeleccionado: proyectoId })
      },

      // Mueve TODAS las fases de una cuenta N semanas (±), recalculando fin por días hábiles.
      // Clampea para no salir antes del inicio del horizonte. Recalcula reglas una sola vez.
      shiftAccount(proyectoId, semanas) {
        set(state => {
          const projAsigs = state.asignaciones.filter(a => a.proyecto_id === proyectoId)
          if (projAsigs.length === 0) return {}
          let dias = semanas * 7
          if (dias < 0) {
            const earliest = projAsigs.reduce((m, a) => (a.inicio < m ? a.inicio : m), projAsigs[0].inicio)
            const earliestMonday = getMondayOfWeek(parseISO(earliest))
            const desdeMonday = getMondayOfWeek(parseISO(state.config.horizonte.desde))
            // maxLeftDias <= 0 normalmente; Math.min(0, …) evita que una fase ya anterior
            // al horizonte invierta el signo del desplazamiento.
            const maxLeftDias = Math.min(0, Math.round((desdeMonday.getTime() - earliestMonday.getTime()) / 86400000))
            dias = Math.max(dias, maxLeftDias) // no pasar de la semana 0
          }
          if (dias === 0) return {}
          const feriados = feriadosDeConfig(state.config)
          const asignaciones = state.asignaciones.map(a => {
            if (a.proyecto_id !== proyectoId) return a
            const inicio = toISO(addDays(parseISO(a.inicio), dias))
            return { ...a, inicio, fin: calcularFin(inicio, a.duracion_dias, feriados) }
          })
          return {
            ...conHistorial(state),
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, state.config, state.proyectos),
          }
        })
      },

      // Alta de recurso: SOLO alias + rol (enum). Nunca nombres reales/PII (regla dura CLAUDE.md §5).
      addPersona(alias, rol) {
        const aliasLimpio = alias.trim()
        if (!aliasLimpio) return
        set(state => {
          const ids = new Set(state.personas.map(p => p.id))
          const persona: Persona = {
            id: slugUnico(aliasLimpio, ids),
            alias: aliasLimpio,
            skills: [],
            rol: rol ?? null,
            capacidad_horas_semana: 40,
            buffer_pct: 0,
            custom: true,
          }
          return { ...conHistorial(state), personas: [...state.personas, persona] }
        })
      },

      // Sin force: no permite borrar a alguien con fases asignadas (pide reasignar primero).
      // Con force: elimina también todas sus fases (acción destructiva, confirmada en la UI).
      removePersona(id, force = false) {
        const enUso = get().asignaciones.some(a => a.persona_id === id)
        if (enUso && !force) return { ok: false, motivo: 'Tiene fases asignadas; reasignalas o eliminá la persona con sus fases.' }
        set(state => {
          const personas = state.personas.filter(p => p.id !== id)
          const asignaciones = force ? state.asignaciones.filter(a => a.persona_id !== id) : state.asignaciones
          return {
            ...conHistorial(state),
            personas,
            asignaciones,
            violaciones: recompute(asignaciones, personas, state.config, state.proyectos),
          }
        })
        return { ok: true }
      },

      // Renombra el alias visible. El id se mantiene estable (no rompe asignaciones ni reglas).
      renamePersona(id, alias) {
        const aliasLimpio = alias.trim()
        if (!aliasLimpio) return
        set(state => ({
          ...conHistorial(state),
          personas: state.personas.map(p => (p.id === id ? { ...p, alias: aliasLimpio } : p)),
        }))
      },

      // Crea una cuenta + 3 fases encadenadas (Relev→Config→Pruebas) autoasignadas por rol/skill.
      // Respeta los null del dataset: complejidad y depende_retro quedan sin definir.
      addProyecto(nombre, inicio) {
        const nombreLimpio = nombre.trim()
        const inicioMonday = toISO(getMondayOfWeek(parseISO(inicio)))
        let nuevoId = ''
        set(state => {
          const feriados = feriadosDeConfig(state.config)
          const idsP = new Set(state.proyectos.map(p => p.id))
          const pid = slugUnico(nombreLimpio || 'cuenta', idsP)
          nuevoId = pid
          const proyecto: Proyecto = {
            id: pid,
            nombre: nombreLimpio || pid,
            complejidad: null,
            depende_retro: null,
            entidades: 1,
            quick_win: false,
            especial: false,
            custom: true,
          }

          // Cada fase: quién la hace (el que termine antes) y cuánto le lleva con SU
          // disponibilidad. Configuración solapa el arranque del Relevamiento si la hace
          // otra persona; Pruebas siempre después del fin de Configuración.
          const sufijos: Array<[string, TipoFase]> = [
            ['relev', 'Relevamiento'], ['config', 'Configuracion'], ['pruebas', 'Pruebas'],
          ]
          const nuevas: Asignacion[] = []
          let pred: Asignacion | null = null
          for (const [sufijo, tipo] of sufijos) {
            const horas = horasDeFase(state.config, proyecto, tipo)
            const ocupadas = [...state.asignaciones, ...nuevas]
            const predFijo = pred
            const elegido = pickPersona(
              state.personas, tipo, ocupadas, pid,
              personaId => inicioDeFase(tipo, predFijo, personaId, feriados) ?? inicioMonday,
              horas, state.config, feriados,
            )
            const nueva: Asignacion = {
              id: `${pid}-${sufijo}`,
              proyecto_id: pid,
              tipo,
              persona_id: elegido.persona_id,
              inicio: elegido.inicio,
              fin: elegido.fin,
              duracion_dias: elegido.duracion_dias,
              dedicacion_pct: elegido.dedicacion_pct,
              predecesoras: pred ? [pred.id] : [],
              es_bloqueo: false,
            }
            nuevas.push(nueva)
            pred = nueva
          }

          const proyectos = [...state.proyectos, proyecto]
          const asignaciones = [...state.asignaciones, ...nuevas]
          return {
            ...conHistorial(state),
            proyectos,
            asignaciones,
            clienteSeleccionado: pid,
            violaciones: recompute(asignaciones, state.personas, state.config, proyectos),
          }
        })
        return nuevoId
      },

      // Elimina una cuenta y TODAS sus fases. Si era la seleccionada, limpia la selección.
      removeProyecto(id) {
        set(state => {
          const proyectos = state.proyectos.filter(p => p.id !== id)
          const asignaciones = state.asignaciones.filter(a => a.proyecto_id !== id)
          return {
            ...conHistorial(state),
            proyectos,
            asignaciones,
            clienteSeleccionado: state.clienteSeleccionado === id ? null : state.clienteSeleccionado,
            violaciones: recompute(asignaciones, state.personas, state.config, proyectos),
          }
        })
      },

      // Renombra el nombre comercial de la cuenta. El id se mantiene estable.
      renameProyecto(id, nombre) {
        const nombreLimpio = nombre.trim()
        if (!nombreLimpio) return
        set(state => ({
          ...conHistorial(state),
          proyectos: state.proyectos.map(p => (p.id === id ? { ...p, nombre: nombreLimpio } : p)),
        }))
      },

      // Mueve una cuenta N días calendario (permite sub-semana en zoom días).
      shiftAccountDias(proyectoId, dias) {
        set(state => {
          const projAsigs = state.asignaciones.filter(a => a.proyecto_id === proyectoId)
          if (projAsigs.length === 0 || dias === 0) return {}
          const horizonStart = parseISO(state.config.horizonte.desde)
          const earliest = projAsigs.reduce((m, a) => a.inicio < m ? a.inicio : m, projAsigs[0].inicio)
          const daysFromHorizon = differenceInDays(parseISO(earliest), horizonStart)
          const clamped = Math.max(dias, -daysFromHorizon)
          if (clamped === 0) return {}
          const feriados = feriadosDeConfig(state.config)
          const asignaciones = state.asignaciones.map(a => {
            if (a.proyecto_id !== proyectoId) return a
            const inicio = toISO(addDays(parseISO(a.inicio), clamped))
            return { ...a, inicio, fin: calcularFin(inicio, a.duracion_dias, feriados) }
          })
          return {
            ...conHistorial(state),
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, state.config, state.proyectos),
          }
        })
      },

      // Modo estricto: mueve la fase arrastrada + las fases POSTERIORES de la misma
      // cuenta (nunca las anteriores). Opcionalmente reasigna la persona de la fase
      // arrastrada, que es la única que cambia de fila al arrastrar en vertical.
      shiftCascadaDias(asignacionId, dias, nuevaPersona) {
        set(state => {
          const ids = cascadaIds(state.asignaciones, asignacionId)
          const afectadas = state.asignaciones.filter(a => ids.has(a.id))
          if (afectadas.length === 0) return {}
          const horizonStart = parseISO(state.config.horizonte.desde)
          const earliest = afectadas.reduce((m, a) => (a.inicio < m ? a.inicio : m), afectadas[0].inicio)
          const clamped = Math.max(dias, -differenceInDays(parseISO(earliest), horizonStart))
          const cambiaPersona = !!nuevaPersona &&
            nuevaPersona !== state.asignaciones.find(a => a.id === asignacionId)?.persona_id
          if (clamped === 0 && !cambiaPersona) return {}

          const feriados = feriadosDeConfig(state.config)
          const asignaciones = state.asignaciones.map(a => {
            if (!ids.has(a.id)) return a
            let next = a
            if (clamped !== 0) {
              const inicio = toISO(addDays(parseISO(a.inicio), clamped))
              next = { ...next, inicio, fin: calcularFin(inicio, a.duracion_dias, feriados) }
            }
            if (a.id === asignacionId && cambiaPersona) next = { ...next, persona_id: nuevaPersona! }
            return next
          })
          return {
            ...conHistorial(state),
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, state.config, state.proyectos),
          }
        })
      },

      // Deshace el último cambio de datos. No hay "rehacer": es un historial lineal simple.
      undo() {
        set(state => {
          if (state.historial.length === 0) return {}
          const prev = state.historial[state.historial.length - 1]
          const historial = state.historial.slice(0, -1)
          return {
            historial,
            personas: prev.personas,
            proyectos: prev.proyectos,
            asignaciones: prev.asignaciones,
            config: prev.config,
            violaciones: recompute(prev.asignaciones, prev.personas, prev.config, prev.proyectos),
          }
        })
      },

      // Completa cuentas sin planificar (o con alguna fase faltante) encadenando
      // Relev→Config→Pruebas con la persona de rol/skill correspondiente, buscando
      // el primer hueco libre de esa persona para no generar Regla 2.
      autoPlanificarPendientes() {
        let creadas = 0
        set(state => {
          const feriados = feriadosDeConfig(state.config)
          const horizMonday = getMondayOfWeek(parseISO(state.config.horizonte.desde))
          const hoyMonday = getMondayOfWeek(new Date())
          const baseInicio = toISO(hoyMonday > horizMonday ? hoyMonday : horizMonday)
          const sufijo: Record<string, string> = { Relevamiento: 'relev', Configuracion: 'config', Pruebas: 'pruebas' }

          let asignaciones = state.asignaciones
          const idsExist = new Set(asignaciones.map(a => a.id))

          for (const proyecto of state.proyectos) {
            // TASA/Toyota tiene su propio alta (4m/4m/2m con Susi/Lau) atada a la perilla
            // "Inicio Toyota"; no generarle fases genéricas acá o esa perilla deja de crearlas.
            if (proyecto.especial) continue
            let propias = asignaciones.filter(a => a.proyecto_id === proyecto.id && !a.es_bloqueo)

            for (let idx = 0; idx < ORDEN_FASES.length; idx++) {
              const tipo = ORDEN_FASES[idx]
              if (propias.some(a => a.tipo === tipo)) continue // ya planificada

              const predTipo = idx > 0 ? ORDEN_FASES[idx - 1] : null
              const pred = predTipo ? propias.find(a => a.tipo === predTipo) ?? null : null
              const horas = horasDeFase(state.config, proyecto, tipo)
              const elegido = pickPersona(
                state.personas, tipo, asignaciones, proyecto.id,
                personaId => inicioDeFase(tipo, pred, personaId, feriados) ?? baseInicio,
                horas, state.config, feriados,
              )

              let id = `${proyecto.id}-${sufijo[tipo] ?? 'fase'}`
              let n = 2
              while (idsExist.has(id)) id = `${proyecto.id}-${sufijo[tipo] ?? 'fase'}_${n++}`
              idsExist.add(id)

              const nueva: Asignacion = {
                id, proyecto_id: proyecto.id, tipo, persona_id: elegido.persona_id,
                inicio: elegido.inicio, fin: elegido.fin,
                duracion_dias: elegido.duracion_dias, dedicacion_pct: elegido.dedicacion_pct,
                predecesoras: pred ? [pred.id] : [], es_bloqueo: false,
              }
              asignaciones = [...asignaciones, nueva]
              propias = [...propias, nueva]
              creadas++
            }
          }

          if (creadas === 0) return {}
          return {
            ...conHistorial(state),
            asignaciones,
            violaciones: recompute(asignaciones, state.personas, state.config, state.proyectos),
          }
        })
        return { creadas }
      },

      // Pasa el plan existente al cálculo por horas: cada fase dura lo que le lleva a SU
      // persona con su disponibilidad de ese año, en vez de los 10/15/8 días fijos de antes.
      //
      // NO mueve fechas: el inicio de cada fase queda tal cual está y solo cambian fin,
      // duracion_dias y dedicacion_pct. Es una decisión explícita: reencadenar y correr las
      // fases hacia adelante para que nadie se pise desplazaba la cola de trabajo hasta 50
      // días hábiles y dejaba el timeline irreconocible contra el tablero real. Los choques
      // que aparecen al estirarse las duraciones quedan a la vista en rojo (Reglas 2 y 3) y
      // se resuelven a mano moviendo barras, que es de lo que se trata la mesa de
      // planificación. El encadenado con solapamiento sí se aplica a las fases NUEVAS
      // (planificar pendientes / alta de cuenta).
      //
      // Quedan afuera los bloqueos y las cuentas especiales (TASA), que no salen del
      // template estándar: aplicarles la tabla estándar convertiría un relevamiento de
      // 88 días en uno de 7.
      recalcularDuraciones() {
        let reporte: RecalculoReporte = { recalculadas: 0, cambiadas: [], intactas: 0, conflictos: 0 }
        set(state => {
          const feriados = feriadosDeConfig(state.config)
          const proyectoPorId = new Map(state.proyectos.map(p => [p.id, p]))
          const esRecalculable = (a: Asignacion) =>
            !a.es_bloqueo && a.proyecto_id != null && !proyectoPorId.get(a.proyecto_id)?.especial

          const cambiadas: RecalculoReporte['cambiadas'] = []
          let recalculadas = 0
          let intactas = 0

          const asignaciones = state.asignaciones.map(a => {
            if (!esRecalculable(a)) { intactas++; return a }
            const proyecto = a.proyecto_id ? proyectoPorId.get(a.proyecto_id) ?? null : null
            const horas = horasDeFase(state.config, proyecto, a.tipo)
            const medida = medirFase(a.inicio, horas, a.persona_id, state.config, feriados)
            recalculadas++
            if (medida.duracion_dias !== a.duracion_dias) {
              cambiadas.push({ id: a.id, diasAntes: a.duracion_dias, diasDespues: medida.duracion_dias })
            }
            // Preserva id, proyecto_id, tipo, persona_id, inicio y predecesoras.
            return { ...a, fin: medida.fin, duracion_dias: medida.duracion_dias, dedicacion_pct: medida.dedicacion_pct }
          })

          if (recalculadas === 0) return {}
          const violaciones = recompute(asignaciones, state.personas, state.config, state.proyectos)
          reporte = {
            recalculadas, cambiadas, intactas,
            conflictos: violaciones.filter(v => v.severidad === 'rojo').length,
          }

          return { ...conHistorial(state), asignaciones, violaciones }
        })
        return reporte
      },

      // Vacía todas las asignaciones (las cuentas y el equipo quedan; pasan a "sin planificar").
      clearAsignaciones() {
        set(state => ({
          ...conHistorial(state),
          asignaciones: [],
          violaciones: recompute([], state.personas, state.config, state.proyectos),
        }))
      },

      resetToSeed() {
        set(state => ({
          ...conHistorial(state),
          personas: seedPersonas,
          proyectos: seedProyectos,
          asignaciones: seedAsignaciones,
          config: seedConfig,
          violaciones: recompute(seedAsignaciones, seedPersonas, seedConfig, seedProyectos),
          clienteSeleccionado: null,
        }))
      },

      exportarJSON() {
        const { personas, proyectos, asignaciones, config } = get()
        return JSON.stringify({ personas, proyectos, asignaciones, config }, null, 2)
      },

      importarJSON(json) {
        const data = JSON.parse(json) as Partial<SimuladorState>
        const personas = (data.personas as Persona[]) ?? seedPersonas
        const proyectos = (data.proyectos as Proyecto[]) ?? seedProyectos
        const asignaciones = (data.asignaciones as Asignacion[]) ?? seedAsignaciones
        // Un bloqueo es tiempo reservado, no una fase que deba esperar a su predecesora:
        // el bloqueo de supervisión de TASA corre a propósito por debajo del relevamiento.
        // Con la predecesora declarada, la Regla 3 lo marcaba como dependencia rota. Se le
        // saca la predecesora al importar (el resto de la asignación entra tal cual).
        const asignacionesNorm = asignaciones.map(a =>
          a.es_bloqueo && a.predecesoras?.length ? { ...a, predecesoras: [] } : a)
        // Los planes exportados antes de las tablas nuevas (horas/disponibilidad/cartera
        // legacy) no las traen: se completan con las del seed para que el cálculo por
        // horas y los insights sigan andando. Las asignaciones entran tal cual vienen
        // (misma cantidad, mismas personas).
        const config = data.config ? conFallbackDeSeed(data.config as Partial<Config>) : seedConfig
        set(state => ({
          ...conHistorial(state),
          personas,
          proyectos,
          asignaciones: asignacionesNorm,
          config,
          violaciones: recompute(asignacionesNorm, personas, config, proyectos),
          clienteSeleccionado: null,
        }))
      },
    }),
    {
      name: 'simulador-ha-v2',
      version: 4,
      migrate: (persisted, version) => {
        const estado = persisted as { personas?: Persona[]; config?: Partial<Config> } | undefined
        // Los planes ya guardados en localStorage no tienen la fila de Axton: se la
        // agregamos una sola vez (si después la borrás a mano, no vuelve a aparecer).
        if (estado && version < 3) {
          const personas = estado.personas ?? seedPersonas
          if (!personas.some(p => p.id === 'axton')) {
            const axton = seedPersonas.find(p => p.id === 'axton')
            if (axton) estado.personas = [...personas, axton]
          }
        }
        // Config guardado antes de horas_por_fase/disponibilidad/cartera_legacy_axton
        // (quedó en version 3 sin que estas claves existieran todavía): se completan
        // con las del seed, igual que hace importarJSON con un plan exportado viejo.
        if (estado?.config && version < 4) {
          estado.config = conFallbackDeSeed(estado.config)
        }
        return persisted
      },
      partialize: state => ({
        personas: state.personas,
        proyectos: state.proyectos,
        asignaciones: state.asignaciones,
        config: state.config,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.violaciones = recompute(state.asignaciones, state.personas, state.config, state.proyectos)
        }
      },
    },
  ),
)
