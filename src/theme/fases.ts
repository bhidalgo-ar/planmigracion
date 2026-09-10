import type { TipoFase } from '../types'

/**
 * Colores por tipo de fase. Fuente única (la consumen Timeline y ClientPanel,
 * antes estaban duplicados y se habían desincronizado en Vacaciones).
 * Los valores viven como tokens del H&A Design System en index.css (var(--fase-*)),
 * nunca vendor colors (ej. el azul de Monday #579bfc quedó descartado).
 */
export const TIPO_COLOR: Record<TipoFase, string> = {
  Relevamiento: 'var(--fase-relev)',
  Configuracion: 'var(--fase-config)',
  Pruebas: 'var(--fase-pruebas)',
  Cierre: 'var(--fase-cierre)',
  Vacaciones: 'var(--fase-bloqueo)',
}

export const TIPO_LABEL: Record<TipoFase, string> = {
  Relevamiento: 'Relevamiento',
  Configuracion: 'Configuración',
  Pruebas: 'Pruebas',
  Cierre: 'Cierre',
  Vacaciones: 'Vacaciones',
}

/**
 * Orden canónico de las 4 fases estándar (excluye bloqueos/vacaciones).
 * `Cierre` es la Actualización Final: va pegada al corte de novedades, no al fin
 * de pruebas, y son dos barras — el relevador trae el delta de nómina y conceptos,
 * el configurador lo aplica en Axton y recarga acumuladores.
 */
export const ORDEN_FASES: TipoFase[] = ['Relevamiento', 'Configuracion', 'Pruebas', 'Cierre']
