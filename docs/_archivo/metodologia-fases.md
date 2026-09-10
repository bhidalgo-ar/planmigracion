# metodologia-fases.md — Fases, gate de UAT y dependencias

Define la lógica de proceso que el simulador respeta. Sale de la metodología de
migración de H&A (ver `mejora-tiempos-pruebas-migracion.md` y
`relevamiento-meta4-axton-contexto.md` del proyecto maestro).

---

## 1. Las 5 fases de una migración

```
Relevamiento → Configuracion → UAT Casos Particulares → Paralelo → Cierre
```

| Fase | Quién (típico) | Qué es |
|---|---|---|
| **Relevamiento** | Sergio + Leo (dupla), Lau para Toyota | Entender, documentar y traducir la cuenta Meta 4 antes de configurarla. Es el cuello de botella real. |
| **Configuracion** | Susi, Moni | Construir la cuenta en Axton. |
| **UAT Casos Particulares** | Configurador + cierre del Manager | Validar ~10–12 casos test sobre 2 legajos testigo (anonimizados). **Es un gate formal.** |
| **Paralelo** | Configurador | Liquidación de nómina completa Axton vs Meta 4. |
| **Cierre** | Manager (+ cliente) | Firma de cierre. |

> Importante: en H&A el **cliente no participa** de la migración. La liquidan analistas
> internos. UAT y Paralelo son trabajo del configurador, no del cliente.

---

## 2. El gate de UAT (clave para la Regla 3)

Hoy el UAT es "un checklist en la cabeza del equipo": no existe como fase formal, y por
eso aparecen problemas durante el Paralelo que deberían haberse cazado antes. Resultado:
**3–4 rondas de corrección** en lugar de 1–2.

Por eso el simulador trata al **UAT como gate que habilita el Paralelo**:
- Todos los casos test aplicables deben estar cerrados antes de habilitar Paralelo.
- Si un proyecto tiene `Paralelo` sin `UAT` previo cerrado → el motor avisa (ámbar),
  porque es la causa estructural del retrabajo.

---

## 3. Reglas de dependencia entre fases

1. Una fase **no arranca** antes de que terminen sus predecesoras (`predecesoras` en el
   dato). Violarlo = rojo.
2. Orden canónico por proyecto: Relevamiento → Configuracion → UAT → Paralelo → Cierre.
3. **Paralelo** depende de **UAT cerrado** (gate del punto 2 de este doc).
4. Config de una cuenta con `depende_retro = true` no debería arrancar antes de
   `retro_ready_axton` (esto es la Regla 5, **roadmap**, no MVP).

---

## 4. Tope de rondas en Paralelo

Acuerdo de proceso: el Paralelo se planifica con **1 ronda objetivo + 1 de contingencia =
máximo 2**. Si se excede, es señal de relevamiento insuficiente o cambio de alcance, no de
"más trabajo normal". (En el modelo de datos, las rondas pueden representarse como fases
`Paralelo` numeradas o como `avance_pct`; para el MVP no hace falta modelarlas en detalle,
pero el gate de UAT del §2 es lo que las mantiene en 1–2.)

---

## 5. Tiempo externo no cuenta como tiempo del equipo

Una fase puede estar `bloqueo_externo = "Axton"` o `"Cliente"`. Según el análisis de 10
boards históricos, entre **10% y 16%** de las subtareas quedan bloqueadas por terceros.
Ese tiempo:
- **No** debe contar como carga de capacidad del equipo (la persona no está trabajando esa
  fase mientras espera).
- **No** debe contar como elapsed de entrega del equipo (cae fuera de su control).

En el MVP alcanza con marcarlo visualmente distinto; la exclusión del cálculo de elapsed
es la Regla 7 (roadmap).

---

## 6. Etiquetas de estado estandarizadas

Para que cualquier medición futura sea posible (hoy cada board evolucionó etiquetas
ad-hoc, lo que hace imposible comparar), el estándar acordado es:

| Label | Significado |
|---|---|
| No Iniciado | sin empezar |
| En Proceso | trabajo activo de H&A |
| Pend. Axton | bloqueo esperando al proveedor |
| Pend. Cliente | bloqueo esperando data/decisión del cliente |
| Observado | diferencia detectada, requiere revisión |
| Listo | completado y validado |
| No Aplica | descartado para esa cuenta |

El simulador usa `Pend. Axton` / `Pend. Cliente` como los dos valores de `bloqueo_externo`.
