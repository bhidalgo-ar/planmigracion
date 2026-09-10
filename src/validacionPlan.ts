import { z } from 'zod'
import type { Asignacion, Config, Persona, Proyecto } from './types'

/**
 * Validación del JSON que se importa (brief 10/09/2026 §4-D4). Antes, un archivo sin
 * `horizonte` dejaba la pantalla en blanco y una fase con `persona_id` inexistente
 * desaparecía sin aviso. Ahora el import devuelve un resultado legible: qué entró, qué
 * faltó y qué se ignoró. Lo que es error de forma frena el import; lo que es un dato
 * dudoso entra con aviso.
 *
 * Zod es la librería que describe "la forma esperada" del JSON y devuelve errores con la
 * ruta exacta del campo que falla (ej. `asignaciones[3].inicio`).
 */

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'tiene que ser una fecha YYYY-MM-DD')

const PersonaSchema = z.object({
  id: z.string().min(1),
  alias: z.string().min(1),
  skills: z.array(z.string()).default([]),
  rol: z.enum(['relevamiento', 'configuracion', 'pruebas']).nullable().optional(),
  capacidad_horas_semana: z.number().default(40),
  buffer_pct: z.number().default(0),
  horas_dia: z.number().positive().optional(),
}).passthrough()

const ProyectoSchema = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  complejidad: z.enum(['baja', 'media', 'alta']).nullable().default(null),
  depende_retro: z.boolean().nullable().default(null),
  entidades: z.number().default(1),
  quick_win: z.boolean().default(false),
  especial: z.boolean().default(false),
}).passthrough()

const AsignacionSchema = z.object({
  id: z.string().min(1),
  proyecto_id: z.string().nullable(),
  tipo: z.enum(['Relevamiento', 'Configuracion', 'Pruebas', 'Vacaciones']),
  persona_id: z.string().min(1),
  inicio: FECHA,
  fin: FECHA,
  duracion_dias: z.number().int().nonnegative(),
  dedicacion_pct: z.number().nonnegative(),
  predecesoras: z.array(z.string()).default([]),
  es_bloqueo: z.boolean().default(false),
}).passthrough().refine(a => a.inicio <= a.fin, { message: 'la fase termina antes de empezar (fin < inicio)', path: ['fin'] })

const FeriadoSchema = z.object({ fecha: FECHA, nombre: z.string() }).passthrough()

/** Solo lo obligatorio de `config`; el resto de las claves pasan tal cual (son contrato). */
const ConfigSchema = z.object({
  horizonte: z.object({ desde: FECHA, hasta: FECHA }).passthrough(),
  fechas_clave: z.object({}).passthrough(),
  feriados_nacionales_2026: z.array(FeriadoSchema),
  feriados_nacionales_2027: z.array(FeriadoSchema).optional(),
}).passthrough()

const PlanSchema = z.object({
  personas: z.array(PersonaSchema),
  proyectos: z.array(ProyectoSchema),
  asignaciones: z.array(AsignacionSchema),
  config: ConfigSchema,
}).passthrough()

export const CLAVES_RAIZ = ['personas', 'proyectos', 'asignaciones', 'config'] as const

export interface PlanValidado {
  personas: Persona[]
  proyectos: Proyecto[]
  asignaciones: Asignacion[]
  config: Config
}

export interface ResultadoValidacion {
  ok: boolean
  plan: PlanValidado | null
  /** Errores de forma: el plan NO se importa. */
  errores: string[]
  /** Datos dudosos: el plan se importa igual, pero conviene mirarlos. */
  avisos: string[]
  /** Claves de primer nivel que el archivo traía y la app no usa. */
  ignoradas: string[]
  resumen: { personas: number; proyectos: number; asignaciones: number; sinAsignar: number }
}

function rutaLegible(path: (string | number)[]): string {
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`)).join('')
}

/** Valida el texto de un JSON de plan. Nunca tira: todo error vuelve en `errores`. */
export function validarPlan(json: string): ResultadoValidacion {
  const vacio: ResultadoValidacion = {
    ok: false, plan: null, errores: [], avisos: [], ignoradas: [],
    resumen: { personas: 0, proyectos: 0, asignaciones: 0, sinAsignar: 0 },
  }

  let crudo: unknown
  try { crudo = JSON.parse(json) } catch (e) {
    return { ...vacio, errores: [`El archivo no es un JSON válido: ${(e as Error).message}`] }
  }
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return { ...vacio, errores: ['El archivo no tiene la forma de un plan (se esperaba un objeto con personas, proyectos, asignaciones y config).'] }
  }

  const obj = crudo as Record<string, unknown>
  const faltantes = CLAVES_RAIZ.filter(k => !(k in obj))
  if (faltantes.length) {
    return { ...vacio, errores: [`Falta${faltantes.length > 1 ? 'n' : ''} ${faltantes.map(k => `"${k}"`).join(', ')} en la raíz del archivo.`] }
  }
  const ignoradas = Object.keys(obj).filter(k => !(CLAVES_RAIZ as readonly string[]).includes(k) && !k.startsWith('_'))

  const parsed = PlanSchema.safeParse(obj)
  if (!parsed.success) {
    const errores = parsed.error.issues.slice(0, 12).map(i => `${rutaLegible(i.path)}: ${i.message}`)
    if (parsed.error.issues.length > 12) errores.push(`… y ${parsed.error.issues.length - 12} más`)
    return { ...vacio, ignoradas, errores }
  }

  const plan = parsed.data as unknown as PlanValidado
  const avisos: string[] = []

  // Referencias: persona, cuenta y predecesoras existentes.
  const personas = new Set(plan.personas.map(p => p.id))
  const proyectos = new Set(plan.proyectos.map(p => p.id))
  const fases = new Set(plan.asignaciones.map(a => a.id))
  const nombreDe = (id: string | null) => plan.proyectos.find(p => p.id === id)?.nombre ?? id ?? 'sin cuenta'
  let sinAsignar = 0
  for (const a of plan.asignaciones) {
    if (!personas.has(a.persona_id)) {
      sinAsignar++
      avisos.push(`La fase ${a.tipo} de ${nombreDe(a.proyecto_id)} está asignada a "${a.persona_id}", que no existe en personas: se muestra en la fila "Sin asignar".`)
    }
    if (a.proyecto_id && !proyectos.has(a.proyecto_id)) {
      avisos.push(`La fase ${a.tipo} "${a.id}" apunta a la cuenta "${a.proyecto_id}", que no existe en proyectos.`)
    }
    for (const pred of a.predecesoras) {
      if (!fases.has(pred)) avisos.push(`La fase ${a.tipo} de ${nombreDe(a.proyecto_id)} depende de "${pred}", que no existe: esa dependencia se ignora.`)
    }
  }
  const idsDuplicados = plan.asignaciones.map(a => a.id).filter((id, i, arr) => arr.indexOf(id) !== i)
  if (idsDuplicados.length) avisos.push(`Hay ids de fase repetidos: ${[...new Set(idsDuplicados)].join(', ')}.`)
  if (plan.config.horizonte.desde > plan.config.horizonte.hasta) {
    return { ...vacio, ignoradas, errores: ['config.horizonte: "desde" es posterior a "hasta".'] }
  }
  if (ignoradas.length) avisos.push(`Claves de la raíz que la app no usa y se ignoran: ${ignoradas.join(', ')}.`)

  return {
    ok: true, plan, errores: [], avisos, ignoradas,
    resumen: { personas: plan.personas.length, proyectos: plan.proyectos.length, asignaciones: plan.asignaciones.length, sinAsignar },
  }
}
