/**
 * Interfaz abstracta de control del robot.
 *
 * IMPORTANTE: en esta fase NO existe integración con hardware real.
 * Esta capa define el contrato que un adaptador físico futuro deberá
 * cumplir (ver docs/ROBOT_INTEGRATION_ROADMAP.md). Hoy solo existe
 * MockRobotAdapter, que registra intenciones simuladas.
 */

export type RobotCommandType =
  | "SAY"
  | "SET_FACE_EXPRESSION"
  | "MOVE_HEAD"
  | "WAVE_HAND"
  | "STOP_ALL";

export type SafetyLevel = "safe" | "supervised" | "dangerous";

export interface RobotCapability {
  command: RobotCommandType;
  description: string;
  /** false hasta que exista hardware auditado conectado. */
  available: boolean;
  safetyLevel: SafetyLevel;
  /** Si true, un humano deberá confirmar antes de ejecutar en hardware real. */
  requiresConfirmation: boolean;
}

export interface RobotCommand {
  id: string;
  type: RobotCommandType;
  params: Record<string, string | number | boolean | undefined>;
  issuedAt: number;
  source: "agent" | "ui";
}

export type RobotCommandStatus = "simulated" | "rejected" | "executed";

export interface RobotCommandResult {
  commandId: string;
  status: RobotCommandStatus;
  detail: string;
}

export interface RobotAdapter {
  readonly name: string;
  /** true solo cuando hay un cuerpo físico conectado y auditado. */
  isHardwareConnected(): boolean;
  capabilities(): RobotCapability[];
  execute(command: RobotCommand): Promise<RobotCommandResult>;
}
