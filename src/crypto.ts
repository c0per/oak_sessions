import { crypto } from "https://deno.land/std@0.149.0/crypto/mod.ts";
import {
  decode as bd,
  encode as be,
} from "https://deno.land/std@0.149.0/encoding/base64.ts";

// Helper functions to encrypt / decrypt using AES with default config in CryptoJS

// For CryptoJS cipher text:
// It has a constant header for the first 8 byte.
// It has the salt in the second 8 byte.
// The rest is the cipher text.
// +----------+----------+-----------------+
// | Salted__ |  <salt>  |  <cipherText>   |
// +----------+----------+-----------------+
// |  64 bit  |  64 bit  | variable length |
// +----------+----------+-----------------+

// size in byte, same as CryptoJS's default.
const HEADER_SIZE = 8;
const SALT_SIZE = 8;
const KEY_SIZE = 32;
const IV_SIZE = 16;

export const encryptCryptoJSAES = async (
  plainText: string,
  passphrase: string,
  iterations = 1,
): Promise<string> => {
  const salt = new Uint8Array(SALT_SIZE);
  crypto.getRandomValues(salt);

  const { key, iv } = await EVPKDF(
    new TextEncoder().encode(passphrase),
    salt,
    iterations,
  );

  const cipherText = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    new TextEncoder().encode(plainText),
  );

  // get the CryptoJS style cipher text.
  // "Salted__" + key + encryptedText
  return be(
    concatUint8Array(
      new TextEncoder().encode("Salted__"),
      salt,
      new Uint8Array(cipherText),
    ),
  );
};

// decrypt cipher text generated by default CryptoJS AES.
// cipher text should be in base64 (the default of CryptoJS's toString())
export const decryptCryptoJSAES = async (
  cipherTextBase64: string,
  passphrase: string,
  iterations = 1,
): Promise<string> => {
  const cipherText = bd(cipherTextBase64);

  const { salt, body } = parseCryptoJSCipherText(cipherText);

  const { key, iv } = await EVPKDF(
    new TextEncoder().encode(passphrase),
    salt,
    iterations,
  );

  const plainText = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    key,
    body,
  );

  return new TextDecoder().decode(plainText);
};

const parseCryptoJSCipherText = (cipherText: Uint8Array): {
  salt: Uint8Array;
  body: Uint8Array;
} => ({
  salt: cipherText.subarray(HEADER_SIZE, HEADER_SIZE + SALT_SIZE),
  body: cipherText.subarray(HEADER_SIZE + SALT_SIZE, cipherText.length),
});

const EVPKDF = async (
  passphrase: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<{ key: CryptoKey; iv: Uint8Array }> => {
  let rawKey = new Uint8Array();
  let block = new Uint8Array();

  while (rawKey.byteLength < KEY_SIZE + IV_SIZE) {
    let buffer = await crypto.subtle.digest(
      "SHA-384",
      concatUint8Array(block, passphrase, salt),
    );

    for (let i = 1; i < iterations; i++) {
      buffer = await crypto.subtle.digest(
        "SHA-384",
        buffer,
      );
    }

    block = new Uint8Array(buffer);
    rawKey = concatUint8Array(rawKey, block);
  }

  return {
    key: await crypto.subtle.importKey(
      "raw",
      rawKey.subarray(0, KEY_SIZE),
      "AES-CBC",
      false,
      ["encrypt", "decrypt"],
    ),
    iv: rawKey.subarray(KEY_SIZE, rawKey.length),
  };
};

const concatUint8Array = (...arrays: Uint8Array[]): Uint8Array => {
  const size = arrays.reduce((len, array) => len + array.length, 0);

  const merged = new Uint8Array(size);

  let mergedLen = 0;
  for (const array of arrays) {
    merged.set(array, mergedLen);
    mergedLen += array.length;
  }

  return merged;
};
