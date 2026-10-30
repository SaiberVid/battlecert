# Plan del proyecto

Estudio para convertir el prototipo "Cert Arena" en **BattleCert**, en un proyecto open source mantenible: un juego de preguntas tipo test, gratuito y sin cuentas, para practicar **cualquier asignatura o certificación** con amigos, usando bancos de preguntas en JSON que cualquiera puede generar con una IA a partir de sus apuntes, un PDF o una guía oficial.

Fecha: 26-oct-2026 · Estado: **v0.2 — fases 0 y 1 hechas** (React + TS, seguridad endurecida, modos y sonido). Ver §9.

---

## 1. Qué es y qué no es

**Es:** una web estática (GitHub Pages) donde una persona crea una sala, sus amigos entran con QR, enlace o código, y juegan rondas rápidas con un banco de preguntas que el anfitrión trae. Al final, cada uno ve sus fallos y sus dominios débiles.

**No es:** una plataforma con cuentas, servidor propio ni base de datos central. Esa es la razón de que sea gratis y de que no se sature: no hay nada central que saturar (ver §5).

**Principios:**
1. Gratis para siempre y sin registro.
2. Privacidad por defecto: nada sale del navegador salvo lo imprescindible para jugar.
3. Cualquier contenido: el formato de pack es abierto y documentado (JSON Schema).
4. Aprender, no solo jugar: cada partida termina con qué repasar.
5. Mantenible por una persona: pocas dependencias, tests, CI y documentación.

---

## 2. Nombre

**"Cert Arena" no conviene.** Ya existe **CertArena** (aicertarena.com), una plataforma gratuita de práctica de certificaciones de IA (AWS, Azure, Google, Anthropic…). Mismo nombre, mismo público: confusión y riesgo de marca.

Tampoco conviene "claude-cert-duel" para un proyecto genérico: "Claude" es marca de Anthropic, y el proyecto ya no va solo de Claude. Los packs de Claude quedan como pack de ejemplo, con aviso de "no afiliado a Anthropic".

Candidatos estudiados: Duelab, Repásalo, ExamParty, Certmaxer Duel y **BattleCert**.

**Decisión: BattleCert** (repo `saibervid/battlecert`, web `https://saibervid.github.io/battlecert/`). Corto, se entiende en inglés y en español, dice exactamente lo que es (batalla + certificación) y no aparece en uso para una app de estudio. GitHub redirige el nombre antiguo del repo, pero la URL de Pages cambia.

---

## 3. Competencia y referencias

| Producto | Qué hace bien | Qué le falta para nuestro caso |
|---|---|---|
| Kahoot | Podio, racha, música y sonido, ritmo de show | De pago para funciones clave, centrado en aula, sin packs abiertos |
| Quizizz / Wayground | Ritmo individual, memes, power-ups | Cuentas, centrado en profesores |
| Gimkit | Economía en partida, power-ups, muchos modos | De pago |
| Blooket | Modos de juego muy distintos con la misma pregunta | Cuentas; contenido infantil |
| Quizlet Live | Equipos cooperativos | Cuentas, ecosistema cerrado |
| QuizDuel / Quizkampen | Duelos asíncronos 1 vs 1 | Contenido cerrado de trivial |
| CertArena (aicertarena.com) | Práctica de certificaciones de IA, rachas, ranking | Solo individual; banco cerrado |
| Rahoot, ClassQuiz (open source) | Clones de Kahoot autoalojables | Requieren servidor propio (Docker) |

**Hueco que ocupamos:** multijugador en tiempo real + contenido propio generado con IA + cero servidor y cero cuentas + enfoque en estudiar (dominios débiles, repaso de fallos), no en trivial.

**Ideas que tomamos:** podio y racha (Kahoot), modos distintos sobre las mismas preguntas (Blooket/Gimkit), equipos (Quizlet Live), duelo asíncrono (QuizDuel), formas además de colores en las opciones (Kahoot, accesibilidad).

---

## 4. Todas las mejoras, agrupadas

### 4.1 Juego y modos

| Modo | Mecánica | Para qué sirve |
|---|---|---|
| Clásico | Todos a la vez, acierto + rapidez + racha | El de siempre |
| Turnos + robo | Ya existe | Tensión 1 vs 1 |
| **Relámpago** | 5–10 s por pregunta, puntos x2 | Velocidad de recuperación |
| **Supervivencia** | 3 vidas; el último en pie gana | Presión sin cronómetro largo |
| **Muerte súbita** | Un fallo y fuera | Rondas finales |
| **Apuesta de confianza** | Antes de responder apuestas 1–3; aciertas = ganas la apuesta, fallas = la pierdes | Calibrar lo que realmente sabes (muy útil para exámenes) |
| **Equipos** | 2 equipos; puntuación sumada o voto por equipo | Grupos de clase |
| **Contrarreloj** | 60–120 s, tantas como puedas, cada uno a su ritmo | Calentamiento |
| **Cooperativo "Jefe"** | Todos contra el pack: X aciertos de equipo antes de que se agote la vida del jefe | Estudiar sin competir |
| **Duelo asíncrono** | Juegas tus 10 y le mandas el enlace; tu amigo juega las mismas cuando pueda | Cuando no coincidís en horario |
| **Repaso de fallos** | Solo preguntas falladas en partidas anteriores | Cerrar lagunas |

Ajustes por partida: tiempo (5–120 s), nº de preguntas, dominios, dificultad, orden aleatorio, mostrar o no la explicación, puntos por velocidad sí/no, rondas mejor de 3.

### 4.2 Sensación ("dopamina") sin hacerla molesta

- **Sonido** generado con Web Audio (sin ficheros, sin derechos): tic en los últimos 5 s, campanita al acertar con tono que sube con la racha, golpe sordo al fallar, fanfarria de podio, "whoosh" al cambiar de pregunta. Volumen y silencio global; desactivado si el sistema pide menos movimiento.
- **Háptica** en móvil (`navigator.vibrate`): toque corto al acertar, doble al fallar.
- **Animación:** cuenta atrás 3-2-1, contador de puntos que sube, confeti en el podio, racha con llama, barra de tiempo que se tensa, reacciones con emoji durante la resolución.
- **Identidad:** avatar (emoji + color) elegido por el jugador, frases de victoria, insignias de partida ("más rápido", "remontada", "racha de 5").
- **Accesibilidad:** cada opción con forma además de color (▲ ◆ ● ■), modo daltónico, texto grande, `prefers-reduced-motion`, navegación por teclado, lectores de pantalla con `aria-live`.

### 4.3 Contenido: packs para cualquier asignatura o certificación

**Formato v2** (compatible hacia atrás con v1), publicado como JSON Schema en `schema/pack.v2.json` para que editores e IAs lo validen:

- `meta`: nombre, asignatura/certificación, idioma, autor, licencia, fuentes, versión, fecha.
- `domains`: nombre y **peso** (para repartir preguntas como el examen real).
- `concepts` (80/20): término, definición en una línea, analogía, regla mental, dominio, prioridad.
- `questions`: tipo (única, múltiple, verdadero/falso, ordenar), dificultad 1–5, enunciado, contexto, opciones con **explicación por opción**, respuesta, explicación, conceptos que evalúa, **fuente** (documento, página, URL).
- `flashcards` opcionales.

**Prompts para cualquier IA** (Claude, ChatGPT, Gemini…), copiables desde la app:

| Prompt | Entrada | Salida |
|---|---|---|
| Desde un PDF o apuntes | El PDF/apuntes adjuntos | Conceptos 80/20 + N preguntas con la página de origen |
| Desde una guía oficial de certificación | La guía (dominios y pesos) | Pack con dominios ponderados y preguntas por objetivo |
| Desde un temario de asignatura | Índice del temario | Pack por tema |
| Ampliar un pack | Pack existente + dominio débil | Preguntas nuevas sin repetir |
| **Corregir** | El informe de errores del validador | El JSON arreglado |

El validador de la app devuelve errores legibles ("pregunta 12: la respuesta 4 no existe") y genera automáticamente el **prompt de corrección** para pegárselo a la IA. Así el ciclo IA → JSON → importar funciona aunque la IA se equivoque.

**Fuentes de packs:** archivo, pegar texto, URL pública (GitHub raw, Gist), **enlace de pack** (`#pack=<url>`) y QR del pack. **Galería comunitaria** en el propio repo (`packs/community/`): se añade por pull request, con revisión de licencia y de que no sean preguntas reales de examen.

**Editor de packs** en la app: crear y editar preguntas a mano, marcar la correcta, previsualizar y exportar.

### 4.4 Aprender de verdad

- Antes de la ronda: 3 conceptos clave del dominio elegido (de `concepts`).
- Durante: explicación corta tras cada pregunta y "¿por qué fallan las otras?".
- Después: dominios débiles, fallos con la respuesta correcta y la fuente, y botón "repasar mis fallos".
- **Modo estudio individual** con repetición espaciada (FSRS, ya implementado en Claude Cert Trainer) sobre las preguntas falladas en partidas.
- Estadística personal por pack: acierto por dominio en el tiempo, preguntas más falladas, tiempo medio.

### 4.5 Conexión y facilidad de entrada

Ya hay QR, enlace y código. Mejoras:
- Código más largo (6 caracteres) y **PIN opcional** de sala (ver seguridad).
- El anfitrión **acepta o expulsa** jugadores.
- **Pantalla de proyector** (modo "presentador"): una pantalla grande muestra la pregunta y el podio y los móviles solo los botones, como Kahoot.
- **Instalable (PWA):** icono en el móvil, funciona offline en modo solo.
- Reconexión automática más rápida y traspaso de anfitrión si el anfitrión se cae (fase avanzada).

### 4.6 Plataforma y calidad

- Idiomas ES/EN (i18n).
- Temas claro/oscuro, ya hecho.
- Exportar/importar todo (packs, historial) en un JSON.
- Página "Acerca de / Privacidad" clara.

---

## 5. ¿Se satura? ¿Cada persona crea una instancia?

**No se crea ninguna instancia nueva por persona.** La web es un conjunto de ficheros estáticos que GitHub Pages sirve a todo el mundo igual. Cuando alguien "crea una sala", la sala vive **dentro de su propio navegador**: su pestaña hace de servidor de esa partida y los amigos se conectan directamente a ella (WebRTC). Al cerrar la pestaña, la sala desaparece. No hay base de datos ni servidor nuestro que llenar.

Lo que **sí** es compartido y tiene límites:

| Pieza | Límite | Qué pasa si crece | Mitigación |
|---|---|---|---|
| GitHub Pages | ~100 GB/mes de tráfico (límite blando), 1 GB de sitio | ~300 KB por visita → del orden de 300.000 visitas/mes; con caché, más | PWA con caché; si se supera, Cloudflare Pages (gratis, sin límite de tráfico) |
| Servidor público de PeerJS (emparejamiento) | Sin SLA ni límites publicados; compartido con todo el mundo | Si se cae, nadie puede crear salas | Capa de transporte intercambiable; añadir **Trystero** (emparejamiento por Nostr/MQTT/BitTorrent, varios relays públicos a la vez, sin punto único de fallo) |
| Navegador del anfitrión | ~5–10 conexiones WebRTC cómodas por navegador | Salas de 30 (aula) no van bien | Sala grande con relay en **Cloudflare Workers + Durable Objects** (plan gratuito: 100.000 peticiones/día; los mensajes WebSocket entrantes cuentan 1/20) |
| Redes que bloquean P2P (algunos móviles 4G/5G, empresas) | Sin TURN, no conectan | Algunos jugadores no pueden entrar | TURN de **Cloudflare (1.000 GB/mes gratis)**, que requiere un Worker para emitir credenciales temporales |

Conclusión: para grupos de amigos (2–8) el diseño actual escala prácticamente sin límite, porque cada partida usa los recursos de quien la crea. Los dos riesgos reales son la dependencia del servidor público de PeerJS y las redes que bloquean P2P; ambos se resuelven sin coste con las mitigaciones de la tabla.

---

## 6. Arquitectura y tecnología

### ¿React?

Sí, con matices. El prototipo es JavaScript sin framework en un solo HTML. Funciona, pero con 10 modos, editor de packs, i18n, animaciones y contribuciones externas se vuelve difícil de mantener.

| Opción | A favor | En contra | Veredicto |
|---|---|---|---|
| Seguir sin framework | 0 dependencias, carga mínima | Difícil de escalar y de testear la UI | No |
| **React 19 + Vite + TypeScript** | Ecosistema, Motion para animaciones, más fácil para contribuidores | +45 KB gzip | **Sí** |
| Preact + Vite | API de React en 4 KB | Algunas librerías de animación dan guerra | Alternativa si el peso importa |
| Svelte | Ligero y elegante | Menos contribuidores potenciales | No |

**Stack propuesto:**
- **Vite + React 19 + TypeScript estricto.**
- **CSS propio con variables (tokens)** en un solo archivo, con tema claro/oscuro; **Motion** para animaciones. *Decisión en fase 0: se descarta Tailwind; los tokens ya existían, el CSS ocupa 5 KB gzip y no añade otra herramienta que aprender a quien contribuya.*
- **Zustand** para estado; **Zod** para validar packs y todos los mensajes de red.
- Web Audio propio para sonidos (sin dependencias).
- **vite-plugin-pwa** (instalable y offline) — fase 5.
- **Vitest** (lógica) + **Playwright** (partidas multijugador con red simulada, como ya hacemos) en CI.
- Despliegue con **GitHub Actions**: compila, prueba y publica la web en la rama `gh-pages` en cada push a `main`.
- **Todas las librerías empaquetadas**, nada cargado de CDN en tiempo de ejecución (seguridad y privacidad, ver SECURITY.md). Fuentes autoalojadas.

**Estructura:**
```
src/
  core/        motor de juego, puntuación, modos (TS puro, sin UI, 100 % testeado)
  packs/       esquema, importadores, validador, prompts
  net/         transporte: PeerJS | Trystero | Relay (misma interfaz)
  ui/          componentes React, pantallas, sonidos, animaciones
  i18n/
schema/pack.v2.json
packs/examples/ packs/community/
docs/          PLAN, ARCHITECTURE, PACK_FORMAT, CONTRIBUTING
```

El motor de juego actual (`engine.js`) y los importadores ya son lógica pura y testeada: se migran casi tal cual a TypeScript.

---

## 7. El repositorio como proyecto

- **LICENSE**: MIT para el código. Los packs llevan su propia licencia en `meta`. Aviso de terceros para los bancos MIT incluidos.
- **README** con GIF de una partida, enlace "Jugar ahora", cómo crear un pack con IA.
- **SECURITY.md** (incluido): cómo reportar vulnerabilidades y modelo de amenazas.
- **CONTRIBUTING.md**, **CODE_OF_CONDUCT.md**, plantillas de issues (bug, idea, nuevo pack) y de PR.
- **CI**: tests, lint, build y Playwright en cada PR; despliegue automático a Pages desde `main`.
- **Protección de `main`**: PR obligatorio con CI verde.
- **Seguridad de GitHub** (gratis en repos públicos): Dependabot, CodeQL, secret scanning, push protection.
- **Versionado semántico** y CHANGELOG; releases en GitHub.
- **Issues etiquetadas** `good first issue` para atraer contribuciones.

---

## 8. Fases

| Fase | Contenido | Resultado |
|---|---|---|
| **0 · Cimientos** | Renombrar; LICENSE y docs; migrar a Vite + React + TS conservando todo lo que hay; CI y despliegue con Actions; endurecimiento de seguridad (§ SECURITY.md: códigos de 6, PIN, expulsar, límites, validación con Zod, tiempo medido por el anfitrión, sin CDN, CSP) | Misma app, base sólida y segura |
| **1 · Juego** | Sonido, háptica, animaciones, avatares, reacciones; modos Relámpago, Supervivencia, Apuesta de confianza, Contrarreloj; formas en opciones | La parte "adictiva" |
| **2 · Packs e IA** | Formato v2 + JSON Schema; validador con prompt de corrección; prompts desde PDF/guía/temario; editor de packs; enlace y QR de pack; galería comunitaria | Cualquier asignatura en minutos |
| **3 · Aprender** | Conceptos antes de la ronda; modo estudio con repetición espaciada; repaso de fallos; estadística por pack | Que se note en el examen |
| **4 · Red robusta** | Transporte Trystero con fallback; TURN de Cloudflare vía Worker; modo presentador; salas grandes con relay | Funciona en cualquier red y en aula |
| **5 · Comunidad** | i18n EN, PWA, duelo asíncrono, equipos, cooperativo | Proyecto público maduro |

Orden recomendado: 0 → 1 → 2 entregan el 80 % del valor. La fase 4 solo es necesaria si aparecen problemas de conexión reales o se quiere usar en clase.


---

## 9. Estado (v0.2, 26-oct-2026)

**Fase 0 — hecha**
- Vite + React 19 + TypeScript estricto; Zustand, Zod, Motion; fuentes autoalojadas; PeerJS empaquetado y cargado bajo demanda. Ningún recurso de CDN en tiempo de ejecución.
- Seguridad: los 15 puntos de la auditoría cerrados o documentados (ver [SECURITY.md](../SECURITY.md)).
- 38 tests unitarios (motor, modos, puntuación, que no se filtran respuestas, importadores, saneado, protocolo, limitador) y 7 tests end-to-end con red simulada (partida de 3, PIN, expulsión, reconexión, apuesta, invitado malicioso, importación y modo solo).
- CI en cada PR y despliegue automático a `gh-pages`. LICENSE MIT, CONTRIBUTING, código de conducta, plantillas, Dependabot.

**Fase 1 — hecha**
- Modos: Clásico, Turnos + robo, Relámpago, Supervivencia (3 vidas) y Apuesta (×1–×3).
- Tiempo por pregunta de 5 a 120 s con atajos (Rayo 5 s … Lento 90 s).
- Sonidos sintetizados (sin archivos) que suben de tono con la racha, vibración en móvil, cuenta atrás 3-2-1, formas ▲◆●■ en las opciones, marcador animado, reacciones con emoji, confeti y podio, revancha con serie.
- Respeta `prefers-reduced-motion`; botón de silencio; tema claro/oscuro/automático; atajos de teclado 1–8.

**Pendiente de fase 1:** modo Contrarreloj (60 s para responder todas las que puedas). Pasa a la fase 2.

## 10. Estado (v0.3, 29-oct-2026) — packs con IA

- Formato v2: `difficulty` (1–3), `concept` y `concepts` (ficha de repaso); Markdown como formato recomendado para escribir preguntas y ejemplos.
- **Crear con IA**: temario (PDF/apuntes) + ejemplos → conceptos 80/20 → preguntas por peso y dificultad → verificación a ciegas. Motor automático con la clave gratuita de Gemini del usuario (sin servidor), o manual con cualquier chat.
- Banco de preguntas acumulativo: añadir a un pack existente sin duplicados.
- Dificultad en partida: Rebujado, Escalera, solo fáciles, medias o difíciles; insignia en cada pregunta.

Siguiente: galería comunitaria de packs en el repo (PR con validación automática en CI), proveedores alternativos (Groq/OpenRouter con extracción de texto del PDF), modo Contrarreloj.

## 11. Estado (v0.4, 30-oct-2026) — cuaderno de fuentes

- Fuentes como NotebookLM: archivos, webs (URL context), YouTube y texto.
- Extracción de todas las preguntas de las fuentes, con respuesta resuelta, explicación y corrección marcada cuando la fuente se equivoca.
- Mapa del examen con los pesos oficiales (`blueprint`); las partidas reparten las preguntas por dominio como el examen real.
- Estilos de examen (Microsoft, AWS, Google Cloud, proveedores, universidad, oposición).
- Modo manual con un prompt maestro para NotebookLM, con continuación por bloques.

## 12. CERT KUMITE (v0.5, 30-oct-2026)

- Modo `kumite`: tira y afloja sobre una plataforma. Acierto = empuje de 1 + 0,5 por combo (máx. 3); ambos aciertan = choque sin movimiento; ambos fallan = tambaleo y combos a cero; al borde, el defensor se agarra y recibe la mitad. Longitudes Corto/Normal/Épico calibradas por simulación (Normal: mediana ~24 preguntas entre jugadores igualados).
- Solo: torneo contra los demás luchadores con CPU cada vez más precisa y rápida. Online: pelean los 2 primeros, el resto mira.
- Arte: hojas de 11 poses generadas con IA y procesadas con `tools/kumite_assets.py` (recorte, alfa limpia, anclaje por los pies, PNG de paleta). Faltan las hojas de 01_taekwondo y 02_brawler.
- Sonido: efectos y tema de batalla sintetizados en el navegador (canales cuadrada/triángulo/ruido), sin archivos ni licencias.
