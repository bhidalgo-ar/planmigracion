import { create } from 'zustand'

export type Vista = 'timeline' | 'insights' | 'equipo'
export type Modal = null | 'equipo' | 'cuenta'
export type ZoomLevel = 'dias' | 'semanas' | 'meses' | 'trimestres'
export type SortCuentas = 'fecha' | 'nombre'
/** flexible = arrastrar mueve solo la tarea · estricto = arrastra también las fases siguientes */
export type ModoMovimiento = 'flexible' | 'estricto'
/** Alto de cada fila de persona en el timeline. El equipo es chico: por defecto cómoda. */
export type Densidad = 'compacta' | 'comoda' | 'amplia'

/** Alto de fila y de barra (px) por densidad. */
export const DENSIDAD_PX: Record<Densidad, { row: number; bar: number }> = {
  compacta: { row: 44,  bar: 26 },
  comoda:   { row: 76,  bar: 44 },
  amplia:   { row: 108, bar: 62 },
}

/**
 * Ordena una lista de personas según `orden` (ids guardados) y saca las ocultas.
 * Las personas que no figuran en `orden` (recién agregadas) quedan al final,
 * en el orden en que vienen del store.
 */
export function aplicarOrdenYFiltro<T extends { id: string }>(
  personas: T[], orden: string[], ocultas: string[],
): T[] {
  const pos = new Map(orden.map((id, i) => [id, i]))
  const escondidas = new Set(ocultas)
  return personas
    .filter(p => !escondidas.has(p.id))
    .slice()
    .sort((a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER))
}

interface UIState {
  vista: Vista
  mostrarCarga: boolean
  mostrarDep: boolean
  /** Mostrar el resaltado de conflictos (barras rojas y anillos) en el timeline. */
  mostrarConflictos: boolean
  modal: Modal
  resumenAbierto: boolean
  timelineFull: boolean
  zoom: ZoomLevel
  sortCuentas: SortCuentas
  irHoyToken: number
  modoMovimiento: ModoMovimiento
  densidad: Densidad
  insightsAbierto: boolean
  /** Orden manual de las filas de persona en el timeline (ids). Vacío = orden del store. */
  ordenPersonas: string[]
  /** Ids de personas que no se muestran en la vista actual. */
  personasOcultas: string[]

  setVista: (v: Vista) => void
  toggleCarga: () => void
  toggleDep: () => void
  toggleConflictos: () => void
  toggleTimelineFull: () => void
  setZoom: (z: ZoomLevel) => void
  toggleSortCuentas: () => void
  irHoy: () => void
  setModoMovimiento: (m: ModoMovimiento) => void
  setDensidad: (d: Densidad) => void
  toggleInsights: () => void
  abrirModal: (m: Exclude<Modal, null>) => void
  cerrarModal: () => void
  setResumen: (abierto: boolean) => void
  setOrdenPersonas: (ids: string[]) => void
  /** Mueve una persona `delta` posiciones dentro del orden visible dado. */
  moverPersona: (idsVisibles: string[], id: string, delta: number) => void
  togglePersonaOculta: (id: string) => void
  mostrarTodasLasPersonas: () => void
  resetOrdenPersonas: () => void
}

export const useUIStore = create<UIState>((set) => ({
  vista: 'timeline',
  mostrarCarga: true,
  mostrarDep: true,
  mostrarConflictos: true,
  modal: null,
  resumenAbierto: false,
  timelineFull: false,
  zoom: 'semanas',
  sortCuentas: 'fecha',
  irHoyToken: 0,
  modoMovimiento: 'flexible',
  densidad: 'comoda',
  insightsAbierto: true,
  ordenPersonas: [],
  personasOcultas: [],

  setVista: (vista) => set({ vista }),
  toggleCarga: () => set(s => ({ mostrarCarga: !s.mostrarCarga })),
  toggleDep: () => set(s => ({ mostrarDep: !s.mostrarDep })),
  toggleConflictos: () => set(s => ({ mostrarConflictos: !s.mostrarConflictos })),
  toggleTimelineFull: () => set(s => ({ timelineFull: !s.timelineFull })),
  setZoom: (zoom) => set({ zoom }),
  toggleSortCuentas: () => set(s => ({ sortCuentas: s.sortCuentas === 'fecha' ? 'nombre' : 'fecha' })),
  irHoy: () => set(s => ({ irHoyToken: s.irHoyToken + 1 })),
  setModoMovimiento: (modoMovimiento) => set({ modoMovimiento }),
  setDensidad: (densidad) => set({ densidad }),
  toggleInsights: () => set(s => ({ insightsAbierto: !s.insightsAbierto })),
  abrirModal: (modal) => set({ modal }),
  cerrarModal: () => set({ modal: null }),
  setResumen: (resumenAbierto) => set({ resumenAbierto }),

  setOrdenPersonas: (ordenPersonas) => set({ ordenPersonas }),

  moverPersona: (idsVisibles, id, delta) => set(s => {
    // El orden manual se guarda con TODAS las personas conocidas: las visibles en
    // su orden actual y las ocultas atrás, para que al volver a mostrarlas no se
    // pierda su posición relativa.
    const i = idsVisibles.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= idsVisibles.length) return s
    const visibles = idsVisibles.slice()
    ;[visibles[i], visibles[j]] = [visibles[j], visibles[i]]
    const resto = s.ordenPersonas.filter(pid => !visibles.includes(pid))
    return { ordenPersonas: [...visibles, ...resto] }
  }),

  togglePersonaOculta: (id) => set(s => ({
    personasOcultas: s.personasOcultas.includes(id)
      ? s.personasOcultas.filter(p => p !== id)
      : [...s.personasOcultas, id],
  })),

  mostrarTodasLasPersonas: () => set({ personasOcultas: [] }),

  resetOrdenPersonas: () => set({ ordenPersonas: [] }),
}))
