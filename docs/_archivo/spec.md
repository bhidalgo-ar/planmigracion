# spec.md — Contrato funcional

Detalle de qué hace la herramienta. Pareja de `CLAUDE.md`; acá está la lógica fina.

---

## 1. Modelo de datos (4 entidades)

### Persona (`personas.json`)
| Campo | Tipo | Detalle |
|---|---|---|
| `id` | string | alias en minúscula (`susi`, `moni`…) |
| `alias` | string | etiqueta visible (`Susi`, `Moni`…) |
| `skills` | string[] | `relevamiento` / `configuracion` / `soporte` / `reporteria` / `testeo` — para validar que la asignación matchee la capacidad |
| `capacidad_horas_semana` | number | 40 = semana plena (5 días) |
| `buffer_pct` | number | reserva no asignable (0–1). Default 0 |
| `_nota` | string? | aclaraciones / cosas a confirmar |

### Proyecto (`proyectos.json`)
| Campo | Tipo | Detalle |
|---|---|---|
| `id` | string | |
| `nombre` | string | nombre comercial de la cuenta |
| `complejidad` | number\|null | 1–10. **null = sin clasificar** (sale del board de complejidad 6552205482) |
| `depende_retro` | bool\|null | si la config depende del retro de Axton. **null = sin confirmar** |
| `entidades` | number | cantidad de sociedades; >1 multiplica esfuerzo (Carrier=2, Lowsedo=3) |
| `quick_win` | bool | prioridad de victoria rápida |
| `especial` | bool | proyecto especial (TASA/Toyota) |
| `_nota` | string? | |

### Fase / Asignación (`asignaciones.json`) — la inteligencia
| Campo | Tipo | Detalle |
|---|---|---|
| `id` | string | |
| `proyecto_id` | string | FK a proyecto |
| `tipo` | enum | `Relevamiento` \| `Configuracion` \| `UAT` \| `Paralelo` \| `Cierre` |
| `persona_id` | string | FK a persona |
| `inicio` | ISO date | lunes de la semana de inicio |
| `fin` | ISO date | viernes de la semana de fin |
| `dedicacion_pct` | number | fracción de la capacidad de esa persona que consume esta fase mientras está activa (0–1). **Default 1.0** |
| `avance_pct` | number\|null | % completado |
| `predecesoras` | string[] | ids de fases que deben terminar antes |
| `bloqueo_externo` | enum\|null | `Axton` \| `Cliente` \| null. El tiempo en este estado NO cuenta como carga del equipo |
| `_nota` | string? | |

### Config global (`config.json`)
- `unidades`: `horas_por_dia` (8), `dias_por_semana` (5).
- `fechas_clave`: `transicion_susana_toyota` (perilla, puede ser null), `retro_ready_axton` (habilita config retro-dependiente; roadmap).
- `pisos_soporte_horas_semana`: horas reservadas por persona para soporte (roadmap).
- `feriados_nacionales_2026`: lista de fechas que reducen la capacidad de su semana (en MVP se pueden ignorar).

---

## 2. Modelo de capacidad

- Internamente todo en **horas/semana**.
- Una **semana plena = 5 días = 40 hs** (`horas_por_dia` × `dias_por_semana`).
- **Carga semanal de una persona** = Σ sobre sus fases activas esa semana de
  `dedicacion_pct × capacidad_horas_semana`.
- **Utilización** = carga / capacidad.
- **Display de cada celda semana**: el % de utilización + el equivalente en días
  (`carga_horas / horas_por_dia`). Ej: 40 hs → "100% · 5 d".

Una fase está "activa" en una semana si el rango `[inicio, fin]` se solapa con esa semana.

> En el MVP, los feriados pueden ignorarse (capacidad fija de 40). En v2, una semana con
> feriado reduce la capacidad de esa semana (ej. 1 feriado → 32 hs).

---

## 3. Las 3 reglas de colapso (MVP) — lógica exacta

### Regla 1 — Acantilado Susana → Toyota
- Entrada: `config.fechas_clave.transicion_susana_toyota`.
- Si es **null** → no marca colapso; muestra aviso "definí la fecha de transición de Susi
  para evaluar este riesgo".
- Si está definida → para cada fase con `tipo = "Configuracion"` y `persona_id = "susi"`
  cuyo `inicio` o `fin` sea **igual o posterior** a la fecha (o que la cruce) →
  **ROJO**, motivo: *"Susi configura {proyecto} después de pasar a Toyota ({fecha})"*.
- **Excepción**: si `proyecto.especial = true` (TASA/Toyota), NO marca (es su nuevo foco).
- Visual: **línea vertical** sobre el timeline en la fecha de transición.

### Regla 2 — Sobreasignación persona/semana
- Para cada persona × cada semana del rango visible:
  - calcular utilización (ver §2).
  - **> 100% → ROJO** ("Sobreasignada: {x}% en {semana}").
  - **80–100% → ÁMBAR** ("Cerca del tope: {x}%").
  - **< 80% → verde**.
- La celda muestra el % y los días-equivalente, y al hover lista las fases que componen
  esa carga.

### Regla 3 — Violación de dependencia
- Para cada fase con `predecesoras` no vacías:
  - si `fase.inicio` < `max(fin de cada predecesora)` → **ROJO**, motivo:
    *"{fase} arranca antes de cerrar {predecesora}"*.
- **Gate UAT**: si un proyecto tiene una fase `Paralelo` pero **no** tiene una fase `UAT`
  previa cerrada (o no existe UAT en el proyecto) → **ÁMBAR/warning**:
  *"Paralelo de {proyecto} sin gate de UAT (riesgo de rondas extra)"*. Ver
  `docs/metodologia-fases.md`.
- Orden implícito por proyecto: `Relevamiento → Configuracion → UAT → Paralelo → Cierre`.
  Aunque no haya `predecesoras` explícitas, dos fases del mismo proyecto fuera de orden
  cronológico pueden marcarse (decisión de implementación; mínimo respetar las
  `predecesoras` declaradas).

---

## 4. UI mínima del MVP

- **Timeline grid**: filas = personas, columnas = semanas (con cabecera mes + rango de
  fechas, igual que Monday). Barras de fase posicionadas y coloreadas por proyecto, con
  etiqueta `"{proyecto} - {tipo}"`.
- **Capa de colapsos**: las celdas/barras en problema se pintan (rojo/ámbar) y hay un
  **panel lateral de alertas** que lista todos los colapsos detectados, ordenados por
  criticidad (rojo antes que ámbar), cada uno clickeable para saltar a la celda.
- **Línea de transición de Susana** (vertical, etiquetada con la fecha).
- **Panel de perillas** (editable, recalcula en vivo):
  - fecha de transición de Susana,
  - (visible pero inactivo en MVP) retro-ready de Axton y pisos de soporte.
- **Edición de fases**: poder arrastrar/editar inicio-fin y reasignar persona, y ver el
  recálculo. (Si el drag es mucho para el MVP, alcanza con editar fechas en un formulario.)
- **Export / Import JSON** del estado completo + persistencia automática en localStorage.

---

## 5. Escenarios (v1.5, no MVP)

Guardar el estado bajo un nombre ("Escenario A: Susi a Toyota en agosto", "Escenario B:
en septiembre") y **comparar** dos escenarios lado a lado (cuántos colapsos genera cada
uno). Este es el corazón del "jugar con los tiempos"; va apenas después del MVP.

---

## 6. Roadmap (NO implementar en el MVP)

Reglas adicionales del motor, en orden de valor (escala 1–10 para tu proyecto):

| # | Regla | Valor | Qué detecta |
|---|---|---|---|
| 4 | **Cuello de relevamiento (feeder)** | 8 | demanda de configuración > oferta de relevamiento (Sergio+Leo ~1/mes) |
| 5 | **Bloqueo por retro de Axton** | 8 | config de cuenta `depende_retro` que arranca antes de `retro_ready_axton` |
| 6 | **Piso de soporte / SLA** | 7 | carga de migración que come las horas reservadas a soporte (Moni/Leo) |
| 7 | **Tiempo externo aparte** | 6 | fases con `bloqueo_externo` no cuentan como carga ni como elapsed del equipo |
| 8 | Importador desde Monday (CSV) | — | recién cuando se estandaricen etiquetas de estado |
| 9 | Estimación de duración por tier de complejidad | — | alimenta el baseline del esquema de incentivos |

---

## 7. Decisiones de diseño ya tomadas (no re-discutir)
- A: **standalone puro**, datos a mano (sin API Monday).
- B: **horas internas**, display % + días; semana plena = 5.
- C: **granularidad de fase**.
- D: **MVP = reglas 1, 2 y 3**.
- La fecha de transición de Susana es una **perilla** (sin valor fijo).
