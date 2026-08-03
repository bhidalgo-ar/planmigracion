import { create } from 'zustand'

export type Vista = 'timeline' | 'insights'
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
}))
