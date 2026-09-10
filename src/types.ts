export type TipoFase = 'Relevamiento' | 'Configuracion' | 'Pruebas' | 'Cierre' | 'Vacaciones'

/** Clasificación del recurso. Opcional: null/undefined = "sin clasificar" (se completa a mano). */
export type RolPersona = 'relevamiento' | 'configuracion' | 'pruebas'

export interface Persona {
  id: string
  alias: string
  skills: string[]
  rol?: RolPersona | null
  capacidad_horas_semana: number
  buffer_pct: number
  /**
   * Horas disponibles por día hábil. Default `config.capacidad.horas_dia_default` (7).
   * Gaby tiene 4: su jornada es fija, no una fracción de la jornada estándar.
   */
  horas_dia?: number
  custom?: boolean   // true si se agregó desde la UI (no viene del seed)
  _nota?: string
}

export interface Proyecto {
  id: string
  nombre: string
  /** 'baja' = cuenta chica (<10 empleados). null = sin clasificar. */
  complejidad: 'baja' | 'media' | 'alta' | null
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

  // ── Capa de calendario del programa (plan v3, 10/09/2026). Todas opcionales: los
  //    planes exportados antes no las traen. Las claves que empiezan con `_` son notas.
  /**
   * Mes de salida en vivo propuesto por cuenta: `{ tim: '2026-10', ... }`. Es DATO, no se
   * deduce del fin de las fases. Puede traer una sub-clave `_fuera_del_plan` (objeto) que
   * el código ignora: la fuente de esas cuentas es `salidas_en_vivo_fuera_del_plan`.
   */
  salidas_en_vivo_propuestas?: Record<string, string | Record<string, string>>
  /** Día del mes del corte de novedades de cada cuenta: `{ tim: 19, ... }`. Fallback cuando no hay fecha del mes. */
  cortes_novedades_dia?: Record<string, number | string>
  /**
   * Corte de novedades por cuenta y período: `{ copetro: { '2026-10': '2026-10-16', ... } }`.
   * Sale de los cronogramas de monday (ítem "Recepción de Novedades"); es el ancla del mes
   * de salida: la primera ronda del período (1Q, v1, ronda 1). Manda sobre el día fijo.
   */
  cortes_novedades_fechas?: Record<string, Record<string, string>>
  /** Detalle informativo de las rondas por cuenta (qué ronda es el ancla y de dónde salió cada fecha). */
  cortes_novedades_detalle?: Record<string, {
    ancla?: string
    rondas?: string[]
    /** período → ronda → 'YYYY-MM-DD (monday)' | 'YYYY-MM-DD (estimado)' */
    por_periodo?: Record<string, Record<string, string>>
    [k: string]: unknown
  }>
  /** Cuentas que salen en vivo dentro del horizonte sin pasar por fases (ya configuradas). */
  salidas_en_vivo_fuera_del_plan?: {
    cuentas: Array<{ nombre: string; alias?: string; sale_en_vivo: string }>
    _doc?: string
  }
  /** Tier de cada cuenta (chica / std / grande / xl) y el blackout de configuración. */
  tiers_v3?: {
    chica: string[]
    std: string[]
    grande: string[]
    /** Tier de una sola cuenta (Sportline): más grande que `grande`. */
    xl?: string[]
    duraciones_dias?: Record<string, Record<string, number>>
    /** [desde, hasta] ISO, inclusive. Ninguna Configuración puede tocar ese rango. */
    blackout_config?: [string, string]
  }
  reglas_calendario?: {
    inicio_siempre_lunes?: boolean
    nunca_feriado?: boolean
    tope_salidas_en_vivo_por_mes?: number
    _nota?: string
  }
  /** Modelo de capacidad (brief 10/09/2026 §2). Ver `src/capacidad.ts`. */
  capacidad?: CapacidadConfig
  /** Insumos para justificar decisiones (tickets Meta4, equipo de payroll hoy). Solo lectura. */
  insumos?: {
    tickets_meta4_ytd?: {
      fuente?: string
      corte?: string
      filas: Array<{ cliente: string; tickets: number; pct_criticas: number; peso: number; escalados: number }>
      _nota?: string
    }
    equipo_payroll_hoy?: {
      fuente?: string
      corte?: string
      filas: Array<{ cliente: string; analista: string; sistema: string; lider?: string | null; complejidad?: string | number | null; pays?: number | null }> | string
      _nota?: string
    }
  }
  /**
   * CONFIDENCIAL. Solo vive en el JSON local de Willy: nunca en `data/`, nunca en el
   * repo, nunca se rellena desde el seed. Si el plan importado no lo trae, la pestaña
   * de disponibilidad no existe. Ver brief §3.3.
   */
  equipo_confidencial?: EquipoConfidencial
}

export interface CapacidadConfig {
  /** Horas disponibles por día hábil para quien no tiene `horas_dia` propio. */
  horas_dia_default: number
  /** Días hábiles mínimos entre el fin de Pruebas y el corte de novedades del mes de salida. */
  margen_minimo_habiles: number
  /** El aviso semanal salta si horas > capacidad de la semana × tolerancia. */
  aviso_semanal_tolerancia: number
  /** Disponibilidad de Moni: max(piso, base − caida × (cuentas_en_axton − cuentas_base)). */
  moni_soporte_axton: {
    base: number
    cuentas_base: number
    caida_por_cuenta: number
    piso: number
    _nota?: string
  }
  _doc?: string
}

/** Un valor que Willy todavía no cargó se escribe literalmente como "[FALTA]" (o "[FALTA: ...]"). */
export type ValorOFalta = number | string

export interface EquipoConfidencial {
  _doc?: string
  /** persona → mes 'YYYY-MM' → frente → fracción de su jornada. */
  dedicacion_por_mes: Record<string, Record<string, Record<string, ValorOFalta>>>
  transicion_susana?: {
    desde: ValorOFalta | null
    toma_meta4_de: string[]
    _nota?: string
  }
}

/** 'info' = dato que conviene ver pero no es un problema (ej. 3 salidas permitidas por tier chico). */
export type SeveridadViolacion = 'rojo' | 'ambar' | 'info'

/**
 * Las reglas del programa (brief 10/09/2026 §4-A4):
 *  carga_mes     horas de una persona en el mes > su capacidad (rojo)
 *  carga_semana  horas en una semana > capacidad × tolerancia (ámbar, aviso)
 *  tope_salidas  más salidas en vivo en un mes que el tope (salvo 3 con 2 chicas)
 *  margen        Pruebas cierra a menos de N hábiles del corte de novedades
 *  blackout      una Configuración toca el blackout de fin de año
 *  dependencia   Pruebas arranca antes de que cierre la Configuración de su cuenta
 */
export type TipoRegla = 'carga_mes' | 'carga_semana' | 'tope_salidas' | 'margen' | 'blackout' | 'dependencia'

export interface Violacion {
  tipo: TipoRegla
  /** Fase a la que se le cuelga la violación ('' si la regla no apunta a una fase, ej. tope). */
  asignacion_id: string
  persona_id?: string
  proyecto_id?: string
  semana?: string  // YYYY-MM-DD lunes de la semana afectada
  mes?: string     // YYYY-MM del mes afectado
  mensaje: string
  severidad: SeveridadViolacion
}

export interface EstadoAsignacion {
  asignacion_id: string
  violaciones: Violacion[]
  color: 'verde' | 'ambar' | 'rojo'
}
