const keyPairPromise = crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

async function exportPublicJwk(): Promise<{ crv: string; kty: string; x: string; y: string }> {
  const { publicKey } = await keyPairPromise;
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return { crv: jwk.crv!, kty: jwk.kty!, x: jwk.x!, y: jwk.y! };
}

function base64url(data: string | Uint8Array): string {
  const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  return buf.toString("base64url");
}

export async function generateDPoPToken(url: string, method: string): Promise<string> {
  const { privateKey } = await keyPairPromise;
  const jwk = await exportPublicJwk();

  const header = { typ: "dpop+jwt", alg: "ES256", jwk };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    htu: url,
    htm: method,
    uuid: crypto.randomUUID(),
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
