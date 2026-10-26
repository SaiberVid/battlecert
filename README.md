# BattleCert

**Duelos de preguntas tipo test en directo, para cualquier certificación o asignatura.** Crea una sala, comparte el QR y compite con tus amigos desde el móvil o el ordenador. Gratis, sin cuentas y sin servidores.

**[▶ Jugar ahora](https://saibervid.github.io/battlecert/)**

*Live multiplayer quiz duels for any exam or subject. Free, no accounts, peer-to-peer. Bring your own question pack (JSON/CSV/Markdown) or generate one with any AI from your notes.*

---

## Qué tiene

- **Multijugador en directo, hasta 8 personas.** Entran con QR, enlace o un código de 6 caracteres. PIN opcional y expulsión.
- **5 modos:** Clásico (acierto + rapidez + racha), Turnos + robo, Relámpago, Supervivencia (3 vidas) y Apuesta (arriesga ×1, ×2 o ×3).
- **Tú eliges el ritmo:** de 5 a 120 segundos por pregunta, 5–50 preguntas, filtrado por dominios.
- **Se siente como un juego:** sonidos que suben de tono con la racha, vibración en el móvil, cuenta atrás, reacciones, podio y confeti, revancha con marcador de serie. Con botón de silencio y respeto a "reducir movimiento".
- **Aprendes al jugar:** explicación tras cada pregunta, repaso de fallos y tus dominios de peor a mejor al acabar; historial de partidas.
- **Cualquier contenido:** importa packs en JSON, CSV o Markdown desde archivo, texto o URL (GitHub incluido). Te da **prompts listos** para que cualquier IA convierta un PDF, una guía oficial o un temario en preguntas (enfoque 80/20), y otro para corregir los errores que detecte el validador.
- **Modo solo** para practicar sin conexión con nadie.

Incluye tres packs de ejemplo sobre las certificaciones de Claude (preguntas originales; proyecto no afiliado a Anthropic).

## Cómo funciona (y por qué no se satura)

Es una web estática en GitHub Pages. **La sala vive en el navegador del anfitrión**: cada invitado abre una conexión directa (WebRTC) con él. El único servicio externo es el servidor público de emparejamiento de PeerJS, que solo presenta a los navegadores entre sí. No hay base de datos ni cuentas, así que cada partida es independiente y no hay nada central que saturar. Los packs, ajustes e historial se guardan solo en tu navegador.

Limitaciones conocidas: en redes muy restrictivas (algunas empresas o universidades) la conexión directa puede fallar; WebRTC deja ver tu IP a los demás jugadores de la sala, como en cualquier videollamada. Juega con gente de confianza.

## Formato de pack

```json
{
  "format": "battlecert/1",
  "id": "mi-asignatura",
  "name": "Mi asignatura",
  "lang": "es",
  "source": "Mis apuntes",
  "license": "Uso personal",
  "questions": [
    { "id": "q1", "domain": "Redes", "stem": "¿Qué puerto usa HTTPS?", "options": ["80", "443", "22", "8080"], "answer": [1], "explanation": "HTTPS usa 443." }
  ]
}
```

`answer` son índices desde 0 (varios = respuesta múltiple). También acepta listas de preguntas de otros proyectos, CSV (`question,a,b,c,d,answer,explanation,domain`) y Markdown. Límites: 5 MB y 5.000 preguntas. Más en la pestaña **Packs → Formato** de la app.

## Desarrollo

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # tests unitarios (Vitest)
npm run test:e2e   # partidas multijugador simuladas (Playwright)
npm run build      # web estática en dist/
```

Stack: Vite, React 19, TypeScript estricto, Zustand, Zod, Motion, PeerJS. Sin CDN en tiempo de ejecución; fuentes autoalojadas; CSP estricta.

```
src/core   motor de juego, modos, puntuación, packs (lógica pura, testeada)
src/net    protocolo validado con Zod y transporte P2P
src/ui     pantallas React
e2e/       tests end-to-end con una red simulada
docs/      plan del proyecto
```

Cada push a `main` pasa tests y build, y publica la web en la rama `gh-pages`.

## Documentación

- [Plan del proyecto y hoja de ruta](docs/PLAN.md)
- [Seguridad y modelo de amenazas](SECURITY.md)
- [Cómo contribuir](CONTRIBUTING.md)

El duelo original de la v0 sigue en [/duelo/](https://saibervid.github.io/battlecert/duelo/).

## Licencia

Código bajo [MIT](LICENSE). Cada pack declara su propia licencia en su campo `license`. No subas preguntas reales de exámenes: rompe los acuerdos de confidencialidad de las certificaciones.
