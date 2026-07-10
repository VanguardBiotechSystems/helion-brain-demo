import { NextRequest, NextResponse } from "next/server";
import { requireAccess } from "@/lib/server/apiGuard";

export const dynamic = "force-dynamic";

/** Identidad conversacional actual (sin secretos). */
export async function GET(request: NextRequest) {
  const guard = requireAccess(request);
  if (!guard.ok) return guard.response;
  const { profile, identityStatus, env } = guard;
  return NextResponse.json({
    accessAuthorized: true,
    currentProfileId: identityStatus === "unknown" ? null : profile.id,
    identityStatus,
    displayName: profile.displayName,
    role: profile.role,
    trustLevel: profile.trustLevel,
    memoryScopes: profile.memoryScopes,
    canManageMemory: profile.canManageMemory,
    canViewDebug: profile.canViewDebug && identityStatus === "confirmed",
    ownerPinConfigured: Boolean(env.identity.ownerPin),
  });
}
