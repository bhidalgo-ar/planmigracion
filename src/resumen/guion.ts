import type { ResumenData } from './derivarResumen'
import { enLetras, fechaLarga, mesDeAnio, mesYAnio } from './derivarResumen'

/**
 * El guion del video: todos los textos y todos los tiempos.
 *
 * Ningún string del video se escribe en el componente. Acá se arman a partir de
 * `ResumenData`, así que cambiar el plan cambia lo que dice el video, no solo lo que
 * dibuja. Es la diferencia entre un video y una lámina.
 */

// ── escenas y tiempos ────────────────────────────────────────────────────────────

/**
 * Las seis escenas con su duración en segundos. Retocar una duración acá corre todos
 * los cues siguientes solo; la coreografía está escrita relativa al cue de su escena
 * (`C.Cuello + 1.0`), nunca contra el segundo absoluto.
 */
export const ESCENAS = [
  { nombre: 'Apertura', dur: 4 },
  { nombre: 'Hoy', dur: 6 },
  { nombre: 'Ola', dur: 14 },
  { nombre: 'Cuello', dur: 9 },
  { nombre: 'Fin', dur: 7 },
  { nombre: 'Cierre', dur: 5 },
] as const

export type NombreEscena = typeof ESCENAS[number]['nombre']

/** Segundo en el que arranca cada escena, más `total` (el largo del video). */
export type Cues = Record<NombreEscena, number> & { total: number }

function calcularCues(): Cues {
  let t = 0
  const out = {} as Cues
  for (const e of ESCENAS) { out[e.nombre] = t; t += e.dur }
  out.total = t
  return out
}

export const CUES: Cues = calcularCues()

// ── textos ───────────────────────────────────────────────────────────────────────

export interface Subtitulo {
  /** Segundo en que aparece. */
  at: number
  /** Segundo en que se va. Si falta, dura hasta que arranca el siguiente. */
  until?: number
  texto: string
}

export interface Guion {
  header: { etiqueta: string; plan: string }
  apertura: { titulo: string; sub: string }
  hoy: { etiqueta: string; tituloResto: string; leyendaAxton: string; leyendaMeta4: string }
  ola: { titulo: string }
  cuello: { titulo: string }
  fin: { titulo: string; contadorTotal: string; pie: string; capsula: string; capsulaSub: string }
  cierre: { linea1: string; linea2: string; wordmark: string }
  subtitulos: Subtitulo[]
}

/** "Copetro, Campari, Marval y Lowsedo" */
export function unirConY(nombres: string[]): string {
  if (nombres.length === 0) return ''
  if (nombres.length === 1) return nombres[0]
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/** Los dos trimestres con más salidas, devueltos en orden cronológico. */
function dosTrimestresMasCargados(data: ResumenData) {
  return data.trimestres
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.salidas.length - a.t.salidas.length || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i)
    .map(x => x.t)
}

/**
 * Arma el guion completo. `mostrarAlertas` cambia un subtítulo: si las alertas están
 * apagadas, el mes crítico se explica por el solapamiento y no por la alerta roja.
 * `nombrePlan` es el nombre del archivo que Willy importó ("actual" si no importó nada).
 */
export function armarGuion(data: ResumenData, mostrarAlertas: boolean, nombrePlan: string): Guion {
  const C = CUES
  const hoyLargo = fechaLarga(data.hoy)
  const cuello = data.cuello
  const hayRoja = mostrarAlertas && data.alertas.some(a => a.severidad === 'rojo')
  const nTrim = data.trimestres.length
  const [t1, t2] = dosTrimestresMasCargados(data)

  const subtitulos: Subtitulo[] = [
    {
      at: C.Hoy + 0.6, until: C.Ola - 0.4,
      texto: `Hoy, ${data.yaEnAxton} de las ${data.total} cuentas ya operan en Axton. Faltan ${data.porMigrar}.`,
    },
    {
      at: C.Ola + 0.6,
      texto: `Las ${data.porMigrar} salen en vivo en ${enLetras(nTrim, false)} ${nTrim === 1 ? 'trimestre' : 'trimestres'}.`,
    },
  ]

  if (t1 && t2) {
    subtitulos.push({
      at: C.Ola + 4.5, until: C.Cuello - 0.4,
      texto: `${t1.label} concentra ${enLetras(t1.salidas.length)} salidas; ${t2.label}, ${enLetras(t2.salidas.length)}.`,
    })
  }

  if (cuello) {
    const n = cuello.cuentas.length
    subtitulos.push({
      at: C.Cuello + 0.8,
      texto: `${cuello.label} es el mes crítico: ${unirConY(cuello.cuentas)} a la vez.`,
    })
    const enLetrasCap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    subtitulos.push({
      at: C.Cuello + 4.8, until: C.Fin - 0.4,
      texto: hayRoja
        ? 'La carga supera la capacidad del equipo: es la alerta roja del plan.'
        : `${enLetrasCap(enLetras(n))} cuentas se solapan en un mes con blackout de configuración.`,
    })
  }

  subtitulos.push(
    { at: C.Fin + 0.6, texto: `Con esta ola, Axton pasa de ${data.yaEnAxton} a ${data.total} cuentas.` },
    {
      at: C.Fin + 4.4, until: C.Cierre - 0.4,
      texto: `La última salida en vivo es ${data.fin.cuenta}, en ${mesDeAnio(data.fin.mes)}.`,
    },
  )

  const nMeses = data.meses.length

  return {
    header: {
      etiqueta: 'Simulador de Migración · Resumen ejecutivo',
      plan: `Plan ${nombrePlan} · ${hoyLargo}`,
    },
    apertura: {
      titulo: 'Programa de migración Meta4 → Axton',
      sub: `Resumen ejecutivo · ${hoyLargo}`,
    },
    hoy: {
      etiqueta: 'Hoy',
      tituloResto: `de ${data.total} cuentas ya operan en Axton`,
      leyendaAxton: 'En Axton',
      leyendaMeta4: 'En Meta4, por migrar',
    },
    ola: { titulo: 'La ola de salidas en vivo, trimestre a trimestre' },
    cuello: {
      titulo: cuello
        ? `${cuello.label}: ${enLetras(cuello.cuentas.length)} cuentas al mismo tiempo`
        : 'Sin mes crítico en este plan',
    },
    fin: {
      titulo: 'Cuándo termina',
      contadorTotal: `/ ${data.total}`,
      pie: 'cuentas en Axton',
      capsula: mesYAnio(data.fin.mes),
      capsulaSub: `${data.fin.cuenta}, la última salida en vivo`,
    },
    cierre: {
      linea1: `${data.porMigrar} cuentas en ${nMeses} ${nMeses === 1 ? 'mes' : 'meses'}.`,
      linea2: `El programa cierra en ${mesDeAnio(data.fin.mes)}.`,
      wordmark: 'Hidalgo & Asociados · Simulador de Migración',
    },
    subtitulos,
  }
}

/** El subtítulo que corresponde al segundo `T`, o null. Cada uno dura hasta el siguiente. */
export function subtituloEn(subtitulos: Subtitulo[], T: number): Subtitulo | null {
  for (let i = 0; i < subtitulos.length; i++) {
    const s = subtitulos[i]
    const fin = s.until ?? (subtitulos[i + 1]?.at ?? CUES.total)
    if (T >= s.at && T < fin) return s
  }
  return null
}
