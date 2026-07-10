// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import HelionApp from "@/components/HelionApp";

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
  it("solo muestra el orbe, el estado y el botón de encendido", () => {
    render(<HelionApp appName="Helion" agentName="Helion" />);
    expect(screen.getByRole("button", { name: /encender helion/i })).toBeTruthy();
    // Sin chat, sin caja de texto, sin paneles técnicos.
    expect(screen.queryByText(/conversación/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/escrib|modo texto/i)).toBeNull();
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
    expect(screen.queryByText(/conversación/i)).toBeNull();
  });
});
