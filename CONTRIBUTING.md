# Cómo contribuir

¡Gracias por querer mejorar BattleCert! Ideas, bugs, packs y código son bienvenidos.

## Antes de empezar

- Para cambios grandes, abre primero una issue y lo hablamos.
- Busca issues con la etiqueta `good first issue` si es tu primera vez.
- Lee [SECURITY.md](SECURITY.md): las reglas de seguridad son obligatorias.

## Entorno

```bash
npm ci
npm run dev
```

Antes de abrir la PR:

```bash
npm run lint
npm test
npm run build
npm run test:e2e   # si tocas red, sesión o pantallas
```

## Reglas

- TypeScript estricto. La lógica de juego va en `src/core` (sin React) y con tests.
- Todo lo que llega de la red o de un pack se valida con Zod antes de usarse.
- Nunca `innerHTML`, `dangerouslySetInnerHTML`, `eval` ni `new Function`.
- Nada cargado de CDN en tiempo de ejecución. Dependencias nuevas: justifícalas en la PR.
- Textos de la interfaz en español claro y directo.
- Commits pequeños con mensajes que expliquen el porqué.

## Packs

Comparte packs con preguntas **originales** y una licencia que permita compartirlas. Nunca preguntas reales de examen ni de bancos con copyright.
