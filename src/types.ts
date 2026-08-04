export type TipoFase = 'Relevamiento' | 'Configuracion' | 'Pruebas' | 'Vacaciones'

/** Clasificación del recurso. Opcional: null/undefined = "sin clasificar" (se completa a mano). */
export type RolPersona = 'relevamiento' | 'configuracion' | 'pruebas'

export interface Persona {
  id: string
  alias: string
  skills: string[]
  rol?: RolPersona | null
  capacidad_horas_semana: number
  buffer_pct: number
  custom?: boolean   // true si se agregó desde la UI (no viene del seed)
  _nota?: string
}

export interface Proyecto {
  id: string
  nombre: string
  complejidad: number | null
  depende_retro: boolean | null
  entidades: number
  quick_win: boolean
  especial: boolean
  custom?: boolean   // true si se agregó desde la UI
  _nota?: string
}

export interface Asignacion {
  id: string
  proyecto_id: string | null
  tipo: TipoFase
  persona_id: string
  inicio: string   // ISO date YYYY-MM-DD
  fin: string      // ISO date YYYY-MM-DD
  duracion_dias: number
  dedicacion_pct: number
  predecesoras: string[]
  es_bloqueo: boolean
  _nombre?: string // nombre libre para bloques especiales
}

/** Horas de esfuerzo por fase, por tipo de cuenta. Tabla de datos (`config.horas_por_fase`). */
export interface HorasPorFase {
  estandar: Record<string, number>
  /** Cuentas de <10 empleados (`proyecto.complejidad === 'baja'`). */
  chica: Record<string, number>
}

/** Fracción de la jornada que cada persona dedica a migración, por año. Perilla. */
export interface Disponibilidad {
  por_persona_ano: Record<string, Record<string, number>>
  default: number
}

export interface Config {
  unidades: {
    horas_por_dia: number
    dias_por_semana: number
  }
  fechas_clave: {
    transicion_susana_toyota: string | null
    retro_ready_axton: string | null
  }
  pisos_soporte_horas_semana: Record<string, number | null>
  feriados_nacionales_2026: Array<{ fecha: string; nombre: string }>
  /** Estimado (no oficial): confirmar contra el decreto del Poder Ejecutivo. Ver `_nota` en config.json. */
  feriados_nacionales_2027?: Array<{ fecha: string; nombre: string }>
  horizonte: {
    desde: string
    hasta: string
  }
  /**
   * Opcionales porque hay planes exportados en circulación que no las traen: al importar
   * uno viejo se completan con las del seed (ver `importarJSON`).
   */
  horas_por_fase?: HorasPorFase
  disponibilidad?: Disponibilidad
  /** Baseline medido del tablero Monday. Informativo: el cálculo usa `horas_por_fase`. */
  template_estandar?: Record<string, unknown>
  /** Cuentas ya en Axton antes de este programa de migración. Ver insightsMigracion.ts. */
  cartera_legacy_axton?: {
    cuentas: Array<{ nombre: string; entidades: number }>
    /** IDs de proyectos.json que el tablero real ya muestra migrados hoy, aunque el
     * plan simulado calcule una salida algo posterior. Solo ajusta el KPI "hoy". */
    cuentas_programa_ya_en_vivo?: string[]
  }
}

export type SeveridadViolacion = 'rojo' | 'ambar'
export type TipoRegla = 'R2' | 'R3'

export interface Violacion {
  tipo: TipoRegla
  asignacion_id: string
  persona_id?: string
  semana?: string  // YYYY-MM-DD lunes de la semana afectada
  mensaje: string
  severidad: SeveridadViolacion
}

export interface EstadoAsignacion {
  asignacion_id: string
  violaciones: Violacion[]
  color: 'verde' | 'ambar' | 'rojo'
}
