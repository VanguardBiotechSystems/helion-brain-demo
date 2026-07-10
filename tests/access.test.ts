import { describe, expect, it } from "vitest";
import {
  ACCESS_TTL_MS,
  createAccessToken,
  passcodeMatches,
  verifyAccessToken,
} from "@/lib/server/access";

const SECRET = "un-secreto-de-prueba-suficientemente-largo";

describe("tokens de acceso", () => {
  it("un token recién creado es válido", () => {
    const token = createAccessToken(SECRET, "juanma", "confirmed");
    expect(verifyAccessToken(SECRET, token)).toMatchObject({ profileId: "juanma", identityStatus: "confirmed" });
  });

  it("rechaza tokens con firma manipulada", () => {
    const token = createAccessToken(SECRET, "juanma", "confirmed");
    const tampered = token.slice(0, -4) + "AAAA";
    expect(verifyAccessToken(SECRET, tampered)).toBeNull();
  });

  it("rechaza tokens con expiración manipulada", () => {
    const token = createAccessToken(SECRET, "juanma", "confirmed");
    const [, nonce, profileId, status, signature] = token.split(".");
    const forged = `${Date.now() + 999999999}.${nonce}.${profileId}.${status}.${signature}`;
    expect(verifyAccessToken(SECRET, forged)).toBeNull();
    // Tampoco se puede cambiar el perfil sin romper la firma.
    const [exp2] = token.split(".");
    expect(verifyAccessToken(SECRET, `${exp2}.${nonce}.sergio.${status}.${signature}`)).toBeNull();
  });

  it("rechaza tokens caducados", () => {
    const issuedAt = Date.now() - ACCESS_TTL_MS - 1000;
    const token = createAccessToken(SECRET, "juanma", "confirmed", issuedAt);
    expect(verifyAccessToken(SECRET, token)).toBeNull();
  });

  it("rechaza tokens firmados con otro secreto", () => {
    const token = createAccessToken("otro-secreto-distinto-y-tambien-largo", "juanma", "confirmed");
    expect(verifyAccessToken(SECRET, token)).toBeNull();
  });

  it("rechaza tokens malformados y ausentes", () => {
    expect(verifyAccessToken(SECRET, undefined)).toBeNull();
    expect(verifyAccessToken(SECRET, "")).toBeNull();
    expect(verifyAccessToken(SECRET, "a.b")).toBeNull();
    expect(verifyAccessToken(SECRET, "no-es-un-token")).toBeNull();
  });
});

describe("passcodeMatches", () => {
  it("acepta el passcode correcto", () => {
    expect(passcodeMatches("demo-1234", "demo-1234")).toBe(true);
  });

  it("rechaza passcodes incorrectos", () => {
    expect(passcodeMatches("demo-1234", "demo-1235")).toBe(false);
    expect(passcodeMatches("demo-1234", "")).toBe(false);
  });

  it("maneja longitudes distintas sin lanzar", () => {
    expect(passcodeMatches("corto", "una-cadena-mucho-mas-larga-que-la-esperada")).toBe(false);
  });

  it("rechaza entradas absurdamente largas", () => {
    expect(passcodeMatches("x", "a".repeat(10000))).toBe(false);
  });
});
