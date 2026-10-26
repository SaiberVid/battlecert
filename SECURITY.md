# Seguridad

## Cómo reportar una vulnerabilidad

No abras una issue pública. Usa **Security → Report a vulnerability** (avisos privados de GitHub) en este repositorio. Respuesta inicial en 7 días.

## Modelo de amenazas

La app es una web estática sin servidor propio ni cuentas. Las partidas van de navegador a navegador (WebRTC). El navegador del **anfitrión** tiene el pack completo y decide el resultado; los **invitados** solo reciben la pregunta actual y, tras resolverla, la respuesta.

| Activo | Amenaza | Quién |
|---|---|---|
| Navegador de cada jugador | Ejecución de código (XSS) a través de un pack, un alias o un mensaje | Pack malicioso, invitado o anfitrión malicioso |
| Partida | Entrar sin invitación, suplantar a otro jugador, inundar al anfitrión, hacer trampas | Desconocido que adivina el código, invitado |
| Privacidad | IP visible para los demás jugadores (WebRTC); terceros (CDN, Google Fonts) ven visitas | Otros jugadores, terceros |
| Cadena de suministro | Script de CDN comprometido | Tercero |
| Datos locales | Packs e historial en `localStorage` | Otras extensiones o scripts en el mismo origen |

Fuera del alcance: un anfitrión que hace trampas con su propio pack (ve las respuestas porque las tiene). Se juega con gente de confianza.

## Auditoría y estado (v0.2, 26-oct-2026)

| # | Hallazgo en v0.1 | Riesgo | Estado en v0.2 |
|---|---|---|---|
| 1 | Pintado de texto ajeno | — | **Correcto.** Todo el texto pasa por React (escapado). Sin `innerHTML` ni `dangerouslySetInnerHTML`; el QR se dibuja como un `<path>` SVG desde la matriz. Test e2e con alias `<img onerror>` |
| 2 | Código de sala de 4 caracteres | Medio | **Cerrado.** 6 caracteres sin ambiguos (≈887 millones) generados con `crypto.getRandomValues`; **PIN opcional** de 4 cifras dentro del enlace/QR; el anfitrión puede **expulsar** (bloquea dispositivo y alias) |
| 3 | Mensajes sin límite | Medio | **Cerrado.** Esquemas Zod para cada mensaje en los dos sentidos; 4 KB por mensaje del invitado; token bucket 10/s (ráfaga 20); desconexión si insiste; máx. 16 conexiones y 8 jugadores |
| 4 | Tiempo de respuesta enviado por el invitado | Bajo | **Cerrado.** El anfitrión mide el RTT con ping/pong y usa `max(ms del invitado, llegada − apertura − RTT)` |
| 5 | Scripts de CDN sin SRI | Medio | **Cerrado.** Todo empaquetado en el build |
| 6 | Google Fonts | Bajo | **Cerrado.** Fuentes autoalojadas (@fontsource) |
| 7 | Sin CSP | Medio | **Cerrado.** CSP en `<meta>` del build: `default-src 'self'; script-src 'self'`; `connect-src` limitado a `'self'`, `https:` (importar packs por URL) y `wss://0.peerjs.com`; `object-src`/`base-uri`/`form-action` a `'none'`. GitHub Pages no permite cabeceras, así que `frame-ancestors` no se puede aplicar |
| 8 | Alias sin normalizar | Bajo | **Cerrado.** NFKC, sin caracteres de control, de formato ni bidi; 2–20 caracteres; avatar solo de una lista cerrada |
| 9 | Objetos indexados por id de red | Bajo | **Cerrado.** `Object.create(null)` en todo diccionario con claves externas; test de `__proto__` |
| 10 | Importación sin límites | Bajo | **Cerrado.** 5 MB y 5.000 preguntas; validación por pregunta; los errores se listan sin romper el pack |
| 11 | Reconexión | — | **Correcto.** Token por dispositivo; test e2e de recarga a mitad de partida |
| 12 | Respuestas antes de la resolución | — | **Correcto y reforzado.** Además de no enviar la respuesta, el marcador muestra los puntos, rachas y vidas *de antes* de la pregunta hasta que se resuelve (antes la racha delataba si habías acertado). Tests unitario y e2e |
| 13 | IP visible por WebRTC | Inherente | **Documentado** (README). Opción "solo relay" con TURN en fase 4 |
| 14 | Enlaces externos | — | **Correcto.** `rel="noopener noreferrer"`, `referrer: no-referrer` |
| 15 | Sin LICENSE | Legal | **Cerrado.** MIT |

### Conexión alternativa cifrada (v0.2.1)

Cuando la conexión directa WebRTC no se puede abrir (datos móviles, NAT estricto) y no hay TURN gratuito fiable (el de PeerJS no responde), los mensajes pasan por un broker MQTT público (EMQX o HiveMQ) por WebSocket seguro:

- Cada sala genera un secreto aleatorio de 128 bits que solo viaja en el fragmento `#…&k=…` del enlace y del QR. Los navegadores nunca envían el fragmento a ningún servidor.
- Del secreto salen el tema MQTT (hash SHA-256, no reversible) y la clave AES-GCM-256. El broker solo ve temas aleatorios y bytes cifrados; un mensaje alterado o con otra clave se descarta.
- Quien entra solo con el código (sin el enlace) no puede usar esta vía.
- Riesgo aceptado: alguien que capture tráfico cifrado podría reenviarlo tal cual (replay). El anfitrión ignora respuestas fuera de la pregunta y fase actuales, así que el efecto se limita a duplicar mensajes inocuos.
- Los brokers públicos no tienen garantía de servicio; si fallan, la app lo dice y la conexión directa sigue funcionando donde sea posible.

Otros cambios: la descarga de packs por URL usa `credentials: 'omit'` y solo `https`; el almacenamiento local se valida con Zod al leerlo; los mensajes del anfitrión también se validan en el invitado (un anfitrión malicioso no puede inyectar nada fuera del esquema).

## Reglas para contribuir

- Nunca `innerHTML`, `eval`, `new Function` ni `dangerouslySetInnerHTML` con datos de packs o de la red.
- Todo lo que llega de la red o de un pack se valida con el esquema antes de usarse.
- Nada de claves de API en el código ni en el navegador. Si alguna función necesita un secreto (p. ej. credenciales TURN), va en un Worker con variables de entorno.
- Dependencias nuevas: justificar en la PR; Dependabot y CodeQL activos.
- Packs comunitarios: solo contenido con licencia que permita compartirlo; nunca preguntas reales de examen (rompe los acuerdos de confidencialidad de los exámenes).
