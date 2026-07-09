# Hoja de ruta: conectar el cerebro al robot físico

Este documento define **cómo** se conectará Helion al cuerpo del robot humanoide de forma segura. Hoy no existe ninguna conexión física: todas las acciones son simuladas por `MockRobotAdapter` y así debe seguir hasta completar las fases descritas aquí.

## Principios innegociables

1. **Seguridad antes que demo.** Ningún comando físico sin parada de emergencia probada.
2. **El LLM propone, la capa de seguridad dispone.** El modelo nunca habla directamente con motores: emite *intenciones* tipadas que una capa determinista valida, limita y ejecuta (o rechaza).
3. **Allowlist, no blocklist.** Solo se ejecutan comandos explícitamente declarados en `RobotCapability` con `available: true`.
4. **Todo auditado.** Cada comando, decisión y resultado queda en un log de auditoría con marca de tiempo.
5. **Progresión por fases.** No se salta ninguna fase; cada una tiene criterios de salida verificables.

## El contrato ya existente

`lib/robot/types.ts` define el contrato que cualquier adaptador físico deberá cumplir:

- `RobotCommand` — intención tipada (`WAVE_HAND`, `MOVE_HEAD`, `SET_FACE_EXPRESSION`, `SAY`, `STOP_ALL`) con origen y timestamp.
- `RobotCapability` — por comando: `safetyLevel` (`safe` | `supervised` | `dangerous`), `requiresConfirmation`, `available` (hoy siempre `false`).
- `RobotAdapter` — `isHardwareConnected()`, `capabilities()`, `execute()`. El estado `executed` está reservado a hardware real; el mock solo produce `simulated`/`rejected`.

Conectar el robot = escribir un `PhysicalRobotAdapter` que implemente esta interfaz **detrás de la capa de seguridad**, sin tocar el cerebro conversacional.

## Arquitectura objetivo

```
Cerebro cloud (esta app)
   │ intenciones tipadas (JSON firmado)
   ▼
Robot Gateway (proceso en el robot o en su LAN)
   ├─ autenticación mTLS / token rotatorio
   ├─ validador determinista (allowlist, límites de velocidad/par, geofencing articular)
   ├─ cola con prioridad + watchdog (heartbeat; sin señal → STOP_ALL)
   ├─ requiresConfirmation → aprobación humana (botón físico o UI)
   └─ traductor de comandos
        ├─ ROS 2 (topics/actions; rosbridge WebSocket si conviene)
        ├─ MQTT (broker local, QoS 1, topics robot/cmd, robot/telemetry)
        └─ Serial/CAN a microcontroladores (STM32/ESP32) para actuadores
   ▼
Firmware con límites propios + E-STOP HARDWARE independiente del software
```

El gateway es la única pieza con permiso para hablar con actuadores. El cerebro cloud nunca abre conexión directa a motores.

## Fases

### Fase 0 — Hoy (completada)
Cerebro conversacional cloud + herramienta `robot_gesture` simulada + contrato `RobotAdapter`. **Salida:** demo de voz convincente sin riesgo físico.

### Fase 1 — Bus de comandos y simulador (sin hardware)
- Implementar el Robot Gateway como servicio aparte (Node o Python) con WebSocket seguro hacia la app.
- Ejecutar los comandos contra un **simulador** (Gazebo, Isaac Sim o un visor 3D simple) usando el mismo contrato.
- Log de auditoría estructurado (quién, qué, cuándo, resultado).
- **Salida:** el gesto pedido por voz se ve en el simulador; cero hardware.

### Fase 2 — Telemetría de solo lectura
- El gateway publica estado real del robot (batería, temperatura, posición articular) hacia la app; el agente puede *contarlo* por voz.
- Ningún comando de escritura habilitado todavía.
- **Salida:** el cerebro "siente" el cuerpo sin poder moverlo. Validación de red, auth y latencia reales.

### Fase 3 — Actuación supervisada de bajo riesgo
- Habilitar (`available: true`) solo comandos `safe` de baja energía: expresión facial, LEDs, voz por altavoz del robot.
- Después, gestos `supervised` (WAVE_HAND, MOVE_HEAD) con: confirmación humana obligatoria, límites de velocidad/par en firmware, zona despejada verificada, y **E-stop hardware al alcance**.
- Watchdog: si el gateway pierde heartbeat del cerebro (>500 ms configurable) → STOP_ALL automático.
- **Salida:** primer movimiento físico ordenado por voz, con humano supervisando y pruebas de e-stop documentadas.

### Fase 4 — Capacidades ampliadas
- Nuevas capacidades solo mediante revisión: análisis de riesgo por comando, pruebas en simulador, pruebas físicas con jaula/arnés, actualización de la allowlist.
- Nunca habilitar categorías `dangerous` (manipulación con fuerza, calor, electricidad, cerraduras) sin auditoría externa.

## Decisiones de transporte (recomendación)

| Opción | Cuándo usarla |
| --- | --- |
| **ROS 2 + rosbridge/WebSocket** | Si el robot ya usa ROS 2 (recomendado para humanoides: ecosistema, tipos de mensaje, tooling). |
| **MQTT con broker local** | Microcontroladores sueltos, redes inestables, telemetría barata. |
| **WebSocket directo con mTLS** | Prototipo rápido gateway↔cloud; más simple de auditar. |

En todos los casos: TLS/mTLS, tokens rotatorios, sin puertos del robot expuestos a internet (el gateway inicia la conexión saliente hacia el cloud).

## Requisitos de seguridad física (checklist de la Fase 3)

- [ ] E-stop hardware que corta potencia a actuadores, independiente del software.
- [ ] STOP_ALL por software probado desde: UI, voz, gateway y watchdog.
- [ ] Límites de par/velocidad en firmware (no solo en el gateway).
- [ ] Confirmación humana para todo comando `supervised`.
- [ ] Log de auditoría inmutable y revisado tras cada sesión.
- [ ] Pruebas de pérdida de red: el robot debe quedar en estado seguro.
- [ ] Procedimiento escrito de operación y zona de pruebas despejada.

## Qué NO haremos

- Ejecutar comandos físicos directamente desde el output del LLM sin validador determinista.
- Exponer el robot a internet ni aceptar comandos sin autenticación mutua.
- Habilitar hardware "solo para la demo" saltándose fases.
