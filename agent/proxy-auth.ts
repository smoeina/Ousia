import { localAgentSecret } from "../lib/local-secret";

import {
  extractBearerToken,
  verifyJwtHmac,
  withAuthChallenges,
  type AuthFn,
} from "eve/channels/auth";

export const proxyUserAuth: AuthFn<Request> = withAuthChallenges(
  async (request: Request) => {
    const secret = localAgentSecret();

    const token = extractBearerToken(request.headers.get("authorization"));
    const result = await verifyJwtHmac(token, {
      algorithm: "HS256",
      issuer: "ousia",
      audiences: ["ousia-agent"],
      secret,
    });
    if (!result.ok) return null;

    const auth = result.sessionAuth;
    const userId = auth.subject ?? auth.principalId;
    const projectSlug = request.headers.get("x-project-slug") ?? undefined;
    const creditReservationId =
      request.headers.get("x-credit-reservation-id") ?? undefined;
    const creditExecutionClass =
      request.headers.get("x-credit-execution-class") ?? undefined;
    const modelSource = request.headers.get("x-model-source") ?? undefined;
    const modelProvider = request.headers.get("x-model-provider") ?? undefined;
    const modelId = request.headers.get("x-model-id") ?? undefined;
    const modelContextWindowTokens = request.headers.get("x-model-context-window-tokens") ?? undefined;

    return {
      ...auth,
      principalId: userId,
      principalType: "user",
      subject: userId,
      attributes: {
        ...auth.attributes,
        ...(projectSlug ? { projectSlug } : {}),
        ...(creditReservationId ? { creditReservationId } : {}),
        ...(creditExecutionClass ? { creditExecutionClass } : {}),
        ...(modelSource ? { modelSource } : {}),
        ...(modelProvider ? { modelProvider } : {}),
        ...(modelId ? { modelId } : {}),
        ...(modelContextWindowTokens ? { modelContextWindowTokens } : {}),
      },
    };
  },
  [{ scheme: "Bearer" }],
);
