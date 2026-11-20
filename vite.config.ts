import type { Server } from 'node:http';
import { defineConfig } from 'vite';
import { attachGameServer } from './server/rooms';

// No modo dev o servidor multiplayer roda acoplado ao próprio Vite (mesma porta, rota /ws).
export default defineConfig({
  server: { port: 5173, host: true },
  preview: { port: 4173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  plugins: [
    {
      name: 'ebrashot-game-server',
      configureServer(server) {
        if (server.httpServer) attachGameServer(server.httpServer as Server);
      },
    },
  ],
});
