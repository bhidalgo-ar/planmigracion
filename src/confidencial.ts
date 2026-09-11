import type { Asignacion, Config, EquipoConfidencial, Persona, ValorOFalta } from './types'
import { cuentasEnAxton, cuentasEnMeta4, disponibilidadMes, horasDiaDe, mesesEntre, ticketsAxton, ticketsMeta4Restantes } from './capacidad'
import { mesesDelPrograma } from './insightsEquipo'

/**
 * Pestaña confidencial "Disponibilidad del equipo" (brief 10/09/2026 §3.3).
 *
 * Qué protege de verdad: los datos NUNCA están en el repo ni en el deploy. Viven solo en
 * el JSON que Willy importa desde su notebook, bajo `config.equipo_confidencial`. Si el
 * plan cargado no trae ese bloque, la pestaña no existe.
 *
 * Qué es la contraseña: una cortina. Evita que alguien vea la pestaña por accidente en una
 * reunión; no evita que quien quiera leer el JSON lo lea. Por eso en el código va el hash
 * SHA-256 de la contraseña (no el texto) y el desbloqueo vive en `sessionStorage` atado a
 * ESTA carga de la página: al recargar o cerrar la pestaña del navegador vuelve a estar
 * cerrada (criterio de cierre del brief). Nunca en localStorage ni en el estado
 * persistido de Zustand.
 */

/** SHA-256 en hex de la contraseña definida por Willy. */
const HASH_CONTRASENA = 'bc2e1f676370b8131e3a1f84fc6c1cd6c9266f279030c92604fde8cfa8a1e0d3'

const CLAVE_SESION = 'simulador-ha-confidencial'

/**
 * Token de esta carga de la página. El desbloqueo se guarda en sessionStorage junto con el
 * token; una recarga genera otro token y lo que había guardado deja de valer. Así "cerrado
 * al recargar" no depende de que el navegador limpie nada.
 */
const TOKEN_CARGA = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

async function sha256Hex(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto)
  const buf = await globalThis.crypto.subtle.digest('SHA-256', datos)
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** true si el texto coincide con la contraseña (comparando hashes, nunca el texto). */
export async function verificarContrasena(texto: string): Promise<boolean> {
  return (await sha256Hex(texto)) === HASH_CONTRASENA
}

function sesion(): Storage | null {
  try { return globalThis.sessionStorage ?? null } catch { return null }
}

/** Si esta pestaña del navegador ya se desbloqueó. Al cerrarla, vuelve a false. */
export function estaDesbloqueado(): boolean {
  try { return sesion()?.getItem(CLAVE_SESION) === TOKEN_CARGA } catch { return false }
}

export function desbloquear(): void {
  try { sesion()?.setItem(CLAVE_SESION, TOKEN_CARGA) } catch { /* sin sessionStorage no hay desbloqueo */ }
}

export function bloquear(): void {
  try { sesion()?.removeItem(CLAVE_SESION) } catch { /* idem */ }
}

/** El plan trae el bloque confidencial (y por lo tanto la pestaña existe). */
export function tieneBloqueConfidencial(config: Config | undefined): boolean {
  const b = config?.equipo_confidencial
  return !!b && typeof b === 'object' && !!b.dedicacion_por_mes && Object.keys(b.dedicacion_por_mes).length > 0
}

// ── Vista ──────────────────────────────────────────────────────────────────────

/** Frentes en el orden en que se apilan. Cualquier otra clave del JSON va a "otros". */
export const FRENTES = ['meta4_soporte', 'axton_soporte', 'migracion', 'toyota', 'otros'] as const
export type Frente = typeof FRENTES[number]
export const FRENTE_LABEL: Record<Frente, string> = {
  meta4_soporte: 'Soporte Meta4', axton_soporte: 'Soporte Axton', migracion: 'Migración', toyota: 'Toyota', otros: 'Otros',
}

/** Orden de las filas. Quien no esté acá va después, en orden alfabético. */
const ORDEN_FILAS = ['susi', 'leo', 'lucas', 'moni', 'gaby_f', 'guille', 'lau']
const ALIAS_FALLBACK: Record<string, string> = { leo: 'Leo', lucas: 'Lucas', susi: 'Susi', moni: 'Moni', gaby_f: 'Gaby F.', guille: 'Guille', lau: 'Lau', axton: 'Axton' }

export interface CeldaMes {
  mes: string
  /** Fracción por frente; null = "[FALTA]" o sin dato. */
  frentes: Record<Frente, number | null>
  /** true si el mes no tiene ninguna entrada para la persona. */
  vacio: boolean
  /** Alguna entrada del mes está en "[FALTA]". */
  conFaltas: boolean
  /** Etiqueta de lo que falta, para mostrar en la celda. */
  faltas: string[]
}

export interface FilaConfidencial {
  personaId: string
  alias: string
  horasDia: number
  meses: CeldaMes[]
  /** true si las fracciones las calculó la app (Susi por tickets, Moni por su fórmula) en vez de venir del bloque. */
  calculada?: boolean
}

function esFalta(v: ValorOFalta | undefined | null): boolean {
  return typeof v === 'string'
}

/** Meses que cubre el bloque: del primero al último con datos, sin huecos. */
export function mesesConfidencial(bloque: EquipoConfidencial): string[] {
  const todos = new Set<string>()
  for (const porMes of Object.values(bloque.dedicacion_por_mes ?? {})) for (const m of Object.keys(porMes)) if (/^\d{4}-\d{2}$/.test(m)) todos.add(m)
  const desde = bloque.transicion_susana?.desde
  if (typeof desde === 'string' && /^\d{4}-\d{2}$/.test(desde)) todos.add(desde)
  if (!todos.size) return []
  const orden = [...todos].sort()
  return mesesEntre(`${orden[0]}-01`, `${orden[orden.length - 1]}-01`)
}

/** Una fila por persona del bloque, con una celda por mes. Las celdas sin dato quedan marcadas. */
export function filasConfidencial(config: Config, personas: Persona[]): FilaConfidencial[] {
  const bloque = config.equipo_confidencial
  if (!bloque) return []
  const meses = mesesConfidencial(bloque)
  const ids = Object.keys(bloque.dedicacion_por_mes ?? {}).sort((a, b) => {
    const ia = ORDEN_FILAS.indexOf(a), ib = ORDEN_FILAS.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  return ids.map(id => {
    const persona = personas.find(p => p.id === id)
    const porMes = bloque.dedicacion_por_mes[id] ?? {}
    return {
      personaId: id,
      alias: persona?.alias ?? ALIAS_FALLBACK[id] ?? id,
      horasDia: horasDiaDe(persona, config),
      meses: meses.map(mes => {
        const entrada = porMes[mes]
        const frentes = { meta4_soporte: null, axton_soporte: null, migracion: null, toyota: null, otros: null } as Record<Frente, number | null>
        const faltas: string[] = []
        if (!entrada) return { mes, frentes, vacio: true, conFaltas: false, faltas }
        for (const [k, v] of Object.entries(entrada)) {
          if (k.startsWith('_')) continue
          const frente = (FRENTES as readonly string[]).includes(k) ? (k as Frente) : 'otros'
          if (typeof v === 'number' && Number.isFinite(v)) frentes[frente] = (frentes[frente] ?? 0) + v
          else if (esFalta(v)) faltas.push(FRENTE_LABEL[frente])
        }
        return { mes, frentes, vacio: false, conFaltas: faltas.length > 0, faltas }
      }),
    }
  })
}

/**
 * Las mismas filas que `filasConfidencial`, pero con lo que la app sabe calcular: Susi se
 * reparte entre soporte Meta 4 y migración según los tickets que quedan (si el plan trae
 * `capacidad.susi_soporte_meta4` y `soporte_tickets`); Moni entre soporte Axton y migración
 * según su fórmula. El resto muestra el bloque tal cual. Un mes sin entrada en el bloque
 * sigue vacío ("—"): la persona no está ese mes.
 */
export function filasReparto(config: Config, personas: Persona[]): FilaConfidencial[] {
  return filasConfidencial(config, personas).map(f => {
    const frenteSoporte: Frente | null =
      f.personaId === (config.capacidad?.susi_soporte_meta4?.persona_id ?? 'susi') && config.capacidad?.susi_soporte_meta4 && config.soporte_tickets ? 'meta4_soporte'
      : f.personaId === 'moni' && config.capacidad?.moni_soporte_axton ? 'axton_soporte'
      : null
    if (!frenteSoporte) return f
    const persona = personas.find(p => p.id === f.personaId)
    return {
      ...f,
      calculada: true,
      meses: f.meses.map(m => {
        if (m.vacio) return m
        const d = disponibilidadMes(f.personaId, m.mes, config, undefined, persona)
        const frentes = { meta4_soporte: null, axton_soporte: null, migracion: null, toyota: null, otros: null } as Record<Frente, number | null>
        frentes[frenteSoporte] = Math.max(0, Math.min(1, 1 - d))
        frentes.migracion = Math.max(0, Math.min(1, d))
        return { ...m, frentes, conFaltas: false, faltas: [] }
      }),
    }
  })
}

export interface MesSoporte {
  mes: string
  /** Tickets por mes que siguen en Meta 4; null si el plan no trae la ticketera. */
  ticketsMeta4: number | null
  cuentasMeta4: number
  dispSusi: number
  ticketsAxton: number | null
  cuentasAxton: number
  dispMoni: number
}

/**
 * Qué libera Meta 4 y qué carga Axton, mes a mes del programa: tickets y cuentas de cada
 * lado, con la disponibilidad para migración de Susi y de Moni que sale de eso.
 */
export function soporteMesAMes(config: Config, personas: Persona[], asignaciones: Asignacion[]): MesSoporte[] {
  const susi = personas.find(p => p.id === (config.capacidad?.susi_soporte_meta4?.persona_id ?? 'susi'))
  const moni = personas.find(p => p.id === 'moni')
  return mesesDelPrograma(asignaciones, config).map(mes => ({
    mes,
    ticketsMeta4: ticketsMeta4Restantes(mes, config),
    cuentasMeta4: cuentasEnMeta4(mes, config).length,
    dispSusi: disponibilidadMes(susi?.id ?? 'susi', mes, config, undefined, susi),
    ticketsAxton: ticketsAxton(mes, config),
    cuentasAxton: cuentasEnAxton(mes, config),
    dispMoni: disponibilidadMes('moni', mes, config, undefined, moni),
  }))
}

export interface LecturaTransicion {
  /** 'YYYY-MM' o null si está en [FALTA]. */
  desde: string | null
  /** Personas de las que Susana toma el soporte Meta4 (alias). */
  tomaDe: string[]
  /** Horas por semana de soporte Meta4 que hoy llevan esas personas (mes anterior a `desde`); null si falta algún dato. */
  horasSemanaLiberadas: number | null
  texto: string
}

/**
 * "Desde [mes], Susana toma el soporte Meta4 de Leo y Lucas; quedan libres X h/semana".
 * X = suma de `meta4_soporte` de esas personas en el mes anterior a la transición × horas
 * por día × 5. Si falta un dato, lo dice en vez de estimar.
 */
export function lecturaTransicion(config: Config, personas: Persona[]): LecturaTransicion | null {
  const t = config.equipo_confidencial?.transicion_susana
  if (!t) return null
  const desde = typeof t.desde === 'string' && /^\d{4}-\d{2}$/.test(t.desde) ? t.desde : null
  const tomaDe = (t.toma_meta4_de ?? []).map(id => personas.find(p => p.id === id)?.alias ?? ALIAS_FALLBACK[id] ?? id)
  const lista = tomaDe.length <= 1 ? tomaDe.join('') : `${tomaDe.slice(0, -1).join(', ')} y ${tomaDe[tomaDe.length - 1]}`

  let horas: number | null = null
  if (desde) {
    const [y, m] = desde.split('-').map(Number)
    const anterior = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
    let suma = 0
    let completo = true
    for (const id of t.toma_meta4_de ?? []) {
      const v = config.equipo_confidencial?.dedicacion_por_mes?.[id]?.[anterior]?.meta4_soporte
      if (typeof v === 'number') suma += v * horasDiaDe(personas.find(p => p.id === id), config) * 5
      else completo = false
    }
    horas = completo && (t.toma_meta4_de ?? []).length ? Math.round(suma) : null
  }

  const mesTexto = desde ? nombreMesLargo(desde) : '[FALTA: mes]'
  let texto = `Desde ${mesTexto}, Susana toma el soporte Meta4 de ${lista || '[FALTA: personas]'}; ` +
    (horas !== null ? `quedan libres ${horas} h por semana.` : 'quedan libres [FALTA: horas/semana de soporte Meta4 del mes anterior].')

  // Con la ticketera cargada, la lectura sigue con lo que eso significa para Susana: los
  // tickets de hoy son su día completo y cada cuenta que sale le devuelve una parte.
  const susi = config.equipo_confidencial && config.capacidad?.susi_soporte_meta4
  if (desde && susi && config.soporte_tickets && typeof susi.base_tickets_mes === 'number' && susi.base_tickets_mes > 0) {
    const pct = (mes: string) => Math.round(disponibilidadMes(susi.persona_id ?? 'susi', mes, config) * 100)
    const inicio = susi.desde >= desde ? susi.desde : desde
    const horizonte = mesesEntre(`${inicio}-01`, `${Number(inicio.slice(0, 4)) + 2}-12-01`)
    const lleno = horizonte.find(m => pct(m) >= 100) ?? null
    texto += ` Los ~${Math.round(susi.base_tickets_mes)} tickets por mes de hoy pasan a ser su día completo: en ${nombreMesLargo(inicio)} le queda ${pct(inicio)} % para configurar` +
      (lleno ? `, y llega al 100 % en ${nombreMesLargo(lleno)}, cuando no queda ninguna cuenta en Meta4.` : '; no llega al 100 % dentro del horizonte.')
  }
  return { desde, tomaDe, horasSemanaLiberadas: horas, texto }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
function nombreMesLargo(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return `${MESES[m - 1]} de ${y}`
}
