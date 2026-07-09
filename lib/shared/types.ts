/** Tipos compartidos entre cliente y servidor. */

export type AgentStatus =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

export type TranscriptRole = "user" | "agent" | "system" | "action";

export interface RobotActionInfo {
  command: string;
  detail?: string;
  status: "simulated" | "rejected";
}

export interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  text: string;
  at: number;
  pending?: boolean;
  action?: RobotActionInfo;
}

export interface SessionInfo {
  model: string;
  voice: string;
  agentName: string;
}

/** Respuesta de POST /api/session (sin datos sensibles más allá del token efímero). */
export interface SessionResponse {
  clientSecret: string;
  expiresAt: number;
  model: string;
  voice: string;
  agentName: string;
  baseUrl: string;
}
