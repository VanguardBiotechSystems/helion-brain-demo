/**
 * Pantalla segura cuando faltan variables de entorno.
 * Muestra solo los NOMBRES de las variables ausentes, nunca valores.
 */
export default function ConfigErrorScreen({ missing }: { missing: string[] }) {
  return (
    <div className="gate-screen">
      <div className="gate-card">
        <div className="gate-mark gate-mark-warn" aria-hidden />
        <h1 className="gate-title">Configuración pendiente</h1>
        <p className="gate-text">
          El servidor está desplegado pero faltan variables de entorno obligatorias:
        </p>
        <ul className="gate-missing-list">
          {missing.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
        <p className="gate-text gate-text-dim">
          Configúralas en el panel de tu plataforma (por ejemplo, Vercel → Settings → Environment
          Variables) y vuelve a desplegar. Consulta <code>.env.example</code> en el repositorio.
        </p>
      </div>
    </div>
  );
}
