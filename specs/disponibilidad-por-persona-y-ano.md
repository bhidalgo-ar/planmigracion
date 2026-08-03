# Spec — Duraciones derivadas de horas y disponibilidad por persona/año

Simulador de Migración H&A · repo `bhidalgo-ar/planmigracion`

---

## ⚠️ Supuestos asumidos

- **Tareas que cruzan el 31/12.** No estaba definido. Se asume **consumo día por día**: cada día hábil suma `8 × disponibilidad(persona, año_de_ese_día)` y la fase termina el día en que se completan las horas. Descartada la alternativa de usar la disponibilidad de la fecha de inicio para toda la fase, porque genera un acantilado el 31/12 (una config de Moni que arranca el 31/12/2026 duraría 12 días y la misma arrancando el 04/01/2027 duraría 15: correr la barra un día cambiaría la duración tres).
- **Gaby.** Se mantiene tal cual está: 20 h/sem, 4 h/día, disponibilidad 0,50 constante en 2026 y 2027. La disponibilidad del 70%/90% **no** se le aplica.
- **Factor de las cuentas chicas (0,25 sobre la parte variable).** Sigue siendo una hipótesis sin medir. Se implementa como dato en `config.json` para poder cambiarlo sin tocar código.

---

## 1. Guardrails

**Puede modificar:**
- `src/store.ts`
- `src/rules.ts`
- `src/utils/dates.ts`
- `src/types.ts`
- `data/config.json`
- `data/personas.json`

**No puede modificar bajo ninguna circunstancia:**
- Las **claves del esquema de export/import** de `Asignacion`: `id`, `proyecto_id`, `tipo`, `persona_id`, `inicio`, `fin`, `duracion_dias`, `dedicacion_pct`, `predecesoras`, `es_bloqueo`. Puede **agregar** claves opcionales, nunca renombrar ni quitar. Razón: hay JSONs exportados en circulación que se siguen importando.
- Las cuatro claves de primer nivel del JSON: `personas`, `proyectos`, `asignaciones`, `config`.
- Los componentes de UI (`src/components/*`), salvo que un cambio de tipo lo rompa. En ese caso, ajuste mínimo para compilar y nada más.
- El diseño visual: colores, tipografía, layout, `src/theme/`, `src/index.css`.

---

## 2. Comportamientos a preservar

- **Importar un JSON existente sigue funcionando** y no pierde ninguna asignación. Verificación: importar un export previo y comprobar que la cantidad de asignaciones y los `persona_id` no cambian.
- **La perilla "Inicio Toyota"** (`config.fechas_clave.transicion_susana_toyota`) sigue creando las 3 fases de TASA cuando se define. Cambia **solo** quién configura (ver punto 5 del scope).
- **Exportar sigue produciendo un JSON importable** por la misma app.
- **Deshacer** sigue funcionando sobre todos los cambios nuevos.
- **La Regla 3** (dependencias de la misma persona) no cambia.
- **Los proyectos marcados `especial: true`** siguen fuera del planificador automático.

No hay tests automatizados en el repo. Antes de tocar `store.ts`, escribir tests para `calcularFin` y para el cálculo nuevo de duración: son la única red.

---

## 3. Scope

### Entra

**3.1 — Dos tablas nuevas en `data/config.json`, como datos, no como código**

```json
"horas_por_fase": {
  "_doc": "Horas de esfuerzo por fase. Fuente: tablero Monday 18420861674 (EMPRESA - MMAAAA), columna de horas.",
  "estandar": { "Relevamiento": 55.5, "Configuracion": 71.0, "Pruebas": 88.0 },
  "chica":    { "Relevamiento": 37.1, "Configuracion": 67.1, "Pruebas": 45.2 },
  "_chica_nota": "Cuentas de <10 empleados. Fijo + 0.25 x variable. HIPOTESIS sin medir.",
  "_criterio_chica": "proyecto.complejidad === 'baja'"
},
"disponibilidad": {
  "_doc": "Fraccion de la jornada de 8 hs que cada persona dedica a migracion, por ano. Perilla.",
  "por_persona_ano": {
    "leo":    { "2026": 0.70, "2027": 0.90 },
    "susi":   { "2026": 0.70, "2027": 0.90 },
    "moni":   { "2026": 0.80, "2027": 0.60 },
    "gaby_f": { "2026": 0.50, "2027": 0.50 },
    "lau":    { "2026": 1.00, "2027": 1.00 },
    "axton":  { "2026": 1.00, "2027": 1.00 }
  },
  "default": 1.00,
  "_nota": "Moni BAJA en 2027: su soporte Axton crece a medida que las cuentas salen en vivo."
}
```

**3.2 — Duración derivada de horas ÷ disponibilidad, día por día**

Función nueva en `src/utils/dates.ts`:

```
calcularFinPorHoras(inicio, horasObjetivo, personaId, config, feriados)
  -> { fin, duracion_dias, dedicacion_promedio }
```

Recorre día por día desde `inicio`. Saltea sábados, domingos y feriados. Por cada día hábil acumula `8 × disponibilidad(personaId, año(día))`. Termina el día en que el acumulado alcanza `horasObjetivo`. Devuelve la fecha de fin, la cantidad de días hábiles consumidos y el promedio de dedicación de esos días (que va a `dedicacion_pct`).

`calcularFin` (por cantidad de días) **se mantiene**, porque la sigue usando el arrastre manual de barras.

**3.3 — Reemplazar `DUR_DEFAULT`**

Sacar la tabla fija `{ Relevamiento: 10, Configuracion: 15, Pruebas: 8 }`. Todos los lugares que la usan (`store.ts` 233, 446-450, 613) pasan a resolver horas por fase y tipo de cuenta, y a llamar a `calcularFinPorHoras` con la persona asignada.

**3.4 — Arreglar `siguienteLunes`**

Hoy es `addWeeks(getMondayOfWeek(fin), 1)`: la fase siguiente arranca el lunes de la semana posterior. Cuesta hasta 4 días hábiles por handoff y hace imposible el solapamiento relevamiento/configuración.

Reemplazar por dos funciones:

- `siguienteDiaHabil(fecha, feriados)` — para **Pruebas** después de Configuración.
- Para **Configuración**: arranca en `siguienteDiaHabil(inicio_del_relevamiento)`, no después de su fin. Es el solapamiento de 6 días medido en el tablero: BP1 estructural solo necesita el Checklist Inicial. Sigue sujeto a que la persona tenga hueco.

**3.5 — Borrar la Regla 1 (acantilado Susi)**

Eliminar `checkRule1` completa de `rules.ts`, su llamada en `computeViolaciones`, y el tipo `'R1'` de `Violacion`. Eliminar toda mención al acantilado en comentarios y en las notas `_nota` de `data/personas.json` y `data/config.json`. Ya no existe: Axton configura TASA y Susi no pasa a Toyota.

La perilla `transicion_susana_toyota` **se conserva** porque dispara el alta de TASA, pero su `_nota` pasa a describir solo eso.

**3.6 — El alta de TASA usa Axton**

`store.ts:307` tiene `persona_id: sufijo === 'config' ? 'susi' : 'lau'`. La Configuración de TASA pasa a `axton`. Relevamiento y Pruebas siguen en `lau`.

**3.7 — Regla 2 respeta la capacidad de la persona**

`rules.ts:78` compara la carga contra `1.0` fijo. Pasa a comparar contra:

```
limite = (persona.capacidad_horas_semana / 40) × (1 − persona.buffer_pct)
```

Ámbar a partir del 80% de ese límite. Hoy Gaby está a 20 h/sem y nunca dispara nada.

**3.8 — `buscarHueco` considera los bloqueos**

Tiene `!a.es_bloqueo` en el filtro, así que un bloqueo no cuenta como ocupación. Es lo que produce el solape de 63 días de Lau (TASA-Relevamiento debajo del bloqueo de supervisión). Sacar esa condición.

**3.9 — `pickPersona` mira la carga**

Hoy devuelve `personas.find(...)`, el primero del array que matchea rol o skill. Como Axton es el único con `rol: 'configuracion'`, toda cuenta nueva le cae a él.

Cambiar a: entre los candidatos que matchean rol o skill, elegir el que **termina antes** la fase (usando `buscarHueco` y la duración real de cada uno). Empate, el de menos días asignados.

**3.10 — Migración de una sola pasada**

Botón nuevo, "Recalcular duraciones". Para cada asignación existente que no sea `es_bloqueo`:

- Preserva `id`, `proyecto_id`, `tipo`, `persona_id`, `inicio`, `predecesoras`.
- Recalcula `fin`, `duracion_dias` y `dedicacion_pct` con `calcularFinPorHoras`.
- Reencadena: Configuración al día hábil siguiente del inicio del Relevamiento; Pruebas al día hábil siguiente del fin de Configuración; y después corre hacia adelante lo que haga falta para que la persona no se pise.

Entra en el historial de deshacer. **No reasigna personas ni reordena cuentas**: el reparto manual se respeta tal cual está.

**3.11 — `template_estandar` al seed**

Hoy solo existe en los JSON exportados; con Reset se pierde la calibración. Que quede en `data/config.json`.

### Explícitamente afuera

- **Multiplicador por cantidad de entidades.** `Lowsedo` tiene 3 y `Carrier` 2 y hoy se calculan como 1. Queda así a propósito.
- **Rampa progresiva por go-lives.** Se descartó: pasos fijos por año, nada de curvas.
- **Rondas de paralelo.** Una sola, como está.
- **Pisos de soporte** (`pisos_soporte_horas_semana`). Queda en `null`; la disponibilidad por año cubre lo mismo por otra vía. No borrar la clave, no implementarla.
- **Rediseño visual, performance, tests de UI.**
- **Feriados 2027 definitivos.** Los que hay están marcados `(estimado)` y se quedan así.

---

## 4. Evals

**Método:** tests unitarios nuevos + una verificación manual contra números conocidos.

**Criterios concretos, todos verificables:**

1. `calcularFinPorHoras` para una cuenta estándar da estas duraciones, arrancando dentro del año y sin cruzar el 31/12:

| Persona | Año | Relev | Config | Pruebas |
|---|---|---|---|---|
| leo, susi | 2026 (70%) | 10 | 13 | 16 |
| leo, susi | 2027 (90%) | 8 | 10 | 13 |
| moni | 2026 (80%) | 9 | 12 | 14 |
| moni | 2027 (60%) | 12 | 15 | 19 |
| gaby_f | ambos (50%) | 14 | 18 | 22 |
| lau, axton | ambos (100%) | 7 | 9 | 11 |

2. Cuenta chica (`complejidad: 'baja'`), mismas condiciones: leo/susi 2026 → 7 / 12 / 9. lau/axton → 5 / 9 / 6.

3. **Cruce de año.** Una Configuración de `moni` que arranca el 21/12/2026 tiene que dar **más de 12 días** (parte al 80%, parte al 60%) y menos de 15. Si da exactamente 12 o exactamente 15, el consumo día por día no está funcionando.

4. **Importar un export previo** (por ejemplo `plan-migracion__2_.json`, 52 asignaciones): entran las 52, ningún `persona_id` cambia.

5. **Después de "Recalcular duraciones"**: cero violaciones de Regla 2 en rojo por solape de la misma persona, y cero violaciones de Regla 3.

6. **Regla 2 con Gaby**: ponerle dos fases de distintos clientes el mismo día con `dedicacion_pct` 0,5 cada una y comprobar que dispara rojo (su límite es 0,5, no 1,0).

7. `grep -ri "acantilado" src/ data/` devuelve vacío.

**Quién revisa antes de cerrar:** Guille, comparando el timeline resultante contra la captura actual.

---

## 5. Autonomía

**Puede decidir solo:**
- Nombres de funciones, variables y archivos nuevos.
- Estructura interna y cómo organiza los tests.
- Redondeo: usar `Math.ceil` sobre los días (una fase nunca termina a mitad de día).
- Texto de los botones y de los mensajes de violación.
- Cómo ordena internamente el reencadenado de la migración.

**Tiene que consultar antes de avanzar:**
- Cualquier cambio a las claves del esquema de `Asignacion` más allá de agregar opcionales.
- Si aparece una asignación existente sin `persona_id` válido o con una persona que no está en `disponibilidad`.
- Si la migración de las 52 asignaciones corre alguna cuenta más de **30 días hábiles** respecto de su fecha actual: significa que algo del reencadenado está mal interpretado.
- Si `pickPersona` con carga deja alguna persona en cero asignaciones cuando antes tenía.
- Si algo de esta spec resulta inaplicable contra el código real. Señalarlo, no reinterpretarlo.

---

## 6. Condición de salida

**Para de iterar cuando:**
- Los 7 criterios de la sección 4 pasan.
- `npm run build` compila sin errores de tipos.
- La app carga, importa el JSON de 52 asignaciones, y el botón "Recalcular duraciones" corre sin excepciones.

**Explícitamente NO debe:**
- Implementar nada de la lista "Explícitamente afuera".
- Refactorizar `src/components/*` más allá del ajuste mínimo para que compile.
- Tocar el diseño visual.
- Optimizar performance.
- Reasignar personas o reordenar cuentas por su cuenta en la migración.
- Seguir arreglando conflictos que queden después de la migración: si quedan, **reportarlos en una lista** y devolver el control.

---

**Fecha:** Agosto 2026
**Confirmada por el usuario:** pendiente — ver Supuestos asumidos
