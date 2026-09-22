import type { Asignacion } from './types'
import { TIPO_LABEL } from './theme/fases'

/**
 * Nombre de la TAREA de una barra, para etiquetarla por lo que se hace y no por quién.
 * En el plan v12 una fase tiene varias barras (Configuración son cuatro, Pruebas dos) y el
 * nombre de cada una no viaja en el JSON: `_nombre` dice "cuenta - Tipo". Prioridad:
 *  1. `_tarea` si la barra lo trae (clave opcional; la puede cargar Willy en Cowork).
 *  2. El sufijo del id, que en el v12 es estable (`copetro-config_base`, `dla-prueba_willy`).
 *  3. El tipo de fase.
 */
const POR_SUFIJO: Record<string, string> = {
  repaso: 'Repaso',
  config_base: 'Alta y carga base',
  config_conceptos: 'Conceptos y fórmulas',
  config_salidas: 'Salidas',
  config_contable: 'Imputación contable',
  prueba_gaby: 'Pruebas · ejecución',
  prueba_willy: 'Pruebas · cruces',
  delta: 'Act. final · delta',
  aplica: 'Act. final · aplicación',
}

export function nombreTarea(a: Asignacion): string {
  if (typeof a._tarea === 'string' && a._tarea.trim()) return a._tarea.trim()
  if (a.proyecto_id && a.id.startsWith(`${a.proyecto_id}-`)) {
    const suf = a.id.slice(a.proyecto_id.length + 1)
    if (POR_SUFIJO[suf]) return POR_SUFIJO[suf]
  }
  if (a.es_bloqueo && a._nombre) return a._nombre
  return TIPO_LABEL[a.tipo] ?? a.tipo
}
