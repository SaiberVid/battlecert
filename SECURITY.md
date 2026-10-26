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

## Auditoría del prototipo v0.1 (26-oct-2026)

| # | Hallazgo | Riesgo | Estado | Corrección prevista (fase 0) |
|---|---|---|---|---|
| 1 | Texto de packs, alias y mensajes se pinta con `textContent`; el único `innerHTML` es el SVG del QR (generado localmente) y el del temporizador (solo números) | — | Correcto | Mantener; regla de lint que prohíba `innerHTML` |
| 2 | Código de sala de 4 caracteres (≈923.000 combinaciones): adivinable por fuerza bruta contra el servidor de emparejamiento | Medio | Abierto | Códigos de 6 caracteres (≈887 millones) + **PIN opcional** dentro del enlace/QR + el anfitrión acepta o expulsa |
| 3 | El anfitrión acepta mensajes sin límite de tamaño ni frecuencia | Medio | Abierto | Validación con esquema (Zod), máximo 4 KB por mensaje, máximo 10 mensajes/s por invitado, desconexión al superar |
| 4 | El tiempo de respuesta lo envía el invitado (`ms`): se puede falsear para ganar el bonus de rapidez | Bajo | Abierto | El anfitrión mide su propio tiempo (llegada − envío − medio RTT medido con ping) y usa el mayor de los dos |
| 5 | Scripts de CDN (PeerJS en unpkg, QR en cdnjs) sin integridad (SRI) | Medio | Abierto | Empaquetar las dependencias en el build; nada externo en tiempo de ejecución |
| 6 | Google Fonts: la IP del visitante llega a Google (en la UE se considera dato personal) | Bajo (privacidad) | Abierto | Fuentes autoalojadas |
| 7 | Sin Content-Security-Policy | Medio | Abierto | CSP por `<meta>`: `default-src 'self'`; `connect-src` solo a los servidores de emparejamiento usados; sin `unsafe-eval` |
| 8 | Alias sin normalizar: caracteres invisibles o de control (bidi) permiten suplantar visualmente | Bajo | Abierto | Normalizar Unicode (NFKC), quitar caracteres de control y de formato, 2–20 caracteres |
| 9 | Objetos indexados por id recibidos de la red (`sc[pid]`) | Bajo | Abierto | `Map` u `Object.create(null)`; rechazar `__proto__`, `constructor`, `prototype` |
| 10 | Importación de packs: `JSON.parse` sin límite de tamaño | Bajo (solo afecta al propio dispositivo) | Abierto | Máximo 5 MB y 5.000 preguntas; validación de esquema antes de guardar |
| 11 | Reconexión por alias: el token por dispositivo impide robar el puesto de alguien conectado | — | Correcto | Mantener |
| 12 | Las respuestas correctas nunca viajan a los invitados antes de la resolución | — | Correcto | Test que lo garantice |
| 13 | WebRTC expone la IP pública a los demás jugadores | Inherente | Documentar | Aviso en la pantalla de sala; opción "solo relay" cuando haya TURN (fase 4) |
| 14 | Enlaces externos (`target=_blank`) | — | Correcto (`rel=noopener`) | Mantener |
| 15 | Sin `LICENSE` en el repo | Legal | Abierto | MIT |

## Reglas para contribuir

- Nunca `innerHTML`, `eval`, `new Function` ni `dangerouslySetInnerHTML` con datos de packs o de la red.
- Todo lo que llega de la red o de un pack se valida con el esquema antes de usarse.
- Nada de claves de API en el código ni en el navegador. Si alguna función necesita un secreto (p. ej. credenciales TURN), va en un Worker con variables de entorno.
- Dependencias nuevas: justificar en la PR; Dependabot y CodeQL activos.
- Packs comunitarios: solo contenido con licencia que permita compartirlo; nunca preguntas reales de examen (rompe los acuerdos de confidencialidad de los exámenes).
