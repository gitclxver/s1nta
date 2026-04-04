import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function getAdminAuth() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!getApps().length) {
    initializeApp({ credential: cert(parsed) });
  }
  return getAuth();
}

export async function POST(request) {
  try {
    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      return Response.json(
        {
          error: "SERVER_CONFIG",
          message:
            "Password reset is not enabled. Add FIREBASE_SERVICE_ACCOUNT_JSON on the server.",
        },
        { status: 503 },
      );
    }

    const body = await request.json();
    const phoneLocal = String(body.phoneLocal || "").replace(/\D/g, "");
    const newPassword = String(body.newPassword || "");

    if (phoneLocal.length !== 9) {
      return Response.json({ error: "INVALID_PHONE" }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return Response.json({ error: "WEAK_PASSWORD" }, { status: 400 });
    }

    const email = `264${phoneLocal}@app.local`;

    let user;
    try {
      user = await adminAuth.getUserByEmail(email);
    } catch (e) {
      const code = e?.code || e?.errorInfo?.code;
      if (code === "auth/user-not-found") {
        return Response.json({ error: "NOT_FOUND" }, { status: 404 });
      }
      throw e;
    }

    await adminAuth.updateUser(user.uid, { password: newPassword });
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[reset-by-phone]", e);
    return Response.json({ error: "INTERNAL" }, { status: 500 });
  }
}
