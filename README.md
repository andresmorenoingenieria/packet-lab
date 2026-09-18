# Packet Lab

Simulación interactiva de conmutación de paquetes con fines educativos. Host A divide un mensaje en paquetes que cruzan una red de routers hasta llegar a Host B, y tú controlas en tiempo real las condiciones de la red para ver cómo cambian las rutas, la latencia y las pérdidas.

## Características

- **Conmutación de paquetes en vivo**: el mensaje se divide en 8 paquetes numerados que viajan de forma independiente por la red.
- **Topología con caminos alternativos**: Host A, 7 routers y Host B con múltiples rutas posibles entre cada par de nodos.
- **Políticas de encaminamiento**:
  - **Shortest**: siempre el camino más corto en número de saltos.
  - **Balanced**: elige el enlace con menor carga en el momento.
  - **Random**: selección aleatoria entre los candidatos hacia el destino.
- **Condiciones de red ajustables**:
  - Velocidad de transmisión (0.5×, 1×, 2×, 4×).
  - Nivel de congestión (baja, media, alta).
  - Probabilidad de pérdida de paquetes (0–30%).
- **Panel de telemetría**: paquetes enviados, en tránsito, en cola, entregados y perdidos, más latencia media y rendimiento (Mbps).
- **Registro de eventos**: traza en tiempo real de cada paquete (nacimiento, saltos, entrega y pérdidas).
- **Inspector interactivo**: haz clic en un paquete o router para ver su estado interno (cola, progreso, ruta visitada).
- **Explicación integrada**: overlay didáctico que repasa cómo funciona la conmutación de paquetes y el reensamblado en el destino.

## Tecnologías

- [Astro](https://astro.build)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS](https://tailwindcss.com)
- SVG para la visualización del grafo de red

## Puesta en marcha

```bash
# Instalar dependencias
npm install

# Entorno de desarrollo
npm run dev

# Compilación de producción
npm run build

# Vista previa del build
npm run preview

# Verificación de tipos
npm run check
```

## Estructura

```
src/
├── components/    # UI en Astro (red, controles, telemetría, log, inspector)
├── layouts/       # Layout base
├── lib/           # Lógica de simulación y red (TypeScript)
└── pages/         # Página principal
```

### Lógica de simulación (`src/lib`)

- `network.ts` — topología estática (nodos y enlaces), geometría y distancias por BFS.
- `routing.ts` — selección del siguiente salto según la política de encaminamiento.
- `simulation.ts` — bucle de simulación, estado de paquetes, colas y congestión.
- `packets.ts` — generación de paquetes y reensamblado del mensaje en el destino.
- `types.ts` — tipos compartidos y constantes.
- `render.ts` / `app.ts` — renderizado del grafo y control de la UI.

## Despliegue

El proyecto está configurado como sitio estático para [Vercel](https://vercel.com) (`site` apuntando a `https://packet-lab.vercel.app`).