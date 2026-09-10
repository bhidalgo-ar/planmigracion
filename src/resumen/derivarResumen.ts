import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, SeveridadViolacion, TipoFase, Violacion } from '../types'
import { mesDe, mesesEntre, salidasFueraDelPlan, ultimoDiaDelMesISO } from '../capacidad'
import { computeViolaciones } from '../rules'
import { toISO } from '../utils/dates'

/**
 * El contrato de datos del video del resumen ejecutivo.
 *
 * Regla única de todo el módulo `resumen/`: ningún nombre de cuenta, mes, número ni
 * texto vive en el componente que dibuja. Todo sale de acá, y esto sale del plan que
 * está cargado en la app. Si Willy mueve una fase, cambia un mes de salida o importa
 * otro JSON, el video se regenera solo porque `ResumenData` cambió.
 *
 * No lee `config.equipo_confidencial`: el video no muestra datos del bloque reservado.
 */

// ── nombres de meses ─────────────────────────────────────────────────────────────
// A mano y no con date-fns porque el locale español abrevia septiembre como "sept" y
// el diseño del video pide tres letras parejas en todos los meses.

const CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function mesNumero(mesISO: string): number {
  return Number(mesISO.slice(5, 7)) - 1
}

/** '2027-04' → 'abr' */
export function mesCorto(mesISO: string): string {
  return CORTOS[mesNumero(mesISO)] ?? mesISO
}

/** '2027-04' → 'abril' */
export function mesLargo(mesISO: string): string {
  return LARGOS[mesNumero(mesISO)] ?? mesISO
}

/** '2027-04' → 'abril 2027' */
export function mesYAnio(mesISO: string): string {
  return `${mesLargo(mesISO)} ${mesISO.slice(0, 4)}`
}

/** '2027-04' → 'Abril 2027' */
export function mesYAnioCap(mesISO: string): string {
  const s = mesYAnio(mesISO)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** '2027-04' → 'abril de 2027' (para leerlo dentro de una oración). */
export function mesDeAnio(mesISO: string): string {
  return `${mesLargo(mesISO)} de ${mesISO.slice(0, 4)}`
}

/** '2026-09-10' → '10 de septiembre de 2026' */
export function fechaLarga(iso: string): string {
  const dia = Number(iso.slice(8, 10))
  return `${dia} de ${mesLargo(iso.slice(0, 7))} de ${iso.slice(0, 4)}`
}

/** '2026-12-21' → '21 dic' (etiquetas del eje semanal del gantt). */
export function diaYMesCorto(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${mesCorto(iso.slice(0, 7))}`
}

// ── tipos ────────────────────────────────────────────────────────────────────────

export interface Salida {
  id: string
  nombre: string
  /** 'YYYY-MM' */
  mes: string
  /** 'sep' */
  mesCorto: string
  /** 'Q4 2026' */
  trimestre: string
  /** true para las cuentas que salen en vivo sin pasar por fases (POF, Finadiet). */
  fueraDelPlan: boolean
}

export interface TrimestreResumen {
  /** 'Q4 2026' */
  label: string
  /** 'oct – dic · 6 salidas' */
  sub: string
  salidas: Salida[]
}

export interface MesResumen {
  /** 'YYYY-MM' */
  key: string
  /** 'oct 26' */
  label: string
  salidas: Salida[]
}

export interface BarraCuello {
  fase: TipoFase
  desde: string
  hasta: string
}

export interface FilaCuello {
  cuenta: string
  barras: BarraCuello[]
  /** Días que la cuenta tiene ocupados dentro de la ventana (para recortar filas si hay muchas). */
  dias: number
}

export interface Cuello {
  /** 'YYYY-MM' */
  mes: string
  /** 'Enero 2027' */
  label: string
  cuentas: string[]
  filas: FilaCuello[]
  /** Rango que dibuja el gantt: arranca un lunes y termina un domingo. */
  ventana: { desde: string; hasta: string }
  blackout: { desde: string; hasta: string } | null
}

export interface AlertaResumen {
  severidad: SeveridadViolacion
  texto: string
}

export interface ResumenData {
  /** ISO del día que se toma como "hoy". */
  hoy: string
  yaEnAxton: number
  porMigrar: number
  total: number
  salidas: Salida[]
  trimestres: TrimestreResumen[]
  meses: MesResumen[]
  fin: { mes: string; label: string; cuenta: string }
  cuello: Cuello | null
  alertas: AlertaResumen[]
}

// ── salidas ──────────────────────────────────────────────────────────────────────

const RE_MES = /^\d{4}-\d{2}$/

function trimestreDe(mesISO: string): string {
  return `Q${Math.ceil((mesNumero(mesISO) + 1) / 3)} ${mesISO.slice(0, 4)}`
}

/**
 * Las salidas en vivo que el video cuenta: las propuestas del plan más las que salen
 * fuera del plan (ya configuradas). Quedan afuera las cuentas especiales (TASA, que no
 * es parte del programa) y las que el tablero real ya muestra migradas hoy: esas ya
 * están contadas en `yaEnAxton`, contarlas de nuevo inflaría el total.
 */
function salidasDe(proyectos: Proyecto[], config: Config): Salida[] {
  const yaEnVivo = new Set(config.cartera_legacy_axton?.cuentas_programa_ya_en_vivo ?? [])
  const porId = new Map(proyectos.map(p => [p.id, p]))
  const conOrden: Array<{ s: Salida; orden: number }> = []
  let orden = 0

  for (const [id, valor] of Object.entries(config.salidas_en_vivo_propuestas ?? {})) {
    // Las claves que arrancan con "_" son notas del JSON, no cuentas.
    if (id.startsWith('_') || typeof valor !== 'string' || !RE_MES.test(valor)) continue
    const p = porId.get(id)
    if (p?.especial || yaEnVivo.has(id)) continue
    conOrden.push({
      s: {
        id, nombre: p?.nombre ?? id, mes: valor,
        mesCorto: mesCorto(valor), trimestre: trimestreDe(valor), fueraDelPlan: false,
      },
      orden: orden++,
    })
  }

  for (const c of salidasFueraDelPlan(config)) {
    conOrden.push({
      s: {
        id: `fuera:${c.nombre}`, nombre: c.nombre, mes: c.mes,
        mesCorto: mesCorto(c.mes), trimestre: trimestreDe(c.mes), fueraDelPlan: true,
      },
      orden: orden++,
    })
  }

  return conOrden
    .sort((a, b) => (a.s.mes < b.s.mes ? -1 : a.s.mes > b.s.mes ? 1 : a.orden - b.orden))
    .map(x => x.s)
}

function agruparTrimestres(salidas: Salida[]): TrimestreResumen[] {
  const orden: string[] = []
  const porTrim = new Map<string, Salida[]>()
  for (const s of salidas) {
    if (!porTrim.has(s.trimestre)) { porTrim.set(s.trimestre, []); orden.push(s.trimestre) }
    porTrim.get(s.trimestre)!.push(s)
  }
  return orden.map(label => {
    const propias = porTrim.get(label)!
    const meses = [...new Set(propias.map(s => s.mes))].sort()
    // Un solo mes se lee mejor con el nombre entero ("abril"); varios, como rango corto.
    const rango = meses.length === 1
      ? mesLargo(meses[0])
      : `${mesCorto(meses[0])} – ${mesCorto(meses[meses.length - 1])}`
    const n = propias.length
    return { label, sub: `${rango} · ${n} ${n === 1 ? 'salida' : 'salidas'}`, salidas: propias }
  })
}

/** Eje continuo de meses: todos los del calendario entre la primera y la última salida. */
function ejeDeMeses(salidas: Salida[]): MesResumen[] {
  if (!salidas.length) return []
  const desde = salidas[0].mes
  const hasta = salidas[salidas.length - 1].mes
  return mesesEntre(`${desde}-01`, `${hasta}-01`).map(key => ({
    key,
    label: `${mesCorto(key)} ${key.slice(2, 4)}`,
    salidas: salidas.filter(s => s.mes === key),
  }))
}

// ── cuello de botella ────────────────────────────────────────────────────────────

function tocaMes(a: Asignacion, mesISO: string): boolean {
  return mesDe(a.inicio) <= mesISO && mesDe(a.fin) >= mesISO
}

/** Primer lunes desde 14 días antes del mes, hasta el primer domingo desde 6 días después. */
function ventanaDe(mesISO: string): { desde: string; hasta: string } {
  let d = addDays(parseISO(`${mesISO}-01`), -14)
  while (d.getDay() !== 1) d = addDays(d, 1)          // 1 = lunes
  let h = addDays(parseISO(ultimoDiaDelMesISO(mesISO)), 6)
  while (h.getDay() !== 0) h = addDays(h, 1)          // 0 = domingo
  return { desde: toISO(d), hasta: toISO(h) }
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((parseISO(hasta).getTime() - parseISO(desde).getTime()) / 86400000) + 1
}

/**
 * El mes crítico del plan y su gantt.
 *
 * Cuál es el mes: el de la primera alerta roja de carga que devuelve el motor de reglas
 * (`carga_mes`), que es exactamente la definición de "el equipo no da abasto". Si no hay
 * ninguna, el mes con más cuentas distintas trabajándose a la vez.
 *
 * Qué cuentas se muestran: cuando el mes viene de una alerta roja, las de la persona
 * sobrecargada — son las que producen el problema que el video está contando. Sin alerta
 * roja, todas las que tienen alguna fase en el mes.
 *
 * Las barras fusionan por tipo de fase: Gaby, Moni y Willy prueban la misma cuenta en
 * paralelo y eso es una sola barra "Pruebas" de min(inicio) a max(fin), no tres.
 */
function derivarCuello(
  asignaciones: Asignacion[], proyectos: Proyecto[], config: Config,
  salidas: Salida[], violaciones: Violacion[],
): Cuello | null {
  const fases = asignaciones.filter(a => !a.es_bloqueo && a.tipo !== 'Vacaciones' && a.proyecto_id)
  if (!fases.length) return null

  const roja = violaciones
    .filter(v => v.tipo === 'carga_mes' && v.severidad === 'rojo' && v.mes)
    .sort((a, b) => (a.mes! < b.mes! ? -1 : 1))[0]

  let mes: string | null = roja?.mes ?? null
  if (!mes) {
    const cuentasPorMes = new Map<string, Set<string>>()
    for (const a of fases) {
      for (const m of mesesEntre(a.inicio, a.fin)) {
        if (!cuentasPorMes.has(m)) cuentasPorMes.set(m, new Set())
        cuentasPorMes.get(m)!.add(a.proyecto_id!)
      }
    }
    for (const [m, set] of cuentasPorMes) {
      if (!mes || set.size > cuentasPorMes.get(mes)!.size) mes = m
    }
  }
  if (!mes) return null
  const mesCuello = mes

  const enElMes = fases.filter(a => tocaMes(a, mesCuello))
  const foco = roja?.persona_id
    ? enElMes.filter(a => a.persona_id === roja.persona_id)
    : enElMes
  const base = foco.length ? foco : enElMes

  // Orden de las filas: por cuándo arranca la primera fase de la cuenta en el mes y,
  // si empatan, por el orden en que el plan declara sus salidas en vivo.
  const ordenSalida = new Map(salidas.map((s, i) => [s.id, i]))
  const primerInicio = new Map<string, string>()
  for (const a of base) {
    const previo = primerInicio.get(a.proyecto_id!)
    if (!previo || a.inicio < previo) primerInicio.set(a.proyecto_id!, a.inicio)
  }
  const ids = [...primerInicio.keys()].sort((x, y) => {
    const ix = primerInicio.get(x)!, iy = primerInicio.get(y)!
    if (ix !== iy) return ix < iy ? -1 : 1
    return (ordenSalida.get(x) ?? 999) - (ordenSalida.get(y) ?? 999)
  })

  const ventana = ventanaDe(mesCuello)
  const nombreDe = (id: string) => proyectos.find(p => p.id === id)?.nombre ?? id

  const filas: FilaCuello[] = ids.map(id => {
    const propias = fases.filter(a =>
      a.proyecto_id === id && a.inicio <= ventana.hasta && a.fin >= ventana.desde)
    const porTipo = new Map<TipoFase, BarraCuello>()
    for (const a of propias) {
      const b = porTipo.get(a.tipo)
      if (!b) porTipo.set(a.tipo, { fase: a.tipo, desde: a.inicio, hasta: a.fin })
      else { if (a.inicio < b.desde) b.desde = a.inicio; if (a.fin > b.hasta) b.hasta = a.fin }
    }
    const barras = [...porTipo.values()].sort((a, b) => (a.desde < b.desde ? -1 : 1))
    const dias = barras.reduce((s, b) => s + diasEntre(b.desde, b.hasta), 0)
    return { cuenta: nombreDe(id), barras, dias }
  })

  const bo = config.tiers_v3?.blackout_config
  const blackout = bo && bo.length === 2 && bo[0] <= ventana.hasta && bo[1] >= ventana.desde
    ? { desde: bo[0], hasta: bo[1] }
    : null

  return {
    mes: mesCuello, label: mesYAnioCap(mesCuello),
    cuentas: filas.map(f => f.cuenta), filas, ventana, blackout,
  }
}

// ── alertas ──────────────────────────────────────────────────────────────────────

const EN_LETRAS = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez']

/** Números chicos en letras ("tres salidas"); de once para arriba, el número. */
export function enLetras(n: number, femenino = true): string {
  if (!Number.isInteger(n) || n < 0 || n > 10) return String(n)
  if (n === 1) return femenino ? 'una' : 'uno'
  return EN_LETRAS[n]
}

/**
 * Las dos alertas que muestra la escena del cuello, en el lenguaje de un gerente: la
 * carga roja del mes crítico y el mes que llega al tope de salidas. Los mensajes de
 * `rules.ts` son más precisos pero demasiado largos para una pill en pantalla.
 */
function derivarAlertas(violaciones: Violacion[], mesCuello: string | null): AlertaResumen[] {
  const out: AlertaResumen[] = []

  const roja = violaciones
    .filter(v => v.tipo === 'carga_mes' && v.severidad === 'rojo' && v.mes)
    .sort((a, b) => (a.mes! < b.mes! ? -1 : 1))[0]
  if (roja && (!mesCuello || roja.mes === mesCuello)) {
    out.push({ severidad: 'rojo', texto: `Carga del equipo en ${mesLargo(roja.mes!)} por encima de la capacidad` })
  }

  const tope = violaciones
    .filter(v => v.tipo === 'tope_salidas' && v.mes)
    .sort((a, b) => (a.severidad === b.severidad ? 0 : a.severidad === 'rojo' ? -1 : 1))[0]
  if (tope) {
    // Cuántas salidas tiene ese mes: el mensaje de la regla ya las nombra, acá alcanza el número.
    const n = Number(/tiene (\d+) salidas/.exec(tope.mensaje)?.[1] ?? 0)
    out.push({
      severidad: tope.severidad,
      texto: `${mesYAnioCap(tope.mes!)}: ${n ? enLetras(n) : 'varias'} salidas en vivo, el tope del mes`,
    })
  }

  return out.slice(0, 2)
}

// ── entrada principal ────────────────────────────────────────────────────────────

/**
 * Todo lo que el video necesita saber, calculado desde el plan cargado. Es una función
 * pura: mismas entradas, mismo resultado. Por eso se puede memoizar en el componente y
 * testear sin navegador.
 */
export function derivarResumen(
  personas: Persona[], proyectos: Proyecto[], asignaciones: Asignacion[], config: Config, hoy: Date,
): ResumenData {
  const hoyISO = toISO(hoy)
  const salidas = salidasDe(proyectos, config)

  const legacy = config.cartera_legacy_axton?.cuentas?.length ?? 0
  const yaEnPrograma = config.cartera_legacy_axton?.cuentas_programa_ya_en_vivo?.length ?? 0
  const yaEnAxton = legacy + yaEnPrograma
  const porMigrar = salidas.length

  const violaciones = computeViolaciones(asignaciones, personas, config, proyectos)
  const cuello = derivarCuello(asignaciones, proyectos, config, salidas, violaciones)

  const ultima = salidas.length ? salidas[salidas.length - 1] : null

  return {
    hoy: hoyISO,
    yaEnAxton,
    porMigrar,
    total: yaEnAxton + porMigrar,
    salidas,
    trimestres: agruparTrimestres(salidas),
    meses: ejeDeMeses(salidas),
    fin: ultima
      ? { mes: ultima.mes, label: mesYAnio(ultima.mes), cuenta: ultima.nombre }
      : { mes: '', label: 'sin definir', cuenta: 'sin definir' },
    cuello,
    alertas: derivarAlertas(violaciones, cuello?.mes ?? null),
  }
}
