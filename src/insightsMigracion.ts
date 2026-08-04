import { differenceInCalendarMonths, parseISO } from 'date-fns'
import type { Asignacion, Persona, Proyecto, TipoFase } from './types'
import { ORDEN_FASES } from './theme/fases'

/**
 * Lectura de AVANCE de la migración (Meta 4 → Axton), para la vista Insights.
 *
 * Es una mirada distinta a la de `insights.ts`: ahí interesa si el plan está bien
 * cargado y si alguien está sobreasignado; acá interesa cuándo sale cada cuenta a
 * producción y cómo se reparte el trabajo. Nada de conflictos.
 *
 * Definición central: una cuenta está **en vivo en Axton** cuando termina su última
 * fase planificada. Hasta ese día sigue operando en Meta 4, incluso mientras se la
 * está migrando. Por eso los tres estados de una cuenta son:
 *
 *   sin_empezar   → todavía en Meta 4, sin trabajo iniciado
 *   en_migracion  → todavía en Meta 4, con trabajo en curso
 *   en_vivo       → ya salió a Axton
 *
 * Una cuenta sin fases planificadas queda siempre en `sin_empezar`: no se le inventa
 * una fecha de salida (mismo criterio que el resto de la app).
 */

export interface FaseCuenta {
  id: string
  tipo: TipoFase
  inicio: string
  fin: string
  persona_id: string
}

export interface CuentaMigracion {
  id: string
  nombre: string
  especial: boolean
  /** Primer día de trabajo de la cuenta. null si no está planificada. */
  inicio: string | null
  /** Fin de la última fase = salida en vivo en Axton. null si no está planificada. */
  enVivo: string | null
  fases: FaseCuenta[]
}

export type EstadoMigracion = 'sin_empezar' | 'en_migracion' | 'en_vivo'

/** Cuentas con sus fases ordenadas y su fecha de salida a Axton. Excluye bloqueos. */
export function cuentasMigracion(proyectos: Proyecto[], asignaciones: Asignacion[]): CuentaMigracion[] {
  const fases = asignaciones.filter(a => !a.es_bloqueo)

  return proyectos.map(p => {
    const propias: FaseCuenta[] = fases
      .filter(a => a.proyecto_id === p.id)
      .map(a => ({ id: a.id, tipo: a.tipo, inicio: a.inicio, fin: a.fin, persona_id: a.persona_id }))
      .sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0))

    return {
      id: p.id,
      nombre: p.nombre,
      especial: p.especial,
      inicio: propias.length ? propias.reduce((m, f) => (f.inicio < m ? f.inicio : m), propias[0].inicio) : null,
      enVivo: propias.length ? propias.reduce((m, f) => (f.fin > m ? f.fin : m), propias[0].fin) : null,
      fases: propias,
    }
  })
}

/** Estado de una cuenta a una fecha de corte (inclusive). */
export function estadoA(cuenta: CuentaMigracion, corteISO: string): EstadoMigracion {
  if (cuenta.enVivo && cuenta.enVivo <= corteISO) return 'en_vivo'
  if (cuenta.inicio && cuenta.inicio <= corteISO) return 'en_migracion'
  return 'sin_empezar'
}

export interface TrimestreMigracion {
  /** Clave ordenable: '2026-3'. */
  key: string
  /** Etiqueta corta para el eje: 'T3 26'. */
  label: string
  anio: number
  trimestre: number
  /** Último día del trimestre (la foto se toma al cierre). */
  finISO: string
  sinEmpezar: number
  enMigracion: number
  enVivo: number
  /** Nombres de las cuentas que salen a Axton DENTRO de este trimestre. */
  salidas: string[]
}

function ultimoDiaTrimestre(anio: number, trimestre: number): string {
  const mesFin = trimestre * 3            // 3, 6, 9, 12
  const dia = mesFin === 6 || mesFin === 9 ? 30 : 31
  return `${anio}-${String(mesFin).padStart(2, '0')}-${dia}`
}

/**
 * Foto al cierre de cada trimestre: cuántas cuentas siguen en Meta 4 (sin empezar o
 * en migración) y cuántas ya están en vivo en Axton. Los tres números suman siempre
 * el total de cuentas. El rango va del primer día de trabajo al último go-live.
 */
export function migracionPorTrimestre(cuentas: CuentaMigracion[]): TrimestreMigracion[] {
  const conPlan = cuentas.filter(c => c.inicio && c.enVivo)
  if (conPlan.length === 0) return []

  const desde = parseISO(conPlan.reduce((m, c) => (c.inicio! < m ? c.inicio! : m), conPlan[0].inicio!))
  const hasta = parseISO(conPlan.reduce((m, c) => (c.enVivo! > m ? c.enVivo! : m), conPlan[0].enVivo!))

  const out: TrimestreMigracion[] = []
  let anio = desde.getFullYear()
  let trim = Math.floor(desde.getMonth() / 3) + 1
  const anioFin = hasta.getFullYear()
  const trimFin = Math.floor(hasta.getMonth() / 3) + 1

  // Tope de seguridad: 40 trimestres = 10 años, muy por encima de cualquier plan real.
  for (let i = 0; i < 40; i++) {
    const finISO = ultimoDiaTrimestre(anio, trim)
    const inicioISO = `${anio}-${String(trim * 3 - 2).padStart(2, '0')}-01`

    let sinEmpezar = 0, enMigracion = 0, enVivo = 0
    const salidas: string[] = []
    for (const c of cuentas) {
      const estado = estadoA(c, finISO)
      if (estado === 'en_vivo') enVivo++
      else if (estado === 'en_migracion') enMigracion++
      else sinEmpezar++
      if (c.enVivo && c.enVivo >= inicioISO && c.enVivo <= finISO) salidas.push(c.nombre)
    }

    out.push({
      key: `${anio}-${trim}`,
      label: `T${trim} ${String(anio).slice(2)}`,
      anio, trimestre: trim, finISO,
      sinEmpezar, enMigracion, enVivo, salidas,
    })

    if (anio === anioFin && trim === trimFin) break
    trim++
    if (trim > 4) { trim = 1; anio++ }
  }

  return out
}

export interface CargaPersona {
  id: string
  alias: string
  /** Cuentas distintas que toca (la pregunta: ¿cuántas cuentas hace cada uno?). */
  cuentas: number
  fases: number
  porTipo: Record<TipoFase, number>
}

/** Cuántas cuentas y fases toma cada persona, con el desglose por tipo de fase. */
export function cargaPorPersona(personas: Persona[], cuentas: CuentaMigracion[]): CargaPersona[] {
  const porPersona = new Map<string, { cuentas: Set<string>; porTipo: Record<string, number>; fases: number }>()

  for (const c of cuentas) {
    for (const f of c.fases) {
      const e = porPersona.get(f.persona_id) ?? { cuentas: new Set<string>(), porTipo: {}, fases: 0 }
      e.cuentas.add(c.id)
      e.porTipo[f.tipo] = (e.porTipo[f.tipo] ?? 0) + 1
      e.fases++
      porPersona.set(f.persona_id, e)
    }
  }

  return personas
    .map(p => {
      const e = porPersona.get(p.id)
      const porTipo = {} as Record<TipoFase, number>
      for (const t of ORDEN_FASES) porTipo[t] = e?.porTipo[t] ?? 0
      porTipo.Vacaciones = e?.porTipo.Vacaciones ?? 0
      return {
        id: p.id,
        alias: p.alias,
        cuentas: e?.cuentas.size ?? 0,
        fases: e?.fases ?? 0,
        porTipo,
      }
    })
    .sort((a, b) => b.cuentas - a.cuentas || b.fases - a.fases)
}

export interface ResumenMigracion {
  totalCuentas: number
  /** Cuentas con plan completo (tienen al menos una fase). */
  planificadas: number
  sinPlanificar: number
  /** Primer go-live del programa. */
  primeraSalida: string | null
  /** Último go-live: el día en que la migración termina. */
  ultimaSalida: string | null
  cuentaCierre: string | null
  /** Cuentas ya en vivo al día de hoy. */
  enVivoHoy: number
  enMigracionHoy: number
  /** Meses entre el primer día de trabajo y el último go-live. */
  mesesPrograma: number | null
  inicioPrograma: string | null
}

/**
 * `enVivoHoyForzado`: excepción puntual para cuentas que el tablero real ya muestra
 * migradas hoy aunque el plan simulado calcule una salida unos días posterior a hoy
 * (ver `config.cartera_legacy_axton.cuentas_programa_ya_en_vivo`). Solo mueve el
 * conteo de "hoy"; no toca `enVivo`/fechas de la cuenta ni el resto de los insights.
 */
export function resumenMigracion(
  cuentas: CuentaMigracion[], hoyISO: string, enVivoHoyForzado: ReadonlySet<string> = new Set(),
): ResumenMigracion {
  const conPlan = cuentas.filter(c => c.inicio && c.enVivo)
  const salidas = conPlan.map(c => c.enVivo!).sort()
  const inicios = conPlan.map(c => c.inicio!).sort()
  const ultimaSalida = salidas.length ? salidas[salidas.length - 1] : null
  const inicioPrograma = inicios.length ? inicios[0] : null

  let enVivoHoy = 0, enMigracionHoy = 0
  for (const c of cuentas) {
    const e = enVivoHoyForzado.has(c.id) ? 'en_vivo' : estadoA(c, hoyISO)
    if (e === 'en_vivo') enVivoHoy++
    else if (e === 'en_migracion') enMigracionHoy++
  }

  return {
    totalCuentas: cuentas.length,
    planificadas: conPlan.length,
    sinPlanificar: cuentas.length - conPlan.length,
    primeraSalida: salidas.length ? salidas[0] : null,
    ultimaSalida,
    cuentaCierre: ultimaSalida ? conPlan.find(c => c.enVivo === ultimaSalida)?.nombre ?? null : null,
    enVivoHoy,
    enMigracionHoy,
    mesesPrograma: inicioPrograma && ultimaSalida
      ? differenceInCalendarMonths(parseISO(ultimaSalida), parseISO(inicioPrograma))
      : null,
    inicioPrograma,
  }
}
