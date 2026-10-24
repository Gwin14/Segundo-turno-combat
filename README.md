# Segundo Turno: O Embate Final

Jogo de luta 2D multiplayer online que roda no navegador. Lula contra Flávio, sempre um contra o outro: o personagem nunca se repete.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Para testar o online sozinho, abra duas abas: crie a sala em uma e entre pelo link (ou código) na outra.

## Modos

- **Criar sala**: gera um código de 4 letras e um link `?sala=XXXX` para mandar ao oponente. Quem entra fica com o lutador que sobrou.
- **Partida rápida**: fila de matchmaking. Se os dois quiserem o mesmo lutador, o segundo recebe o outro.
- **Treino vs CPU**: offline, com três níveis de dificuldade.

Melhor de 3 rounds de 60 segundos. Ao final, os dois precisam aceitar a revanche.

## Controles

| Ação | Teclado | Gamepad |
|---|---|---|
| Andar | ← → / A D | D-pad / analógico |
| Pular | ↑ / W / Espaço | ↑ |
| Agachar | ↓ / S | ↓ |
| Defender | segurar para trás | segurar para trás |
| Soco | J / Z | X / Quadrado |
| Chute | K / X | A / Xis |
| Especial | L / C | B / Y / RB |
| Pausa / Som | Esc / M | |

Agachado + soco/chute = golpe baixo. Golpe no ar = voadora. Agache ou pule para desviar dos projéteis (picanha do Lula, bola do Flávio). No celular aparecem controles de toque; jogue com o aparelho deitado.

## Arquitetura

- `shared/sim.js`: simulação determinística a 60 Hz (física, golpes, hitboxes, rounds). É a mesma no servidor e no navegador.
- `server.js`: servidor HTTP + WebSocket (`ws`). O servidor é autoritativo: recebe os inputs, roda a simulação e envia snapshots com os eventos (acerto, defesa, K.O.) a cada tick.
- `public/js/`: cliente. `render.js` (sprites, partículas, tremor de tela, hit-stop, HUD, narrador), `audio.js` (efeitos e música sintetizados com WebAudio + narração pt-BR via speechSynthesis), `input.js` (teclado/gamepad/toque), `ai.js` (CPU), `main.js` (telas, rede com buffer de interpolação).

## Arte (aseprite-mcp)

Toda a arte foi gerada pelas ferramentas do [aseprite-mcp](https://github.com/diivi/aseprite-mcp) rodando sobre o Aseprite: `create_canvas`, `draw_rows`, `outline_cel`, `apply_dither_gradient`, `draw_ellipse_at`, `draw_polygon`, `set_tag`, `export_spritesheet` etc. Os scripts ficam em `art/`, e os arquivos-fonte `.aseprite` em `art/src/` (dá para abrir e editar no Aseprite).

Para regenerar:

```bash
git clone https://github.com/diivi/aseprite-mcp tools/aseprite-mcp
(cd tools/aseprite-mcp && uv sync)
npm run art
```

O `.mcp.json` registra o aseprite-mcp como servidor MCP do projeto, para editar a arte de forma interativa pelo Claude Code.

## Analytics (PostHog)

Os eventos vão para o PostHog quando `POSTHOG_PROJECT_TOKEN` e `POSTHOG_HOST` estão definidas (localmente no `.env`, veja `.env.example`). Sem elas, o jogo roda normalmente e não envia nada.

Todo evento leva `app: "segundo-turno"` (o projeto do PostHog é compartilhado com outros apps) e `ambiente: "dev"` ou `"prod"`.

- **Servidor** (`analytics.js`, fatos da partida): `sala criada`, `sala entrou`, `sala preenchida`, `sala cancelada`, `sala abandonada`, `sala entrada falhou`, `partida rapida na fila`, `partida rapida pareada`, `partida rapida cancelada`, `partida online iniciada`, `round terminado`, `partida online terminada` (resultado, placar, golpes, combo, especiais...), `oponente saiu`, `servidor status` (a cada 5 min).
- **Navegador** (`public/js/analytics.js`): `jogo carregado`, `modo escolhido`, `lutador escolhido`, `dificuldade escolhida`, `treino iniciado`, `treino terminado`, `treino abandonado`, `acao online`, `convite copiado`, `revanche pedida`, `controle usado`, `som alternado`, `latencia medida`, `conexao perdida`, `erro online`.

O navegador gera um ID anônimo e o manda ao servidor, para que os eventos dos dois lados caiam na mesma pessoa. O SDK do navegador (`posthog-js`) é servido pelo próprio servidor em `/vendor/posthog.js`, com a versão fixada pelo `package-lock.json`.

## Deploy

Qualquer host Node com suporte a WebSocket serve (Render, Railway, Fly.io, uma VPS). O servidor usa a variável `PORT`. Comando de start: `npm start`. Em HTTPS o cliente usa `wss://` automaticamente.

Variáveis de ambiente no host:

| Variável | Para quê |
|---|---|
| `POSTHOG_PROJECT_TOKEN` | Chave pública do projeto no PostHog (liga o analytics) |
| `POSTHOG_HOST` | `https://us.i.posthog.com` |
| `PUBLIC_URL` | Opcional: domínio fixo para as URLs do Open Graph |
