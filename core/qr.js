import { ENGINE_SETTINGS } from "./settings.js";

export const MAX_QR_URL_LENGTH = 50;

export function validateQrUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > MAX_QR_URL_LENGTH) throw new RangeError(`QR URL must contain between 1 and ${MAX_QR_URL_LENGTH} characters`);
  let url;
  try { url = new URL(text); }
  catch { throw new TypeError("QR URL is invalid"); }
  if (url.protocol !== "https:") throw new TypeError("QR URL must use HTTPS");
  return text;
}

export function createQrMatrix(value, encode) {
  if (typeof encode !== "function") throw new TypeError("encode deve essere una funzione QR");
  const matrix = encode(value);
  if (!Array.isArray(matrix) || !matrix.length || matrix.some(row => row.length !== matrix.length)) {
    throw new Error("Matrice QR non valida");
  }
  return matrix;
}

export function encodeQrMatrix(value) {
  if (typeof globalThis.qrcode !== "function") throw new Error("Encoder QR non caricato");
  return createQrMatrix(validateQrUrl(value), text => {
    const qr = globalThis.qrcode(0, ENGINE_SETTINGS.qr.errorCorrection);
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    return Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, column) => qr.isDark(row, column)),
    );
  });
}
