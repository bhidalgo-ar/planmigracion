import { addDays, parseISO } from 'date-fns'
import type { Asignacion, Config, Persona, Proyecto, Violacion } from './types'
import { feriadosDeConfig, toISO } from './utils/dates'
import { claveViolacion, computeViolaciones, DESFASAJE_PRUEBAS_DEFAULT, fechaCorteDe, MARGEN_MINIMO_DEFAULT, mesReservadoDiciembre } from './rules'
import { cuentasEnAxton, disponibilidadMes, horasDeBarra, horasDiaDe, horasPorDiaHabil } from './capacidad'
import { cuentasPorDia, topeParalelo } from './paralelo'
import { nombreTarea } from './tareas'

/**
 * Planificador que respeta la capacidad (23/10/2026, "la inteligencia de la Mesa de salidas").
 *
 * El planificador clásico (`planificador.ts`) arma las fases hacia atrás desde el corte con
 * duraciones fijas y deja los choques de carga a la vista en las reglas. Este, para el mes
 * de salida elegido, busca dónde entra cada tarea sin pasar a nadie del 100 % de su
 * disponibilidad en ningún día hábil, y dice si la cuenta entra o no y por qué:
 *
 *  - La primera liquidación (`_fase: 'Liquidacion en vivo'`) es fija: arranca el día del corte
 *    del mes de salida. La de implementación dura hasta el 5° hábil del mes siguiente con las
 *    mismas horas por día que traía; la de payroll conserva su duración.
 *  - Las tareas de armado (relevamiento, configuración, pruebas y las de payroll con el
 *    cliente) se ubican hacia adelante respetando las `predecesoras` (Pruebas → Pruebas
 *    arrancan N hábiles después de que arranca la otra). Si la persona no tiene lugar, la
 *    tarea se estira con menos horas por día; nunca se le suman horas.
 *  - El cierre (Actualización final) va lo más cerca posible del corte, `margen_minimo_habiles`
 *    antes, después de todo lo anterior.
 *  - Reglas duras: capacidad diaria (con vacaciones = 0), tope de cuentas en paralelo del
 *    equipo, blackout de configuración y una cuenta abierta como máximo `maxMeses` meses.
 *  - Los analistas de payroll (`rol: 'payroll'`) no tienen capacidad relevada: sus tareas se
 *    ubican sin control de carga.
 *
 * Busca el arranque más tarde que funciona (así la cuenta no queda abierta de más) y, si no
 * hay ninguno, devuelve el motivo más frecuente. Aritmética pura: `test/nivelado.test.ts`.
 */

export interface OpcionesNivelado {
  /** Fecha de hoy (ISO): ninguna tarea arranca antes. */
  hoyISO: string
  /** Meses máximos que una cuenta puede estar abierta, del relevamiento a la entrega. 0 = sin límite. Default 4. */
  maxMeses?: number
  /** Cuentas cuyas barras NO se cuentan como carga (las que todavía no se replanificaron). */
  excluir?: ReadonlySet<string>
}

export type ResultadoNivelado =
  | { ok: true; asignaciones: Asignacion[]; corte: string; entrega: string; inicio: string }
  | { ok: false; motivo: string }

export const MAX_MESES_DEFAULT = 4

/** Meses máximos de cuenta abierta del plan (`reglas_calendario.max_meses_cuenta_abierta`), default 4. */
export function maxMesesDe(config: Config): number {
  const v = config.reglas_calendario?.max_meses_cuenta_abierta
  return typeof v === 'number' && v >= 0 ? v : MAX_MESES_DEFAULT
}
const DIAS_POR_MES = 21
const DED_MINIMA = 0.07

/** Una barra es de la primera liquidación en vivo si su `_fase` lo dice. */
export function esLiquidacionEnVivo(a: Asignacion): boolean {
  // El v18 la marca como tipo Cierre + `_fase`; el PR #39 (borrador) la convierte a un tipo propio.
  return a._fase === 'Liquidacion en vivo' || (a.tipo as string) === 'Liquidacion en vivo'
}

/** La cuenta ya arrancó: tiene alguna barra de armado que empezó antes de hoy. No se mueve sola. */
export function cuentaArrancada(proyectoId: string, asignaciones: Asignacion[], hoyISO: string): boolean {
  return asignaciones.some(a => a.proyecto_id === proyectoId && !a.es_bloqueo && !esLiquidacionEnVivo(a) && a.inicio < hoyISO)
}

// ── calendario por índice de día hábil ────────────────────────────────────────────

interface Calendario {
  dias: string[]
  idx: Map<string, number>
  /** Índice del día hábil igual o anterior. */
  alOAntes(iso: string): number
  /** Índice del día hábil igual o posterior. */
  alODespues(iso: string): number
}

function calendario(desdeISO: string, hastaISO: string, feriados: ReadonlySet<string>): Calendario {
  const dias: string[] = []
  const idx = new Map<string, number>()
  for (let d = parseISO(desdeISO); toISO(d) <= hastaISO; d = addDays(d, 1)) {
    const iso = toISO(d), dow = d.getDay()
    if (dow !== 0 && dow !== 6 && !feriados.has(iso)) { idx.set(iso, dias.length); dias.push(iso) }
  }
  const buscar = (iso: string, paso: number) => {
    // Fuera del calendario: se recorta a sus bordes (una barra que sigue después del último
    // día cuenta hasta ese día; una que empezó antes del primero, desde el primero).
    if (!dias.length) return paso < 0 ? -1 : 0
    if (iso > dias[dias.length - 1]) return paso < 0 ? dias.length - 1 : dias.length
    if (iso < dias[0]) return paso < 0 ? -1 : 0
    let d = parseISO(iso)
    for (let i = 0; i < 15; i++) {
      const k = idx.get(toISO(d))
      if (k !== undefined) return k
      d = addDays(d, paso)
    }
    return paso < 0 ? -1 : dias.length
  }
  return { dias, idx, alOAntes: iso => buscar(iso, -1), alODespues: iso => buscar(iso, 1) }
}

function addMes(mes: string, k: number): string {
  let [y, m] = mes.split('-').map(Number)
  m += k
  while (m > 12) { m -= 12; y++ }
  while (m < 1) { m += 12; y-- }
  return `${y}-${String(m).padStart(2, '0')}`
}

// ── el planificador ───────────────────────────────────────────────────────────────

export function planificarCuentaNivelada(
  proyectoId: string, asignaciones: Asignacion[], mesSalida: string,
  personas: Persona[], config: Config, proyectos: Proyecto[], opciones: OpcionesNivelado,
): ResultadoNivelado {
  const nombre = proyectos.find(p => p.id === proyectoId)?.nombre ?? proyectoId
  const propias = asignaciones.filter(a => a.proyecto_id === proyectoId && !a.es_bloqueo)
  if (!propias.length) return { ok: false, motivo: 'La cuenta no tiene fases planificadas.' }
  if (cuentaArrancada(proyectoId, asignaciones, opciones.hoyISO)) {
    return { ok: false, motivo: `${nombre} ya arrancó: sus tareas en curso no se mueven solas. Ajustalas a mano o usá el planificador clásico.` }
  }

  const feriados = feriadosDeConfig(config)
  const corteISO = fechaCorteDe(proyectoId, mesSalida, config, feriados)
  if (!corteISO) return { ok: false, motivo: `[FALTA: corte de novedades de ${nombre} para ${mesSalida}]` }

  const cfg: Config = { ...config, salidas_en_vivo_propuestas: { ...(config.salidas_en_vivo_propuestas ?? {}), [proyectoId]: mesSalida } }
  // Regla de diciembre del plan: ese diciembre es de una sola cuenta y, si lo pide, sin Moni para las demás.
  const reservado = mesReservadoDiciembre(cfg)
  if (reservado && reservado.id !== proyectoId && reservado.mes === mesSalida) {
    const unica = proyectos.find(p => p.id === reservado.id)?.nombre ?? reservado.id
    return { ok: false, motivo: `Ese diciembre el plan lo reserva para ${unica}.` }
  }
  const moniSinDiciembre = !!(reservado && reservado.id !== proyectoId && config.reglas_calendario?.diciembre_sin_moni)
  const hasta = `${addMes(mesSalida, 3)}-28`
  const cal = calendario(`${opciones.hoyISO.slice(0, 7)}-01`, hasta > config.horizonte.hasta ? hasta : config.horizonte.hasta, feriados)
  const N = cal.dias.length
  const HOY = cal.alODespues(opciones.hoyISO)
  const corte = cal.alOAntes(corteISO)
  const margen = config.capacidad?.margen_minimo_habiles ?? MARGEN_MINIMO_DEFAULT
  const limiteCierre = corte - margen
  const lag = config.reglas_calendario?.desfasaje_pruebas_habiles ?? DESFASAJE_PRUEBAS_DEFAULT
  const blackout = config.tiers_v3?.blackout_config
  const maxMeses = opciones.maxMeses ?? maxMesesDe(config)
  const maxAbierta = maxMeses > 0 ? maxMeses * DIAS_POR_MES : Infinity
  if (corte < HOY + 3) return { ok: false, motivo: `El corte de ${mesSalida} ya pasó o está demasiado cerca.` }

  const personaDe = new Map(personas.map(p => [p.id, p]))
  const esPayroll = (pid: string) => personaDe.get(pid)?.rol === 'payroll'
  const aliasDe = (pid: string) => personaDe.get(pid)?.alias ?? pid

  // Carga base de todas las personas con el resto del plan (sin esta cuenta ni las excluidas).
  const otras = asignaciones.filter(a => a.proyecto_id !== proyectoId && !(a.proyecto_id && opciones.excluir?.has(a.proyecto_id)))
  const carga = new Map<string, Float64Array>()
  const cargaDe = (pid: string) => {
    let c = carga.get(pid)
    if (!c) { c = new Float64Array(N); carga.set(pid, c) }
    return c
  }
  const vac = new Map<string, Set<number>>()
  for (const a of otras) {
    if (a.tipo === 'Vacaciones') {
      let s = vac.get(a.persona_id)
      if (!s) { s = new Set(); vac.set(a.persona_id, s) }
      for (let i = cal.alODespues(a.inicio); i <= cal.alOAntes(a.fin) && i < N; i++) if (i >= 0) s.add(i)
      continue
    }
    if (a.es_bloqueo) continue
    const h = horasPorDiaHabil(a, personaDe.get(a.persona_id), config, feriados)
    if (!(h > 0)) continue
    const c = cargaDe(a.persona_id)
    for (let i = Math.max(0, cal.alODespues(a.inicio)); i <= cal.alOAntes(a.fin) && i < N; i++) c[i] += h
  }
  // Capacidad diaria en horas: jornada × disponibilidad del mes (con esta cuenta saliendo en su mes).
  const capMes = new Map<string, number>()
  const capDe = (pid: string, i: number): number => {
    if (esPayroll(pid)) return Infinity
    if (vac.get(pid)?.has(i)) return 0
    const mes = cal.dias[i].slice(0, 7), k = `${pid}|${mes}`
    let v = capMes.get(k)
    if (v === undefined) {
      const p = personaDe.get(pid)
      // carga_maxima_pct: a quien se le permite pasar del 100 % (ej. 1,2) se le estira el tope del día.
      v = horasDiaDe(p, config) * disponibilidadMes(pid, mes, cfg, cuentasEnAxton(mes, cfg), p) * (p?.carga_maxima_pct ?? 1)
      if (moniSinDiciembre && pid === 'moni' && mes === reservado!.mes) v = 0
      capMes.set(k, v)
    }
    return v
  }
  // Cuentas en paralelo del equipo, sin esta.
  const tope = topeParalelo(config)
  const porDia = cuentasPorDia(otras, feriados)
  const lleno = (i: number) => (porDia.get(cal.dias[i])?.size ?? 0) >= tope
  const enBlackout = (i: number) => !!blackout && blackout.length === 2 && cal.dias[i] >= blackout[0] && cal.dias[i] <= blackout[1]

  const libre = (pid: string, i: number, tipo: Asignacion['tipo']) => {
    if (i < HOY || i >= N || lleno(i)) return 0
    if (tipo === 'Configuracion' && enBlackout(i)) return 0
    return Math.max(0, capDe(pid, i) - cargaDe(pid)[i])
  }
  const sumar = (pid: string, s: number, e: number, h: number, signo = 1) => {
    if (esPayroll(pid)) return
    const c = cargaDe(pid)
    for (let i = s; i <= e; i++) c[i] += signo * h
  }

  /** Horas totales de una barra y horas por día de su versión original. */
  const horasDe = (a: Asignacion) => {
    const h = horasDeBarra(a)
    const hd = horasDiaDe(personaDe.get(a.persona_id), config)
    return h !== null ? h : hd * a.dedicacion_pct * Math.max(1, a.duracion_dias)
  }
  const salida = (a: Asignacion, s: number, e: number, horasDia: number): Asignacion => {
    const hd = horasDiaDe(personaDe.get(a.persona_id), config)
    const dur = e - s + 1
    const out: Asignacion = { ...a, inicio: cal.dias[s], fin: cal.dias[e], duracion_dias: dur, dedicacion_pct: Math.round((horasDia / hd) * 1000) / 1000 }
    if (horasDeBarra(a) !== null) out._horas = Math.round(horasDia * dur * 10) / 10
    return out
  }

  // 1. Primera liquidación: fija desde el corte.
  const liq = propias.filter(esLiquidacionEnVivo)
  const finLiq = cal.alODespues(`${addMes(mesSalida, 1)}-01`) + 4
  const nuevas = new Map<string, Asignacion>()
  for (const a of liq) {
    const durOrig = Math.max(1, a.duracion_dias)
    const porDiaH = horasDe(a) / durOrig
    let e = esPayroll(a.persona_id) ? corte + durOrig - 1 : finLiq
    // Vacaciones en la cola del acompañamiento (después de la semana de la liquidación): se
    // recorta hasta el día anterior; en esos días acompañan los demás. Encima de la semana
    // de la liquidación no se puede.
    const vacP = vac.get(a.persona_id)
    if (vacP && !esPayroll(a.persona_id)) {
      for (let i = corte + 5; i <= e; i++) if (vacP.has(i)) { e = i - 1; break }
    }
    for (let i = corte; i <= e; i++) {
      if (i >= N) return { ok: false, motivo: `Ese mes queda fuera del calendario del plan.` }
      if (!esPayroll(a.persona_id) && libre(a.persona_id, i, a.tipo) < porDiaH - 1e-6) {
        const motivo = vac.get(a.persona_id)?.has(i) ? `cae en las vacaciones de ${aliasDe(a.persona_id)}` : lleno(i) ? `ese día ya hay ${tope} cuentas abiertas` : `${aliasDe(a.persona_id)} no tiene lugar`
        return { ok: false, motivo: `La primera liquidación (${cal.dias[i].slice(8, 10)}/${cal.dias[i].slice(5, 7)}) ${motivo}.` }
      }
    }
    sumar(a.persona_id, corte, e, porDiaH)
    nuevas.set(a.id, salida(a, corte, e, porDiaH))
  }

  // 2. Armado y cierre: orden por predecesoras (o por tipo si el plan no las trae).
  const armado = propias.filter(a => !esLiquidacionEnVivo(a))
  const cierres = armado.filter(a => a.tipo === 'Cierre')
  const build = armado.filter(a => a.tipo !== 'Cierre')
  const ids = new Set(armado.map(a => a.id))
  const sinPreds = !armado.some(a => a.predecesoras.some(p => ids.has(p)))
  const RANGO: Record<string, number> = { Relevamiento: 0, Configuracion: 1, Pruebas: 2, Cierre: 3 }
  const predsDe = (a: Asignacion): string[] => sinPreds
    ? armado.filter(b => (RANGO[b.tipo] ?? 0) === (RANGO[a.tipo] ?? 0) - 1).map(b => b.id)
    : a.predecesoras.filter(p => ids.has(p))
  const orden: Asignacion[] = []
  {
    const hechos = new Set<string>(), pend = build.slice().sort((x, y) => (x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0))
    for (let guard = 0; pend.length && guard < 200; guard++) {
      const k = pend.findIndex(a => predsDe(a).filter(p => !cierres.some(c => c.id === p)).every(p => hechos.has(p)))
      const a = pend.splice(k < 0 ? 0 : k, 1)[0]
      orden.push(a); hechos.add(a.id)
    }
  }
  const nominal = orden.reduce((s, a) => s + Math.max(1, a.duracion_dias), 0) + cierres.length + 6
  const fallas = new Map<string, number>()
  const falla = (k: string) => fallas.set(k, (fallas.get(k) ?? 0) + 1)

  function intentar(s0: number): Map<string, Asignacion> | null {
    const puestas: Array<{ a: Asignacion; s: number; e: number; h: number }> = []
    const deshacer = () => { for (const p of puestas) sumar(p.a.persona_id, p.s, p.e, p.h, -1) }
    const pos = new Map<string, { s: number; e: number }>()
    const temprano = (a: Asignacion) => {
      let t = s0
      for (const p of predsDe(a)) {
        const q = pos.get(p); if (!q) continue
        const pa = armado.find(x => x.id === p)!
        t = Math.max(t, pa.tipo === 'Pruebas' && a.tipo === 'Pruebas' ? q.s + lag : q.e + 1)
      }
      return t
    }
    for (const a of orden) {
      const desde = temprano(a), hTot = horasDe(a)
      const nom = Math.max(1, a.duracion_dias), hNom = hTot / nom
      if (esPayroll(a.persona_id)) {
        if (desde + nom - 1 >= limiteCierre) { falla(a.id); deshacer(); return null }
        pos.set(a.id, { s: desde, e: desde + nom - 1 }); puestas.push({ a, s: desde, e: desde + nom - 1, h: hNom })
        continue
      }
      let mejor: { s: number; e: number; h: number } | null = null
      for (let x = desde; x < limiteCierre; x++) {
        if (mejor && x >= mejor.e) break
        let mn = Infinity
        for (let d = 1; d <= nom * 4; d++) {
          const i = x + d - 1
          if (i >= limiteCierre) break
          mn = Math.min(mn, libre(a.persona_id, i, a.tipo))
          if (mn < DED_MINIMA * horasDiaDe(personaDe.get(a.persona_id), config)) break
          const need = hTot / d
          if (need <= Math.min(mn, hNom) + 1e-9) { if (!mejor || i < mejor.e) mejor = { s: x, e: i, h: need }; break }
        }
      }
      if (!mejor) { falla(a.id); deshacer(); return null }
      sumar(a.persona_id, mejor.s, mejor.e, mejor.h)
      pos.set(a.id, { s: mejor.s, e: mejor.e }); puestas.push({ a, ...mejor })
    }
    // Cierre: de atrás para adelante, pegado al límite.
    let tope2 = limiteCierre
    const cierresOrd = cierres.slice().sort((x, y) => (x.inicio < y.inicio ? -1 : 1))
    for (let k = cierresOrd.length - 1; k >= 0; k--) {
      const a = cierresOrd[k], dur = Math.max(1, a.duracion_dias), h = horasDe(a) / dur
      const minimo = Math.max(s0, ...predsDe(a).filter(p => pos.has(p)).map(p => pos.get(p)!.e + 1), ...orden.map(b => pos.get(b.id)!.e + 1).filter(() => sinPreds))
      let ok = false
      for (let e = tope2; e - dur + 1 >= minimo; e--) {
        let entra = true
        for (let i = e - dur + 1; i <= e; i++) if (!esPayroll(a.persona_id) && libre(a.persona_id, i, a.tipo) < h - 1e-6) { entra = false; break }
        if (!entra) continue
        sumar(a.persona_id, e - dur + 1, e, h); puestas.push({ a, s: e - dur + 1, e, h }); pos.set(a.id, { s: e - dur + 1, e })
        tope2 = e - dur; ok = true; break
      }
      if (!ok) { falla('__cierre'); deshacer(); return null }
    }
    const ini = Math.min(...[...pos.values()].map(p => p.s))
    const fin = Math.max(...[...pos.values()].map(p => p.e))
    if (fin - ini + 1 > maxAbierta) { falla('__abierta'); deshacer(); return null }
    const out = new Map<string, Asignacion>()
    for (const p of puestas) out.set(p.a.id, salida(p.a, p.s, p.e, p.h))
    deshacer()
    return out
  }

  const sMin = Math.max(HOY, limiteCierre - (Number.isFinite(maxAbierta) ? maxAbierta : 200))
  // Al menos un arranque dentro de la ventana: arrancando justo en sMin, con el cierre pegado al
  // límite, la cuenta queda abierta maxAbierta + 1 días. Antes, cuando la duración nominal
  // ocupaba toda la ventana, era el único que se probaba y la cuenta entraba solo si alguna
  // tarea se demoraba por falta de lugar (más capacidad hacía que dejara de entrar).
  const sMax = Math.max(sMin + 1, HOY, limiteCierre - nominal - 8)
  let plan: Map<string, Asignacion> | null = null
  for (let s = sMax; s >= sMin && !plan; s--) plan = intentar(s)
  if (!plan) {
    const peor = [...fallas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    let motivo = 'No entra con la capacidad disponible.'
    if (peor === '__cierre') motivo = `No hay lugar para la actualización final antes del corte (${corteISO.slice(8, 10)}/${corteISO.slice(5, 7)}).`
    else if (peor === '__abierta') motivo = `Quedaría abierta más de ${maxMeses} meses.`
    else if (peor) {
      const a = armado.find(x => x.id === peor)!
      motivo = esPayroll(a.persona_id)
        ? `No llega a ${nombreTarea(a).toLowerCase()} antes del cierre.`
        : `${aliasDe(a.persona_id)} no tiene lugar para ${nombreTarea(a).toLowerCase()} antes del corte.`
    }
    return { ok: false, motivo }
  }
  for (const [id, a] of plan) nuevas.set(id, a)
  const resultado = propias.map(a => nuevas.get(a.id) ?? a)
  const armadas = resultado.filter(a => !esLiquidacionEnVivo(a))
  return {
    ok: true, asignaciones: resultado, corte: corteISO,
    inicio: armadas.map(a => a.inicio).sort()[0],
    entrega: armadas.filter(a => a.tipo === 'Cierre').map(a => a.fin).sort().pop() ?? armadas.map(a => a.fin).sort().pop()!,
  }
}

// ── replanificar todo el plan ─────────────────────────────────────────────────────

export interface ReporteReplanNivelado {
  replanificadas: string[]
  /** Cuentas que no entran en su mes, con el motivo. Quedan como estaban. */
  noEntran: Array<{ nombre: string; mes: string; motivo: string }>
  /** Cuentas que ya arrancaron: no se tocan. */
  enCurso: string[]
}

/**
 * Rearma todas las cuentas con el mes que ya tienen, respetando capacidad. Va por mes de
 * salida (las que salen antes eligen primero); las que todavía no se rearmaron no cuentan
 * como carga, así no se bloquean entre sí. Si alguna no entra, prueba una vez más poniéndola
 * primera en su mes. Las cuentas que ya arrancaron quedan como están.
 */
export function replanificarTodoNivelado(
  asignaciones: Asignacion[], personas: Persona[], config: Config, proyectos: Proyecto[], opciones: OpcionesNivelado,
): { asignaciones: Asignacion[]; reporte: ReporteReplanNivelado } {
  const meses = config.salidas_en_vivo_propuestas ?? {}
  const mesDe = (id: string) => (typeof meses[id] === 'string' ? (meses[id] as string) : null)
  const reporte: ReporteReplanNivelado = { replanificadas: [], noEntran: [], enCurso: [] }
  const candidatas = proyectos.filter(p => mesDe(p.id) && asignaciones.some(a => a.proyecto_id === p.id && !a.es_bloqueo))
  const enCurso = candidatas.filter(p => cuentaArrancada(p.id, asignaciones, opciones.hoyISO))
  reporte.enCurso = enCurso.map(p => p.nombre)
  const aMover = candidatas.filter(p => !enCurso.includes(p))
  const ordenBase = aMover.slice().sort((a, b) => mesDe(a.id)!.localeCompare(mesDe(b.id)!)
    || (asignaciones.find(x => x.proyecto_id === a.id)?.inicio ?? '').localeCompare(asignaciones.find(x => x.proyecto_id === b.id)?.inicio ?? ''))

  const correr = (orden: Proyecto[]) => {
    let lista = asignaciones
    // Las que faltan rearmar y las que no entraron no cuentan como carga: no deben trabar a las demás.
    const pendientes = new Set(orden.map(p => p.id))
    const ok: string[] = [], no: ReporteReplanNivelado['noEntran'] = []
    for (const p of orden) {
      pendientes.delete(p.id)
      const r = planificarCuentaNivelada(p.id, lista, mesDe(p.id)!, personas, config, proyectos, { ...opciones, excluir: pendientes })
      if (r.ok) {
        const porId = new Map(r.asignaciones.map(a => [a.id, a]))
        lista = lista.map(a => porId.get(a.id) ?? a)
        ok.push(p.nombre)
      } else {
        no.push({ nombre: p.nombre, mes: mesDe(p.id)!, motivo: r.motivo })
        pendientes.add(p.id)
      }
    }
    return { lista, ok, no }
  }
  let mejor = correr(ordenBase)
  if (mejor.no.length) {
    const nombresNo = new Set(mejor.no.map(n => n.nombre))
    const segundo = correr(ordenBase.slice().sort((a, b) => mesDe(a.id)!.localeCompare(mesDe(b.id)!) || Number(nombresNo.has(b.nombre)) - Number(nombresNo.has(a.nombre))))
    if (segundo.no.length < mejor.no.length) mejor = segundo
  }
  reporte.replanificadas = mejor.ok
  reporte.noEntran = mejor.no
  return { asignaciones: mejor.lista, reporte }
}

// ── rearmar adelantando ───────────────────────────────────────────────────────────

export interface ReporteAdelantar {
  /** Cuentas que cambiaron de mes de salida, con el mes de antes y el de ahora. */
  movidas: Array<{ id: string; nombre: string; antes: string; despues: string }>
  /** Cuentas que se rearmaron en el mismo mes que tenían. */
  igual: string[]
  /** Cuentas que no entran en ningún mes hasta el suyo: quedan como estaban. */
  noEntran: Array<{ nombre: string; mes: string; motivo: string }>
  /** Cuentas que ya arrancaron: no se tocan. */
  enCurso: string[]
}

/** Las reglas que el rearmado no puede romper: todas las rojas menos las de carga (esas se miran a la vista). */
const REGLAS_DE_CARGA = new Set(['carga_mes', 'carga_semana'])
const rojosDuros = (vs: Violacion[]) => new Set(vs.filter(v => v.severidad === 'rojo' && !REGLAS_DE_CARGA.has(v.tipo)).map(claveViolacion))

/**
 * Rearma el calendario adelantando cada cuenta que no arrancó al primer mes donde entra
 * (23/10/2026, escenarios de capacidad: "si subo el tope, ¿cómo quedaría?"). Va en el orden
 * de salida del plan; las que todavía no se rearmaron no cuentan como carga. Para cada mes,
 * desde hoy hasta el que la cuenta ya tenía, prueba con el planificador que respeta capacidad
 * y acepta el primero que no agrega ningún conflicto rojo que no sea de carga (tope de
 * salidas, margen, blackout, dependencias, vacaciones, cuentas en paralelo). Nunca atrasa una
 * cuenta: si no entra antes, se rearma en su mes; si tampoco, queda como estaba.
 *
 * Es un acomodo posible, no el mejor: el orden de salida decide quién elige primero.
 */
export function adelantarTodoNivelado(
  asignaciones: Asignacion[], personas: Persona[], config: Config, proyectos: Proyecto[], opciones: OpcionesNivelado,
): { asignaciones: Asignacion[]; config: Config; reporte: ReporteAdelantar } {
  const salidas = config.salidas_en_vivo_propuestas ?? {}
  const mesDe = (id: string, cfg: Config) => {
    const v = (cfg.salidas_en_vivo_propuestas ?? {})[id]
    return typeof v === 'string' ? v : null
  }
  const reporte: ReporteAdelantar = { movidas: [], igual: [], noEntran: [], enCurso: [] }
  const candidatas = proyectos.filter(p => typeof salidas[p.id] === 'string' && asignaciones.some(a => a.proyecto_id === p.id && !a.es_bloqueo))
  const enCurso = candidatas.filter(p => cuentaArrancada(p.id, asignaciones, opciones.hoyISO))
  reporte.enCurso = enCurso.map(p => p.nombre)
  const primerInicio = (id: string) => asignaciones.filter(a => a.proyecto_id === id && !a.es_bloqueo).map(a => a.inicio).sort()[0] ?? ''
  const orden = candidatas.filter(p => !enCurso.includes(p))
    .sort((a, b) => mesDe(a.id, config)!.localeCompare(mesDe(b.id, config)!) || primerInicio(a.id).localeCompare(primerInicio(b.id)))

  const meses: string[] = []
  for (let m = opciones.hoyISO.slice(0, 7); m <= config.horizonte.hasta.slice(0, 7) && meses.length < 60; m = addMes(m, 1)) meses.push(m)

  let lista = asignaciones
  let cfg = config
  const pendientes = new Set(orden.map(p => p.id))
  const visibles = (A: Asignacion[]) => A.filter(a => !a.proyecto_id || !pendientes.has(a.proyecto_id))
  for (const p of orden) {
    pendientes.delete(p.id)
    const actual = mesDe(p.id, cfg)!
    const antes = rojosDuros(computeViolaciones(visibles(lista), personas, cfg, proyectos))
    let puesta = false
    let motivo = ''
    for (const mes of meses) {
      if (mes > actual) break
      const r = planificarCuentaNivelada(p.id, lista, mes, personas, cfg, proyectos, { ...opciones, excluir: pendientes })
      if (!r.ok) { motivo = r.motivo; continue }
      const porId = new Map(r.asignaciones.map(a => [a.id, a]))
      const nuevas = lista.map(a => porId.get(a.id) ?? a)
      const cfg2: Config = { ...cfg, salidas_en_vivo_propuestas: { ...(cfg.salidas_en_vivo_propuestas ?? {}), [p.id]: mes } }
      const despues = rojosDuros(computeViolaciones(visibles(nuevas), personas, cfg2, proyectos))
      const nuevo = [...despues].find(k => !antes.has(k))
      if (nuevo) {
        const v = computeViolaciones(visibles(nuevas), personas, cfg2, proyectos).find(x => claveViolacion(x) === nuevo)
        motivo = v?.mensaje ?? 'Agrega un conflicto.'
        continue
      }
      lista = nuevas
      cfg = cfg2
      puesta = true
      if (mes === actual) reporte.igual.push(p.nombre)
      else reporte.movidas.push({ id: p.id, nombre: p.nombre, antes: actual, despues: mes })
      break
    }
    if (!puesta) reporte.noEntran.push({ nombre: p.nombre, mes: actual, motivo })
  }
  return { asignaciones: lista, config: cfg, reporte }
}
