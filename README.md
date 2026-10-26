# Cert Arena

Entrena **cualquier certificación** jugando con amigos: misma pregunta y mismo reloj para todos, puntos por acierto, rapidez y racha. Gratis, sin cuentas y sin servidor.

**Jugar:** https://saibervid.github.io/claude-cert-duel/

## Cómo se juega

1. Escribe tu alias y pulsa **Crear sala**.
2. Tus amigos escanean el **QR**, abren el **enlace** (o lo reciben por WhatsApp) o escriben el **código de 4 letras**.
3. El anfitrión elige pack, dominios, modo, número de preguntas y segundos, y pulsa **Empezar**.

- **Simultáneo:** todos responden a la vez.
- **Por turnos + robo:** cada pregunta es de un jugador; si falla, el siguiente tiene 10 s para robarla.
- Puntos: 100 por acierto + hasta 50 por rapidez + 10 por cada acierto seguido (máx. +30). Robo: 50.
- Hasta 8 jugadores. Si alguien recarga o pierde la conexión, vuelve a entrar con el mismo alias y recupera su puesto.
- Al final: podio, acierto y tiempo medio, mejor racha, tus dominios débiles y tus fallos con la respuesta correcta.

## Packs para cualquier certificación

Incluye packs de práctica de Claude (CCDV-F, CCAR-F, CCAR-P). Para otras certificaciones, en **Packs de preguntas**:

- Importa un archivo o pega **JSON**, **CSV** (`question,a,b,c,d,answer,explanation,domain`) o **Markdown** (`## pregunta`, `- [x] correcta`, `- [ ] incorrecta`, `> explicación`).
- Importa desde una URL pública (por ejemplo, un fichero en GitHub).
- **Crea un pack con IA:** copia el prompt, pégalo en Claude con la guía oficial del examen y pega el JSON resultante.

Solo el anfitrión necesita tener el pack: las preguntas viajan a los demás durante la partida. Importa solo material que tengas derecho a usar; nunca preguntas reales de examen.

### Formato del pack

```json
{
  "format": "cert-arena/1",
  "id": "aws-saa-c03",
  "name": "AWS Solutions Architect Associate",
  "questions": [
    { "id": "q1", "domain": "Seguridad", "stem": "…", "options": ["…", "…", "…", "…"], "answer": [1], "explanation": "…" }
  ]
}
```

`answer` son índices desde 0; varios índices = respuesta múltiple.

## Cómo funciona (y por qué es gratis)

- Página estática en GitHub Pages.
- Conexión directa entre navegadores (WebRTC) con [PeerJS](https://peerjs.com/), que usa su servidor público gratuito solo para emparejar.
- Resultados y packs propios en el almacenamiento del navegador de cada dispositivo.

## Desarrollo

```bash
npm test        # motor e importadores
npm run build   # genera index.html (todo en un fichero)
```

La versión anterior, el duelo solo de Claude, sigue en [`/duelo/`](duelo/).

Packs incluidos: preguntas originales de Claude Cert Trainer + [preporato/claude-certification-guide](https://github.com/preporato/claude-certification-guide) y [Amey-Thakur/CLAUDE-CERTIFICATIONS](https://github.com/Amey-Thakur/CLAUDE-CERTIFICATIONS) (MIT). No son preguntas reales del examen.
