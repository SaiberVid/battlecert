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
- `tr` (opcional): traducciones de cada pregunta, junto al original. `"tr": {"es": {"stem": "…", "context": "…", "options": ["…"], "explanation": "…"}}`, con las mismas opciones y en el mismo orden. La sala muestra el idioma elegido en **Idioma de las preguntas** y, si falta la traducción, el original. El botón *Traducir al español* de *Mis packs* las rellena con Gemini dejando en inglés comandos, parámetros y nombres de herramientas.
- También se aceptan listas de preguntas de otros proyectos (`question`/`choices`/`correct`…) y CSV con cabecera `question,a,b,c,d,answer,explanation,domain,difficulty,concept`.
- Límites: 5.000 preguntas y 5 MB por pack.

## Crear un pack con IA: el cuaderno de fuentes

En **Packs → ✨ Crear con IA** añades todo tu material, como en NotebookLM:

- **Archivos:** PDF (temario, guía oficial, PDFs de preguntas), Markdown, texto, JSON o CSV.
- **Enlaces:** webs y PDFs online. Gemini los abre con su herramienta *URL context*. Las páginas que piden registro o bloquean robots no se pueden leer: guárdalas como PDF o copia el texto.
- **YouTube:** vídeos públicos de repaso. El plan gratuito permite 8 horas de vídeo al día.
- **Texto pegado:** apuntes o preguntas en cualquier formato.

Y eliges qué hacer:

1. **Extraer todas las preguntas de las fuentes.** Copia enunciados y opciones completos y en su idioma original, **resuelve cada pregunta** y escribe la explicación (por qué la correcta lo es y por qué fallan las demás). Si la fuente marcaba otra respuesta, la corrige y lo avisa en la explicación ("⚠️ La fuente marcaba…"). Las preguntas de arrastrar u ordenar se convierten en opción única; las que dependen de una imagen se omiten y se cuentan.
2. **Generar preguntas nuevas** parecidas al examen real: repartidas por el peso de cada dominio y concepto, con la mezcla de dificultad elegida y en el estilo del examen (Microsoft, AWS, Google Cloud, otros proveedores, universidad u oposición, o deducido de las fuentes). Las nuevas se comprueban a ciegas y se descartan las dudosas.

En los dos casos la IA hace antes un **mapa del examen**: dominios con su peso (de la guía oficial si la añades), conceptos clave y estilo de las preguntas. Todo queda en el JSON del pack:

| Campo | Para qué |
|---|---|
| `blueprint` | Peso de cada dominio en %. Las partidas reparten las preguntas igual que el examen real |
| `concepts` | Ficha de repaso: conceptos por peso, resumen, datos clave y confusiones típicas |
| `questions[].origin` | `source` (sacada de tus fuentes) o `ai` (nueva) |
| `questions[].explanation` | El feedback que ves al resolver cada pregunta |

Puedes guardar como pack nuevo o **añadir a uno existente sin duplicados**, así el banco crece con cada tanda de fuentes.

### Motores

- **Automático con Gemini (gratis):** clave de [Google AI Studio](https://aistudio.google.com/apikey), sin tarjeta. Las peticiones van de tu navegador a Google; BattleCert no tiene servidor. Si se alcanza el límite gratuito por minuto, la app espera y sigue.
  - **Cuota gratuita:** Google limita las peticiones por minuto y **por día, para cada modelo**. La app agrupa el trabajo (3 webs por petición, 20 preguntas nuevas por petición, 30 comprobaciones por petición), espera cuando toca el límite por minuto y, si un modelo agota su cuota del día, sigue con otro modelo Flash o Flash-Lite. Si se agotan todos, guarda lo hecho y aparece **Continuar** para retomarlo cuando se renueve la cuota (medianoche hora del Pacífico: las 08:00 o 09:00 en España, según la época del año), sin repetir pasos.
- **Manual (sin clave):** copia el **prompt maestro** en [NotebookLM](https://notebooklm.google.com) con tus fuentes (o en Gemini, Claude o ChatGPT con los archivos). Si la respuesta no cabe, el prompt pide continuar: escribe "sigue" y pega todas las respuestas juntas; la app une los bloques.

Revisa siempre una muestra: la IA también se equivoca. Los packs son personales; la galería comunitaria del repo solo aceptará contenido original o con licencia que permita compartirlo.
