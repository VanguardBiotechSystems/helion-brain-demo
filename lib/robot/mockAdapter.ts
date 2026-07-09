import type {
  RobotAdapter,
  RobotCapability,
  RobotCommand,
  RobotCommandResult,
} from "./types";

/**
 * Adaptador simulado: registra intenciones, no mueve nada.
 * Jamás devuelve status "executed" — ese estado queda reservado para un
 * adaptador de hardware real, auditado y con parada de emergencia.
 */

type RobotActionListener = (command: RobotCommand, result: RobotCommandResult) => void;

const CAPABILITIES: RobotCapability[] = [
  {
    command: "SAY",
    description: "Hablar por el altavoz del robot (hoy: voz cloud del navegador).",
    available: false,
    safetyLevel: "safe",
    requiresConfirmation: false,
  },
  {
    command: "SET_FACE_EXPRESSION",
    description: "Cambiar la expresión facial (pantalla/LEDs).",
    available: false,
    safetyLevel: "safe",
    requiresConfirmation: false,
  },
  {
    command: "WAVE_HAND",
    description: "Saludar con la mano.",
    available: false,
    safetyLevel: "supervised",
    requiresConfirmation: true,
  },
  {
    command: "MOVE_HEAD",
    description: "Girar o inclinar la cabeza.",
    available: false,
    safetyLevel: "supervised",
    requiresConfirmation: true,
  },
  {
    command: "STOP_ALL",
    description: "Parada de emergencia: detener todos los actuadores.",
    available: false,
    safetyLevel: "safe",
    requiresConfirmation: false,
  },
];

export class MockRobotAdapter implements RobotAdapter {
  readonly name = "mock";
  private listeners = new Set<RobotActionListener>();

  isHardwareConnected(): boolean {
    return false;
  }

  capabilities(): RobotCapability[] {
    return CAPABILITIES.map((c) => ({ ...c }));
  }

  subscribe(listener: RobotActionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async execute(command: RobotCommand): Promise<RobotCommandResult> {
    const capability = CAPABILITIES.find((c) => c.command === command.type);

    let result: RobotCommandResult;
    if (!capability) {
      result = {
        commandId: command.id,
        status: "rejected",
        detail: `Comando desconocido: ${String(command.type)}`,
      };
    } else if (capability.safetyLevel === "dangerous") {
      result = {
        commandId: command.id,
        status: "rejected",
        detail: "Comando bloqueado por política de seguridad física.",
      };
    } else {
      result = {
        commandId: command.id,
        status: "simulated",
        detail: `Intención registrada (sin hardware conectado): ${command.type}`,
      };
    }

    console.info(`[robot:mock] ${command.type} -> ${result.status} :: ${result.detail}`);
    for (const listener of this.listeners) {
      try {
        listener(command, result);
      } catch {
        // Un listener roto no debe tumbar la simulación.
      }
    }
    return result;
  }
}

/** Instancia compartida para la UI y el bucle de herramientas del agente. */
export const mockRobot = new MockRobotAdapter();
