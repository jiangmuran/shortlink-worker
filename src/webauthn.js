// WebAuthn (passkey) support implemented directly on top of the WebCrypto API —
// no external dependencies. We support ES256 (EC2 P-256) and RS256 credentials,
// which covers every mainstream platform authenticator (iCloud, Chrome, Windows,
// Android, hardware keys). Attestation statements are not validated (attestation
// is requested as "none"); we only extract and verify the credential public key.

import { b64urlDecode, b64urlEncode } from './util.js';

// ---------- CBOR (subset used by CTAP2 canonical encodings) ----------

export function cborDecode(inputBytes, offset = 0) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  let pos = offset;
  const read = (n) => {
    if (pos + n > bytes.length) throw new Error('cbor: truncated');
    const b = bytes.subarray(pos, pos + n);
    pos += n;
    return b;
  };
  const first = read(1)[0];
  const major = first >> 5;
  const info = first & 0x1f;
  const readUint = (info) => {
    if (info < 24) return info;
    const len = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 8;
    let v = 0n;
    for (const b of read(len)) v = (v << 8n) | BigInt(b);
    return v;
  };

  switch (major) {
    case 0:
      return { value: Number(readUint(info)), bytesRead: pos - offset };
    case 1:
      return { value: -1 - Number(readUint(info)), bytesRead: pos - offset };
    case 2: {
      const len = Number(readUint(info));
      return { value: read(len), bytesRead: pos - offset };
    }
    case 3: {
      const len = Number(readUint(info));
      return { value: new TextDecoder().decode(read(len)), bytesRead: pos - offset };
    }
    case 4: {
      const len = Number(readUint(info));
      const arr = [];
      for (let i = 0; i < len; i++) {
        const r = cborDecode(bytes, pos);
        arr.push(r.value);
        pos += r.bytesRead;
      }
      return { value: arr, bytesRead: pos - offset };
    }
    case 5: {
      const len = Number(readUint(info));
      const map = {};
      for (let i = 0; i < len; i++) {
        const k = cborDecode(bytes, pos);
        pos += k.bytesRead;
        const v = cborDecode(bytes, pos);
        pos += v.bytesRead;
        map[String(k.value)] = v.value;
      }
      return { value: map, bytesRead: pos - offset };
    }
    case 6: {
      // tag: decode and return the tagged item itself
      readUint(info);
      const r = cborDecode(bytes, pos);
      pos += r.bytesRead;
      return { value: r.value, bytesRead: pos - offset };
    }
    case 7: {
      if (info === 20) return { value: false, bytesRead: pos - offset };
      if (info === 21) return { value: true, bytesRead: pos - offset };
      if (info === 22 || info === 23) return { value: null, bytesRead: pos - offset };
      const len = info === 25 ? 2 : info === 26 ? 4 : 8;
      const buf = read(len);
      let v = 0n;
      for (const b of buf) v = (v << 8n) | BigInt(b);
      if (info === 25) {
        // half-precision
        const s = v & 0x8000n ? -1 : 1;
        const e = Number((v >> 10n) & 0x1fn);
        const f = Number(v & 0x3ffn);
        v = e === 0 ? BigInt(s * f * Math.pow(2, -24)) : e === 31 ? 0n : BigInt(s * (f + 1024) * Math.pow(2, e - 25));
      } else if (info === 26) {
        v = BigInt(Float32Array.from([Number(v)])[0]);
      }
      return { value: Number(v), bytesRead: pos - offset };
    }
    default:
      throw new Error('cbor: bad major type');
  }
}

// ---------- Authenticator data ----------

export function parseAuthData(inputBytes) {
  const bytes = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  if (bytes.length < 37) throw new Error('authData too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rpIdHash = bytes.subarray(0, 32);
  const flags = bytes[32];
  const counter = view.getUint32(33, false);
  let pos = 37;
  let attested = null;
  if (flags & 0x40) {
    if (bytes.length < pos + 18) throw new Error('authData attested truncated');
    pos += 16; // aaguid
    const credIdLen = view.getUint16(pos, false);
    pos += 2;
    const credId = bytes.subarray(pos, pos + credIdLen);
    pos += credIdLen;
    const key = cborDecode(bytes, pos);
    attested = { credentialId: credId, cose: bytes.subarray(pos, pos + key.bytesRead) };
    pos += key.bytesRead;
  }
  return { rpIdHash, flags, counter, attested };
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- COSE key import ----------

export async function importCoseKey(coseBytes) {
  const { value: cose } = cborDecode(coseBytes);
  const kty = cose['1'];
  const alg = cose['3'];
  if (kty === 2 && alg === -7) {
    // EC2 / P-256 / ES256
    if (cose['-1'] !== 1) throw new Error('unsupported EC curve');
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(cose['-2']),
      y: b64urlEncode(cose['-3']),
    };
    return {
      alg: 'ES256',
      key: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
      rawAlg: -7,
    };
  }
  if (kty === 3 && alg === -257) {
    // RSA / RS256
    const jwk = { kty: 'RSA', n: b64urlEncode(cose['-1']), e: b64urlEncode(cose['-2']) };
    return {
      alg: 'RS256',
      key: await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
        'verify',
      ]),
      rawAlg: -257,
    };
  }
  throw new Error(`unsupported credential algorithm (kty=${kty}, alg=${alg})`);
}

// WebAuthn ES256 signatures are ASN.1 DER (SEQUENCE { INTEGER r, INTEGER s }),
// but WebCrypto's ECDSA verify expects the raw IEEE P1363 form r || s.
export function ecdsaDerToRaw(sig, size) {
  const bytes = sig instanceof Uint8Array ? sig : new Uint8Array(sig);
  if (bytes.length === size * 2 && bytes[0] !== 0x30) return bytes; // already raw
  let pos = 0;
  const readLen = () => {
    let len = bytes[pos++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | bytes[pos++];
    }
    return len;
  };
  if (bytes[pos++] !== 0x30) throw new Error('invalid ECDSA signature');
  readLen();
  const out = new Uint8Array(size * 2);
  for (let part = 0; part < 2; part++) {
    if (bytes[pos++] !== 0x02) throw new Error('invalid ECDSA signature');
    let len = readLen();
    let int = bytes.subarray(pos, pos + len);
    pos += len;
    while (int.length > size && int[0] === 0) int = int.subarray(1); // drop sign-padding zero
    if (int.length > size) throw new Error('invalid ECDSA signature');
    out.set(int, part * size + (size - int.length));
  }
  return out;
}

// ---------- Ceremonies ----------

function checkClientData(clientDataB64, expectedType, expectedChallenge, expectedOrigin) {
  let clientData;
  try {
    clientData = JSON.parse(new TextDecoder().decode(b64urlDecode(clientDataB64)));
  } catch {
    throw new Error('invalid clientDataJSON');
  }
  if (clientData.type !== expectedType) throw new Error(`wrong ceremony type: ${clientData.type}`);
  if (clientData.challenge !== expectedChallenge) throw new Error('challenge mismatch');
  if (clientData.origin !== expectedOrigin) throw new Error(`origin mismatch: ${clientData.origin}`);
  return clientData;
}

export async function verifyRegistration(registration, { challenge, origin, rpId }) {
  const resp = registration?.response;
  if (!resp?.clientDataJSON || !resp?.attestationObject) throw new Error('missing registration fields');
  checkClientData(resp.clientDataJSON, 'webauthn.create', challenge, origin);

  const { value: attObj } = cborDecode(b64urlDecode(resp.attestationObject));
  const authData = parseAuthData(new Uint8Array(attObj.authData));
  if (!(authData.flags & 0x01)) throw new Error('user presence flag not set');
  if (!authData.attested) throw new Error('no attested credential data');
  const rpIdOk = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId));
  if (toHex(authData.rpIdHash) !== toHex(new Uint8Array(rpIdOk))) {
    throw new Error('rpId mismatch');
  }
  const imported = await importCoseKey(authData.attested.cose);

  return {
    credentialId: b64urlEncode(authData.attested.credentialId),
    publicKey: authData.attested.cose,
    alg: imported.rawAlg,
    counter: authData.counter,
    backupEligible: !!(authData.flags & 0x08),
    backedUp: !!(authData.flags & 0x10),
    transports: Array.isArray(resp.transports) ? resp.transports.slice(0, 8) : [],
  };
}

export async function verifyAssertion(assertion, stored, { challenge, origin, rpId }) {
  const resp = assertion?.response;
  if (!resp?.clientDataJSON || !resp?.authenticatorData || !resp.signature) {
    throw new Error('missing assertion fields');
  }
  checkClientData(resp.clientDataJSON, 'webauthn.get', challenge, origin);

  const authDataBytes = b64urlDecode(resp.authenticatorData);
  const authData = parseAuthData(authDataBytes);
  if (!(authData.flags & 0x01)) throw new Error('user presence flag not set');
  const rpIdOk = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId));
  if (toHex(authData.rpIdHash) !== toHex(new Uint8Array(rpIdOk))) {
    throw new Error('rpId mismatch');
  }
  // Signature over authenticatorData || SHA-256(clientDataJSON)
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', b64urlDecode(resp.clientDataJSON)));
  const message = new Uint8Array(authDataBytes.length + clientHash.length);
  message.set(authDataBytes, 0);
  message.set(clientHash, authDataBytes.length);

  const imported = await importCoseKey(stored.public_key);
  const signature = b64urlDecode(resp.signature);
  const valid = await crypto.subtle.verify(
    imported.alg === 'ES256' ? { name: 'ECDSA', hash: { name: 'SHA-256' } } : { name: 'RSASSA-PKCS1-v1_5' },
    imported.key,
    imported.alg === 'ES256' ? ecdsaDerToRaw(signature, 32) : signature,
    message
  );
  if (!valid) throw new Error('signature verification failed');

  return {
    counter: authData.counter,
    counterAdvanced:
      authData.counter === 0 && stored.counter === 0 ? true : authData.counter > stored.counter,
    userVerified: !!(authData.flags & 0x04),
  };
}

export function generateChallenge() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}
