# Formato de los packs

Un **pack** es un banco de preguntas de una asignatura o certificación. BattleCert importa Markdown, JSON y CSV, y guarda los packs en tu navegador. Puedes exportarlos para compartirlos.

## Markdown (recomendado para escribir a mano y para dar ejemplos a la IA)

```markdown
# Bases de datos — ejemplos

## ¿Qué forma normal elimina las dependencias parciales de la clave?
- [ ] 1FN
- [x] 2FN
- [ ] 3FN
- [ ] FNBC
> La 2FN exige que cada atributo no clave dependa de toda la clave.
dominio: Normalización
dificultad: media
concepto: Formas normales
```

| Elemento | Significado |
|---|---|
| `# Título` | Nombre del pack (opcional, una vez al principio) |
| `## …` | Empieza una pregunta; debajo va el enunciado |
| Bloque de código (\`\`\`) | Se muestra aparte como contexto: código, consulta, XML, fórmula |
| `- [ ]` / `- [x]` | Opción incorrecta / correcta. Varias `[x]` = respuesta múltiple |
| `> …` | Explicación que se ve al resolver |
| `dominio:` | Tema o bloque, para filtrar y ver tus puntos débiles |
| `dificultad:` | `fácil`, `media` o `difícil` (también `easy`/`medium`/`hard` o 1–3) |
| `concepto:` | Concepto clave que evalúa |

Ejemplo completo: [`public/packs/ejemplo-bases-de-datos.md`](../public/packs/ejemplo-bases-de-datos.md).

## JSON

```json
{
  "format": "battlecert/1",
  "name": "Bases de datos",
  "lang": "es",
  "source": "Mis apuntes",
  "license": "Uso personal",
  "concepts": [
    { "name": "Formas normales", "domain": "Diseño", "weight": 5, "summary": "…", "traps": ["Confundir 2FN y 3FN"] }
  ],
  "questions": [
    { "id": "q1", "domain": "Diseño", "concept": "Formas normales", "difficulty": 2,
      "stem": "¿Qué forma normal…?", "context": "", "options": ["1FN", "2FN", "3FN", "FNBC"],
      "answer": [1], "explanation": "…" }
  ]
}
```

- `answer`: índices desde 0.
- `difficulty`: 1 fácil, 2 media, 3 difícil. Si falta, cuenta como media.
- `concepts` (opcional): la **ficha de repaso**; `weight` de 1 a 5 indica cuánto pesa para aprobar.
- También se aceptan listas de preguntas de otros proyectos (`question`/`choices`/`correct`…) y CSV con cabecera `question,a,b,c,d,answer,explanation,domain,difficulty,concept`.
- Límites: 5.000 preguntas y 5 MB por pack.

## Crear un pack con IA

En **Packs → ✨ Crear con IA**:

1. Nombre de la asignatura, el **temario** (PDF o apuntes) y, si los tienes, **ejemplos de preguntas** (Markdown recomendado, o PDF/JSON/CSV).
2. Número de preguntas, mezcla de dificultad (Equilibrada 30/45/25, Para aprobar 40/45/15, Reto 15/40/45) e idioma.
3. Motor:
   - **Automático con Gemini (gratis):** necesitas una clave de [Google AI Studio](https://aistudio.google.com/apikey) (sin tarjeta). La app la usa desde tu navegador; no pasa por ningún servidor de BattleCert.
   - **Manual:** copia el prompt en cualquier chat (Claude, ChatGPT, Gemini…) con tus archivos y pega la respuesta.

El proceso automático tiene tres pasos: saca los **conceptos que más pesan** (la ficha de repaso), escribe las preguntas repartidas por peso y dificultad, y luego **responde cada pregunta a ciegas** y descarta las que no coinciden con su clave. Puedes guardar el resultado como pack nuevo o **añadirlo a uno existente**: así tu banco crece tema a tema sin preguntas repetidas.

Revisa siempre una muestra: la IA puede equivocarse, sobre todo en cálculos. No uses volcados de exámenes oficiales como ejemplos: rompen los acuerdos de confidencialidad de las certificaciones.
