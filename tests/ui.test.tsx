// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import HelionApp from "@/components/HelionApp";
import MinimalVoiceExperience from "@/components/MinimalVoiceExperience";
import { toAppError } from "@/lib/shared/errors";

beforeAll(() => {
  // jsdom no implementa matchMedia ni canvas 2D: los componentes lo toleran.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  );
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
});

afterEach(cleanup);

describe("experiencia pública minimalista", () => {
  it("muestra el orbe, el botón y la consola conversacional, sin paneles técnicos", () => {
    render(<HelionApp appName="Helion" agentName="Helion" />);
    expect(screen.getByRole("button", { name: /encender helion/i })).toBeTruthy();
    // La consola conversacional (transcript + texto) SÍ existe ahora en público.
    expect(screen.getByRole("button", { name: /conversación/i })).toBeTruthy();
    expect(screen.getByPlaceholderText(/escribe a helion/i)).toBeTruthy();
    // Pero NO los paneles técnicos (diagnóstico/memoria/silenciar) del modo avanzado.
    expect(screen.queryByTitle(/diagnóstico/i)).toBeNull();
    expect(screen.queryByTitle(/^memoria$/i)).toBeNull();
    expect(screen.queryByTitle(/silenciar/i)).toBeNull();
  });

  it("el triple clic en la línea de estado abre el modo avanzado", () => {
    const { container } = render(<HelionApp appName="Helion" agentName="Helion" />);
    const statusLine = container.querySelector(".min-status");
    expect(statusLine).not.toBeNull();
    fireEvent.click(statusLine!);
    fireEvent.click(statusLine!);
    fireEvent.click(statusLine!);
    expect(screen.getByText(/modo avanzado/i)).toBeTruthy();
  });
});

describe("botón y orbe por estado", () => {
  const levelRef = { current: 0 };
  const noop = () => {};

  function renderMinimal(overrides: Partial<Parameters<typeof MinimalVoiceExperience>[0]> = {}) {
    return render(
      <MinimalVoiceExperience
        appName="Helion"
        status="idle"
        error={null}
        isConnected={false}
        listenMode="auto"
        pttActive={false}
        micLevelRef={levelRef}
        agentLevelRef={levelRef}
        onPower={noop}
        onPttChange={noop}
        onResumeAudio={noop}
        onAdvanced={noop}
        {...overrides}
      />,
    );
  }

  it("apagado → «Encender Helion»", () => {
    renderMinimal();
    expect(screen.getByRole("button", { name: "Encender Helion" })).toBeTruthy();
  });

  it("conectando → «Conectando…» y deshabilitado", () => {
    renderMinimal({ status: "connecting" });
    const button = screen.getByRole("button", { name: "Conectando…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("calibrando → «Calibrando…»", () => {
    renderMinimal({ status: "calibrating", isConnected: true });
    expect(screen.getByRole("button", { name: "Calibrando…" })).toBeTruthy();
  });

  it("encendido → «Apagar Helion»", () => {
    renderMinimal({ status: "listening", isConnected: true });
    expect(screen.getByRole("button", { name: "Apagar Helion" })).toBeTruthy();
  });

  it("push-to-talk → «Mantén para hablar» + apagado discreto", () => {
    renderMinimal({ status: "standby", isConnected: true, listenMode: "ptt" });
    expect(screen.getByRole("button", { name: "Mantén para hablar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /apagar helion/i })).toBeTruthy();
  });

  it("el orbe recibe el estado (data-status)", () => {
    const { container } = renderMinimal({ status: "listening", isConnected: true });
    expect(container.querySelector(".orb-stage")?.getAttribute("data-status")).toBe("listening");
    expect(container.querySelector(".orb-halo")).not.toBeNull();
  });

  it("micro denegado → mensaje mínimo y elegante", () => {
    renderMinimal({ status: "error", error: toAppError("mic_permission") });
    expect(screen.getByText("Activa el micrófono para hablar con Helion.")).toBeTruthy();
  });
});

describe("modo avanzado (oculto)", () => {
  it("muestra la consola técnica completa", () => {
    render(<HelionApp appName="Helion" agentName="Helion" initialAdvanced />);
    expect(screen.getByRole("heading", { name: /conversación/i })).toBeTruthy(); // transcript
    expect(screen.getByTitle(/diagnóstico/i)).toBeTruthy();
    expect(screen.getByTitle(/^memoria$/i)).toBeTruthy();
    expect(screen.getByTitle(/salir del modo avanzado/i)).toBeTruthy();
  });

  it("se puede volver a la experiencia minimalista", () => {
    render(<HelionApp appName="Helion" agentName="Helion" initialAdvanced />);
    fireEvent.click(screen.getByTitle(/salir del modo avanzado/i));
    expect(screen.getByRole("button", { name: /encender helion/i })).toBeTruthy();
    // De vuelta en minimal: sigue el control de salir del avanzado ausente.
    expect(screen.queryByTitle(/salir del modo avanzado/i)).toBeNull();
  });
});

describe("microestados visuales (bloque 3 §12)", () => {
  it("renderiza el orbe con micUnavailable y pulso de identidad sin romper", () => {
    const { container } = render(
      <MinimalVoiceExperience
        appName="Helion"
        status="listening"
        error={null}
        isConnected
        listenMode="auto"
        pttActive={false}
        micLevelRef={{ current: 0 }}
        agentLevelRef={{ current: 0 }}
        onPower={() => {}}
        onPttChange={() => {}}
        onResumeAudio={() => {}}
        onAdvanced={() => {}}
        orbPulse={{ kind: "identity", seq: 1 }}
        micUnavailable
      />,
    );
    // El orbe (canvas) está presente; los props nuevos no rompen el render.
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});

describe("haptics opcionales (bloque 3 §12)", () => {
  it("no lanza en navegadores sin soporte y respeta reduce-motion", async () => {
    const { haptic, hapticsAvailable } = await import("@/lib/client/haptics");
    // jsdom no implementa navigator.vibrate → no disponible, y haptic() no lanza.
    expect(hapticsAvailable()).toBe(false);
    expect(() => haptic(10)).not.toThrow();
  });
});

describe("consola conversacional (wake + texto)", () => {
  it("muestra transcript de usuario/Helion, marca ignorados y permite escribir", async () => {
    const { default: ConversationConsole } = await import("@/components/ConversationConsole");
    const sent: string[] = [];
    render(
      <ConversationConsole
        entries={[
          { id: "u1", role: "user", text: "Hola Helion", at: Date.now(), inputMode: "voice" },
          { id: "a1", role: "agent", text: "Estoy aquí.", at: Date.now() },
          { id: "u2", role: "user", text: "Helion es interesante", at: Date.now(), ignored: true, note: "Mención detectada, no respondida" },
        ]}
        connected
        sending={false}
        onSendText={(t) => { sent.push(t); }}
        defaultOpen
        showIgnored
        textInputEnabled
      />,
    );
    expect(screen.getByText("Hola Helion")).toBeTruthy();
    expect(screen.getByText("Estoy aquí.")).toBeTruthy();
    // Ignorado visible con su nota.
    expect(screen.getByText(/Mención detectada, no respondida/i)).toBeTruthy();
    // Enviar por texto.
    const box = screen.getByPlaceholderText(/escribe a helion/i);
    fireEvent.change(box, { target: { value: "¿Qué eres?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent).toContain("¿Qué eres?");
  });

  it("oculta los ignorados si showIgnored=false", async () => {
    const { default: ConversationConsole } = await import("@/components/ConversationConsole");
    render(
      <ConversationConsole
        entries={[{ id: "u2", role: "user", text: "Helion es interesante", at: Date.now(), ignored: true, note: "Mención" }]}
        connected
        sending={false}
        onSendText={() => {}}
        defaultOpen
        showIgnored={false}
        textInputEnabled
      />,
    );
    expect(screen.queryByText("Helion es interesante")).toBeNull();
  });

  it("no muestra el input si textInputEnabled=false", async () => {
    const { default: ConversationConsole } = await import("@/components/ConversationConsole");
    render(
      <ConversationConsole entries={[]} connected sending={false} onSendText={() => {}} defaultOpen showIgnored textInputEnabled={false} />,
    );
    expect(screen.queryByPlaceholderText(/escribe a helion/i)).toBeNull();
  });
});
